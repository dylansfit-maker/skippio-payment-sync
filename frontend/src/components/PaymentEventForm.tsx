import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, submitPaymentEvent } from '../api/client';
import type { Meta, SubmitResult } from '../api/types';
import { errorMessage, generateId } from '../lib/ids';
import { formatMoney, minorToMajorString, minorUnitDigits, parseMajorToMinor } from '../lib/money';
import { Alert } from './Alert';

interface ItemRow {
  key: string;
  productId: string;
  quantity: string;
  /** Major units as typed, e.g. "12.50". */
  price: string;
}

interface Draft {
  type: string;
  venueId: string;
  currency: string;
  items: ItemRow[];
}

const DRAFT_KEY = 'skippio.paymentForm.v1';
const newRow = (): ItemRow => ({ key: generateId('row'), productId: '', quantity: '1', price: '' });

/** Remembers venue and line items between visits so repeated testing needs less typing. IDs are never stored. */
function loadDraft(): Partial<Draft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>;
  } catch {
    return {};
  }
}
function saveDraft(draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable: the draft is a convenience only */
  }
}

type Outcome = { kind: 'success'; result: SubmitResult } | { kind: 'error'; message: string; details: string[] };

interface Props {
  meta: Meta;
  onSubmitted: (orderId: string) => void;
}

export function PaymentEventForm({ meta, onSubmitted }: Props) {
  const draft = useMemo(loadDraft, []);
  const [eventId, setEventId] = useState(() => generateId('evt'));
  const [orderId, setOrderId] = useState(() => generateId('ord'));
  const [type, setType] = useState(draft.type && meta.supportedEventTypes.includes(draft.type) ? draft.type : (meta.supportedEventTypes[0] ?? ''));
  const [venueId, setVenueId] = useState(draft.venueId ?? '');
  const [currency, setCurrency] = useState(draft.currency && meta.supportedCurrencies.includes(draft.currency) ? draft.currency : (meta.supportedCurrencies[0] ?? ''));
  const [items, setItems] = useState<ItemRow[]>(draft.items?.length ? draft.items.map((i) => ({ ...i, key: generateId('row') })) : [newRow()]);
  const [totalText, setTotalText] = useState('');
  const [totalEdited, setTotalEdited] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Parsed line prices; null marks a row the user has not filled in correctly yet.
  const parsedRows = items.map((row) => {
    const quantity = Number(row.quantity);
    return { price: parseMajorToMinor(row.price, currency), quantity: row.quantity.trim() !== '' && Number.isInteger(quantity) ? quantity : null };
  });
  const calculatedTotal = parsedRows.every((r) => r.price !== null && r.quantity !== null)
    ? parsedRows.reduce((sum, r) => sum + (r.quantity as number) * (r.price as number), 0)
    : null;
  const calculatedText = calculatedTotal === null ? '' : minorToMajorString(calculatedTotal, currency);
  const shownTotal = totalEdited ? totalText : calculatedText;
  const enteredTotal = parseMajorToMinor(shownTotal, currency);
  const totalMismatch = totalEdited && calculatedTotal !== null && enteredTotal !== null && enteredTotal !== calculatedTotal;

  const updateItem = (key: string, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors: string[] = [];
    const lines = items.map((row, i) => {
      const price = parseMajorToMinor(row.price, currency);
      if (price === null) errors.push(`Item ${i + 1}: enter a price like ${minorToMajorString(1250, currency)}`);
      return { productId: row.productId, quantity: Number(row.quantity), price: price ?? 0 };
    });
    if (enteredTotal === null) errors.push(`Total: enter an amount like ${minorToMajorString(1250, currency)}`);
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setSubmitting(true);
    setOutcome(null);
    saveDraft({ type, venueId, currency, items });
    try {
      const result = await submitPaymentEvent({ eventId, type, order: { id: orderId, venueId, currency, items: lines, total: enteredTotal as number } });
      setOutcome({ kind: 'success', result });
    } catch (err) {
      setOutcome({ kind: 'error', message: errorMessage(err), details: err instanceof ApiError ? err.details : [] });
    } finally {
      setSubmitting(false);
      onSubmitted(orderId.trim());
    }
  }

  const digits = minorUnitDigits(currency);

  return (
    <section className="card" aria-labelledby="form-title">
      <h2 id="form-title">Send a payment event</h2>
      <p className="hint">Submit the same event again to see duplicate handling. Use “New event ID” to simulate a different event for the same order.</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="eventId">Event ID</label>
            <div className="inline">
              <input id="eventId" value={eventId} onChange={(e) => setEventId(e.target.value)} />
              <button type="button" className="btn-secondary" onClick={() => setEventId(generateId('evt'))}>New event ID</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="type">Event type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              {meta.supportedEventTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="orderId">Order ID</label>
            <div className="inline">
              <input id="orderId" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
              <button type="button" className="btn-secondary" onClick={() => setOrderId(generateId('ord'))}>New order ID</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="venueId">Venue ID</label>
            <input id="venueId" value={venueId} onChange={(e) => setVenueId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {meta.supportedCurrencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <fieldset className="items">
          <legend>Line items</legend>
          <div className="item-head" aria-hidden="true">
            <span>Product ID</span><span>Quantity</span><span>Price each ({currency})</span><span />
          </div>
          {items.map((row, i) => (
            <div className="item-row" key={row.key}>
              <input aria-label={`Product ID, item ${i + 1}`} value={row.productId} onChange={(e) => updateItem(row.key, { productId: e.target.value })} />
              <input aria-label={`Quantity, item ${i + 1}`} inputMode="numeric" value={row.quantity} onChange={(e) => updateItem(row.key, { quantity: e.target.value })} />
              <input aria-label={`Price each, item ${i + 1}`} inputMode="decimal" placeholder={digits ? `0.${'0'.repeat(digits)}` : '0'} value={row.price} onChange={(e) => updateItem(row.key, { price: e.target.value })} />
              <button type="button" className="btn-ghost" aria-label={`Remove item ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((r) => r.key !== row.key))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setItems((rows) => [...rows, newRow()])}>Add item</button>
        </fieldset>

        <div className="field total-field">
          <label htmlFor="total">Order total ({currency})</label>
          <div className="inline">
            <input id="total" inputMode="decimal" value={shownTotal} onChange={(e) => { setTotalEdited(true); setTotalText(e.target.value); }} aria-describedby="total-hint" />
            {totalEdited && <button type="button" className="btn-ghost" onClick={() => setTotalEdited(false)}>Use calculated</button>}
          </div>
          <p id="total-hint" className={totalMismatch ? 'hint warn' : 'hint'}>
            {calculatedTotal === null
              ? 'Fill in quantity and price for every item to calculate the total.'
              : totalMismatch
                ? `Calculated total is ${formatMoney(calculatedTotal, currency)}. The backend will reject this mismatch.`
                : `Calculated from items: ${formatMoney(calculatedTotal, currency)}. Edit it to test an invalid total.`}
          </p>
        </div>

        {fieldErrors.length > 0 && (
          <Alert kind="error" title="Check these fields">
            <ul>{fieldErrors.map((m) => <li key={m}>{m}</li>)}</ul>
          </Alert>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send payment event'}
          </button>
          {submitting && <span className="spinner" role="status" aria-label="Sending payment event" />}
        </div>
      </form>

      {outcome?.kind === 'success' && <SuccessMessage result={outcome.result} />}
      {outcome?.kind === 'error' && (
        <Alert kind="error" title={outcome.message}>
          {outcome.details.length > 0 && <ul>{outcome.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </Alert>
      )}
    </section>
  );
}

function SuccessMessage({ result }: { result: SubmitResult }) {
  const { order, duplicate } = result;
  if (duplicate) {
    return (
      <Alert kind="info" title={`Duplicate: order ${order.id} was already recorded`}>
        Nothing was created and the POS was not called again. POS status: {order.pos.status.toLowerCase()}.
      </Alert>
    );
  }
  if (order.pos.status === 'FAILED') {
    return (
      <Alert kind="warning" title={`Payment recorded for ${order.id}, but POS sync failed`}>
        The order is safe and marked as paid. Use “Retry POS sync” in the order panel.
      </Alert>
    );
  }
  return <Alert kind="success" title={`Payment recorded and synced to the POS for ${order.id}`} />;
}
