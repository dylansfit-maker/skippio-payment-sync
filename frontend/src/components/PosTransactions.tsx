import { useCallback, useEffect, useState } from 'react';
import { listPosTransactions } from '../api/client';
import type { PosTransaction } from '../api/types';
import { errorMessage } from '../lib/ids';
import { formatMoney } from '../lib/money';
import { Alert } from './Alert';

/** Debug view of what the simulated POS has accepted: proves no duplicate transactions were created. */
export function PosTransactions({ refreshKey }: { refreshKey: number }) {
  const [transactions, setTransactions] = useState<PosTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTransactions(await listPosTransactions());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="card" aria-labelledby="pos-title">
      <div className="details-head">
        <h2 id="pos-title">Simulated POS transactions</h2>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {error && <Alert kind="error" title={error} />}
      {transactions && transactions.length === 0 && <p className="empty">The POS has not accepted any orders yet.</p>}
      {transactions && transactions.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Reference</th><th>Order</th><th className="num">Items</th><th className="num">Total</th></tr></thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.reference}>
                  <td>{t.reference}</td>
                  <td>{t.orderReference}</td>
                  <td className="num">{t.items.reduce((n, i) => n + i.quantity, 0)}</td>
                  <td className="num">{formatMoney(t.total, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
