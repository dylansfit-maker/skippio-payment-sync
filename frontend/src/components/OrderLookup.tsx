import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, getOrder, syncOrder } from '../api/client';
import type { Order, PosStatus } from '../api/types';
import { errorMessage } from '../lib/ids';
import { formatMoney } from '../lib/money';
import { Alert } from './Alert';
import { StatusBadge, type Tone } from './StatusBadge';

export interface LookupRequest {
  orderId: string;
  /** Changes on every request so the same order id can be reloaded. */
  nonce: number;
}

interface Props {
  request: LookupRequest | null;
  /** Called after any action that may have changed backend state. */
  onActivity: () => void;
}

const POS_LABEL: Record<PosStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  SYNCING: { label: 'Syncing…', tone: 'busy' },
  SYNCED: { label: 'Synced', tone: 'good' },
  FAILED: { label: 'Failed', tone: 'bad' },
};

type Notice = { kind: 'success' | 'warning' | 'error'; title: string; body?: string };

export function OrderLookup({ request, onActivity }: Props) {
  const [input, setInput] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const latest = useRef(0); // ignore responses from superseded lookups

  const load = useCallback(async (orderId: string) => {
    const id = orderId.trim();
    if (!id) {
      setNotice({ kind: 'error', title: 'Enter an order ID to look up' });
      return;
    }
    const ticket = ++latest.current;
    setLoading(true);
    setNotice(null);
    try {
      const found = await getOrder(id);
      if (ticket === latest.current) setOrder(found);
    } catch (err) {
      if (ticket !== latest.current) return;
      setOrder(null);
      setNotice(
        err instanceof ApiError && err.status === 404
          ? { kind: 'error', title: `No order found with ID “${id}”`, body: 'Send a payment event first, or check the ID.' }
          : { kind: 'error', title: errorMessage(err) },
      );
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (request) {
      setInput(request.orderId);
      void load(request.orderId);
    }
  }, [request, load]);

  async function handleRetry() {
    if (!order) return;
    setRetrying(true);
    setNotice(null);
    try {
      const result = await syncOrder(order.id);
      setOrder(result.order);
      if (result.error) setNotice({ kind: 'warning', title: 'POS sync failed again', body: `${result.error}. The payment is still recorded; you can retry again.` });
      else setNotice({ kind: 'success', title: result.attempted ? 'POS sync succeeded' : 'Already synced, so no new POS transaction was created' });
    } catch (err) {
      setNotice({ kind: 'error', title: errorMessage(err) });
    } finally {
      setRetrying(false);
      onActivity();
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void load(input);
  };

  return (
    <section className="card" aria-labelledby="lookup-title">
      <h2 id="lookup-title">Order lookup</h2>
      <form className="inline" onSubmit={submit}>
        <div className="field grow">
          <label htmlFor="lookupId">Order ID</label>
          <input id="lookupId" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary align-end" disabled={loading || retrying}>{loading ? 'Looking up…' : 'Look up'}</button>
      </form>

      {loading && <span className="spinner" role="status" aria-label="Loading order" />}
      {notice && <Alert kind={notice.kind} title={notice.title}>{notice.body}</Alert>}

      {order && (
        <OrderDetails order={order} retrying={retrying} busy={loading} onRetry={handleRetry} onRefresh={() => void load(order.id)} />
      )}
      {!order && !loading && !notice && <p className="empty">Look up an order by its ID, or send a payment event to see it here.</p>}
    </section>
  );
}

function OrderDetails({ order, retrying, busy, onRetry, onRefresh }: { order: Order; retrying: boolean; busy: boolean; onRetry: () => void; onRefresh: () => void }) {
  const pos = POS_LABEL[order.pos.status];
  const refunded = order.refund.status === 'REFUNDED';
  return (
    <div className="details">
      <div className="details-head">
        <h3>{order.id}</h3>
        <button type="button" className="btn-ghost" onClick={onRefresh} disabled={busy || retrying}>Refresh</button>
      </div>

      <dl className="facts">
        <dt>Payment</dt>
        <dd><StatusBadge tone="good" label="Paid" /></dd>
        <dt>POS sync</dt>
        <dd><StatusBadge tone={pos.tone} label={pos.label} /></dd>
        <dt>POS attempts</dt>
        <dd>{order.pos.attempts}</dd>
        <dt>POS reference</dt>
        <dd>{order.pos.transactionRef ?? '—'}</dd>
        {order.pos.lastError && (<><dt>Last POS error</dt><dd className="error-text">{order.pos.lastError}</dd></>)}
        <dt>Refund</dt>
        <dd>{refunded ? <StatusBadge tone="neutral" label={`Refunded ${formatMoney(order.refund.amount, order.currency)}`} /> : 'Not refunded'}</dd>
        <dt>Venue</dt>
        <dd>{order.venueId}</dd>
        <dt>Event IDs</dt>
        <dd>{order.payment.eventIds.join(', ')}</dd>
      </dl>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Product</th><th className="num">Qty</th><th className="num">Price each</th><th className="num">Subtotal</th></tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={`${item.productId}-${i}`}>
                <td>{item.productId}</td>
                <td className="num">{item.quantity}</td>
                <td className="num">{formatMoney(item.price, order.currency)}</td>
                <td className="num">{formatMoney(item.price * item.quantity, order.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th colSpan={3}>Total</th><td className="num total">{formatMoney(order.total, order.currency)}</td></tr>
          </tfoot>
        </table>
      </div>

      {order.pos.status === 'FAILED' && (
        <div className="actions">
          <button type="button" className="btn-primary" onClick={onRetry} disabled={retrying || busy}>{retrying ? 'Retrying…' : 'Retry POS sync'}</button>
          {retrying && <span className="spinner" role="status" aria-label="Retrying POS sync" />}
        </div>
      )}
    </div>
  );
}
