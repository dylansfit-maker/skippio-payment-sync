import { useCallback, useEffect, useState } from 'react';
import { getMeta } from './api/client';
import type { Meta } from './api/types';
import { OrderLookup, type LookupRequest } from './components/OrderLookup';
import { PaymentEventForm } from './components/PaymentEventForm';
import { PosTransactions } from './components/PosTransactions';
import { Alert } from './components/Alert';
import { errorMessage } from './lib/ids';

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupRequest | null>(null);
  const [activity, setActivity] = useState(0);

  const loadMeta = useCallback(() => {
    setMetaError(null);
    getMeta().then(setMeta).catch((err) => setMetaError(errorMessage(err)));
  }, []);
  useEffect(loadMeta, [loadMeta]);

  // After a submission: show that order, and refresh the POS panel.
  const handleSubmitted = (orderId: string) => {
    setLookup((prev) => ({ orderId, nonce: (prev?.nonce ?? 0) + 1 }));
    setActivity((n) => n + 1);
  };

  return (
    <>
      <header className="app-header">
        <h1>Payment events & POS sync</h1>
        <p>Send a payment confirmation, watch it reach the simulated POS, and retry if it fails.</p>
      </header>
      <main className="layout">
        {metaError && (
          <div className="full">
            <Alert kind="error" title="Could not load backend configuration">
              <p>{metaError}</p>
              <button type="button" className="btn-secondary" onClick={loadMeta}>Try again</button>
            </Alert>
          </div>
        )}
        {!meta && !metaError && <p role="status">Loading…</p>}
        {meta && <PaymentEventForm meta={meta} onSubmitted={handleSubmitted} />}
        <div className="stack">
          <OrderLookup request={lookup} onActivity={() => setActivity((n) => n + 1)} />
          <PosTransactions refreshKey={activity} />
        </div>
      </main>
    </>
  );
}
