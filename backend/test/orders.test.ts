import { describe, expect, it } from 'vitest';
import { buildHarness, getOrder, makeEvent, postEvent, refundOrder, sleep, syncOrder } from './helpers';

describe('1. valid payment event', () => {
  it('records a paid order and sends exactly one transaction to the POS', async () => {
    const { app, pos } = buildHarness();
    const res = await postEvent(app, makeEvent());

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.order).toMatchObject({
      id: 'ord_001',
      total: 2650,
      payment: { status: 'PAID', eventIds: ['evt_001'] },
      pos: { status: 'SYNCED', attempts: 1, transactionRef: 'pos_txn_000001' },
      refund: { status: 'NONE', amount: 0 },
    });

    const txns = pos.listTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      reference: 'pos_txn_000001',
      venueId: 'venue_001',
      orderReference: 'ord_001',
      currency: 'EUR',
      total: 2650,
      items: [
        { productId: 'burger', quantity: 2, unitPrice: 1200 },
        { productId: 'water', quantity: 1, unitPrice: 250 },
      ],
    });
  });

  it('is retrievable via GET /orders/:id and 404s for unknown orders', async () => {
    const { app } = buildHarness();
    await postEvent(app, makeEvent());
    expect((await getOrder(app, 'ord_001')).body.order.pos.transactionRef).toBe('pos_txn_000001');

    const missing = await getOrder(app, 'nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('2. duplicate delivery', () => {
  it('same event delivered twice -> one POS transaction', async () => {
    const { app, pos } = buildHarness();
    const first = await postEvent(app, makeEvent());
    const second = await postEvent(app, makeEvent());

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.order.pos.transactionRef).toBe(first.body.order.pos.transactionRef);
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('different event id for the same order -> one POS transaction, event id remembered', async () => {
    const { app, pos } = buildHarness();
    await postEvent(app, makeEvent({ eventId: 'evt_001' }));
    const second = await postEvent(app, makeEvent({ eventId: 'evt_002' }));

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.order.payment.eventIds).toEqual(['evt_001', 'evt_002']);
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('a duplicate does NOT trigger a POS retry for a failed order', async () => {
    const { app, pos, gate } = buildHarness({ failFirstAttempts: 1 });
    await postEvent(app, makeEvent());
    const dup = await postEvent(app, makeEvent({ eventId: 'evt_002' }));
    expect(dup.body.order.pos).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(gate.calls).toBe(1);
    expect(pos.listTransactions()).toHaveLength(0);
  });
});

describe('3. overlapping requests', () => {
  it('concurrent deliveries (different event ids) while the POS call is in flight -> one transaction', async () => {
    const { app, pos, gate } = buildHarness();
    gate.close();

    const first = postEvent(app, makeEvent({ eventId: 'evt_a' })).then((r) => r);
    await gate.waitForCalls(1); // request 1 is now inside the POS call
    const second = postEvent(app, makeEvent({ eventId: 'evt_b' })).then((r) => r); // arrives during it
    await sleep(50); // give request 2 time to reach the lock
    expect(gate.calls).toBe(1); // request 2 has not reached the POS
    gate.open();

    const [r1, r2] = await Promise.all([first, second]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(gate.maxInFlight).toBe(1);
    expect(pos.listTransactions()).toHaveLength(1);
    expect((await getOrder(app, 'ord_001')).body.order.payment.eventIds.sort()).toEqual(['evt_a', 'evt_b']);
  });

  it('many simultaneous identical deliveries -> one transaction', async () => {
    const { app, pos } = buildHarness();
    const results = await Promise.all(Array.from({ length: 8 }, () => postEvent(app, makeEvent()).then((r) => r)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('overlapping retries of a failed order -> a single extra attempt, a single transaction', async () => {
    const { app, pos, gate } = buildHarness({ failFirstAttempts: 1 });
    await postEvent(app, makeEvent()); // attempt 1 fails
    gate.close();

    const s1 = syncOrder(app, 'ord_001').then((r) => r);
    await gate.waitForCalls(2); // retry 1 is in flight
    const s2 = syncOrder(app, 'ord_001').then((r) => r);
    await sleep(50);
    gate.open();

    const [r1, r2] = await Promise.all([s1, s2]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.attempted, r2.body.attempted].sort()).toEqual([false, true]);
    expect(gate.calls).toBe(2);
    expect(pos.listTransactions()).toHaveLength(1);
    expect((await getOrder(app, 'ord_001')).body.order.pos.attempts).toBe(2);
  });

  it('overlapping retries that both would fail -> only one attempt is made', async () => {
    const { app, gate } = buildHarness({ failFirstAttempts: 2 });
    await postEvent(app, makeEvent());
    gate.close();

    const s1 = syncOrder(app, 'ord_001').then((r) => r);
    await gate.waitForCalls(2);
    const s2 = syncOrder(app, 'ord_001').then((r) => r);
    await sleep(50);
    gate.open();

    const [r1, r2] = await Promise.all([s1, s2]);
    expect([r1.status, r2.status]).toEqual([502, 502]);
    expect([r1.body.attempted, r2.body.attempted].sort()).toEqual([false, true]);
    expect(gate.calls).toBe(2);
  });
});

describe('4. POS failure and retry', () => {
  it('keeps the payment, allows retry, and a retry after success creates nothing new', async () => {
    const { app, pos } = buildHarness({ failFirstAttempts: 1 });

    const created = await postEvent(app, makeEvent());
    expect(created.status).toBe(201); // payment was recorded even though the POS failed
    expect(created.body.order.payment.status).toBe('PAID');
    expect(created.body.order.pos).toMatchObject({ status: 'FAILED', attempts: 1, transactionRef: null });
    expect(created.body.order.pos.lastError).toMatch(/POS/);
    expect(pos.listTransactions()).toHaveLength(0);

    const retry = await syncOrder(app, 'ord_001');
    expect(retry.status).toBe(200);
    expect(retry.body.attempted).toBe(true);
    expect(retry.body.order.pos).toMatchObject({ status: 'SYNCED', attempts: 2, transactionRef: 'pos_txn_000001', lastError: null });
    expect(retry.body.order.payment.status).toBe('PAID');
    expect(pos.listTransactions()).toHaveLength(1);

    const again = await syncOrder(app, 'ord_001');
    expect(again.status).toBe(200);
    expect(again.body.attempted).toBe(false);
    expect(again.body.order.pos.attempts).toBe(2);
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('returns 502 with the order when a retry fails again, and stays retryable', async () => {
    const { app, pos } = buildHarness({ failFirstAttempts: 2 });
    await postEvent(app, makeEvent());
    const failed = await syncOrder(app, 'ord_001');
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('POS_SYNC_FAILED');
    expect(failed.body.order.pos).toMatchObject({ status: 'FAILED', attempts: 2 });

    expect((await syncOrder(app, 'ord_001')).status).toBe(200);
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('404s when syncing an unknown order', async () => {
    const { app, gate } = buildHarness();
    const res = await syncOrder(app, 'nope');
    expect(res.status).toBe(404);
    expect(gate.calls).toBe(0);
  });
});

describe('5. invalid and conflicting data', () => {
  const invalid: [string, ReturnType<typeof makeEvent>][] = [
    ['empty eventId', makeEvent({ eventId: '  ' })],
    ['empty order id', makeEvent({ order: { id: '' } })],
    ['empty venueId', makeEvent({ order: { venueId: '' } })],
    ['empty productId', makeEvent({ order: { items: [{ productId: '', quantity: 1, price: 100 }], total: 100 } })],
    ['no items', makeEvent({ order: { items: [], total: 0 } })],
    ['zero quantity', makeEvent({ order: { items: [{ productId: 'a', quantity: 0, price: 100 }], total: 0 } })],
    ['fractional quantity', makeEvent({ order: { items: [{ productId: 'a', quantity: 1.5, price: 100 }], total: 150 } })],
    ['negative price', makeEvent({ order: { items: [{ productId: 'a', quantity: 1, price: -100 }], total: -100 } })],
    ['fractional price', makeEvent({ order: { items: [{ productId: 'a', quantity: 1, price: 10.5 }], total: 10.5 } })],
    ['wrong total', makeEvent({ order: { total: 2651 } })],
    ['unsupported currency', makeEvent({ order: { currency: 'USD' } })],
    ['unsupported event type', makeEvent({ type: 'payment.failed' })],
  ];

  it.each(invalid)('rejects %s with 400 and creates nothing', async (_name, event) => {
    const { app, gate } = buildHarness();
    const res = await postEvent(app, event);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect((await getOrder(app, event.order.id as string)).status).toBe(404);
    expect(gate.calls).toBe(0);
  });

  it('reports a mismatched total clearly', async () => {
    const { app } = buildHarness();
    const res = await postEvent(app, makeEvent({ order: { total: 1 } }));
    expect(res.body.error.details).toContain('order.total: does not match the calculated total of 2650');
  });

  it('rejects malformed JSON and a missing body with 400', async () => {
    const { app } = buildHarness();
    const bad = await postEvent(app, '{not json');
    expect(bad.status).toBe(400);
    const none = await postEvent(app, undefined);
    expect(none.status).toBe(400);
  });

  it('rejects conflicting data for an existing order and leaves order + POS untouched', async () => {
    const { app, pos } = buildHarness();
    await postEvent(app, makeEvent());
    const before = (await getOrder(app, 'ord_001')).body;
    const txnsBefore = pos.listTransactions();

    const conflicts = [
      makeEvent({ eventId: 'evt_x', order: { venueId: 'venue_999' } }),
      makeEvent({ eventId: 'evt_x', order: { items: [{ productId: 'burger', quantity: 3, price: 1200 }, { productId: 'water', quantity: 1, price: 250 }], total: 3850 } }),
      // same lines, different order -> conflict (items compared in supplied order)
      makeEvent({ eventId: 'evt_x', order: { items: [{ productId: 'water', quantity: 1, price: 250 }, { productId: 'burger', quantity: 2, price: 1200 }] } }),
    ];
    for (const event of conflicts) {
      const res = await postEvent(app, event);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_CONFLICT');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    }

    expect((await getOrder(app, 'ord_001')).body).toEqual(before); // incl. eventIds and updatedAt
    expect(pos.listTransactions()).toEqual(txnsBefore);
  });
});

describe('6. refunds', () => {
  it('fully refunds a synced order and shows it in lookup', async () => {
    const { app } = buildHarness();
    await postEvent(app, makeEvent());

    const res = await refundOrder(app, 'ord_001');
    expect(res.status).toBe(200);
    expect(res.body.alreadyRefunded).toBe(false);
    expect(res.body.order.refund).toMatchObject({ status: 'REFUNDED', amount: 2650 });
    expect(res.body.order.payment.status).toBe('PAID');

    expect((await getOrder(app, 'ord_001')).body.order.refund).toMatchObject({ status: 'REFUNDED', amount: 2650 });
  });

  it('a repeated refund does not refund twice and returns the original refund', async () => {
    const { app } = buildHarness();
    await postEvent(app, makeEvent());
    const first = await refundOrder(app, 'ord_001');
    const second = await refundOrder(app, 'ord_001');

    expect(second.status).toBe(200);
    expect(second.body.alreadyRefunded).toBe(true);
    expect(second.body.order.refund).toEqual(first.body.order.refund);
  });

  it('concurrent refund requests refund exactly once', async () => {
    const { app } = buildHarness();
    await postEvent(app, makeEvent());
    const results = await Promise.all(Array.from({ length: 6 }, () => refundOrder(app, 'ord_001').then((r) => r)));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.alreadyRefunded === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.order.refund.refundedAt)).size).toBe(1);
    expect(results.every((r) => r.body.order.refund.amount === 2650)).toBe(true);
  });

  it('repeated payment events preserve the refunded status', async () => {
    const { app, pos } = buildHarness();
    await postEvent(app, makeEvent());
    const refunded = await refundOrder(app, 'ord_001');

    const dupSame = await postEvent(app, makeEvent());
    const dupNewId = await postEvent(app, makeEvent({ eventId: 'evt_002' }));
    expect(dupSame.body.order.refund).toEqual(refunded.body.order.refund);
    expect(dupNewId.body.order.refund).toEqual(refunded.body.order.refund);
    expect((await getOrder(app, 'ord_001')).body.order.refund.status).toBe('REFUNDED');
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('rejects unknown orders (404)', async () => {
    const { app } = buildHarness();
    expect((await refundOrder(app, 'nope')).status).toBe(404);
  });

  it('rejects orders that are not synced with the POS (409) and leaves them unchanged', async () => {
    const { app } = buildHarness({ failFirstAttempts: 1 });
    await postEvent(app, makeEvent());
    const before = (await getOrder(app, 'ord_001')).body;

    const res = await refundOrder(app, 'ord_001');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REFUND_NOT_ELIGIBLE');
    expect((await getOrder(app, 'ord_001')).body).toEqual(before);

    // once synced, it becomes eligible
    await syncOrder(app, 'ord_001');
    expect((await refundOrder(app, 'ord_001')).status).toBe(200);
  });
});
