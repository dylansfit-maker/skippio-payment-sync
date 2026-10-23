import { describe, expect, it } from 'vitest';
import { InMemoryKeyedLock } from '../src/concurrency/KeyedLock';
import { SimulatedPos, failFirstAttempts } from '../src/pos/SimulatedPos';
import { OrderService } from '../src/services/OrderService';
import { SlowRepository, makeEvent } from './helpers';

/**
 * Calls the service directly (no HTTP staggering) with a slow repository so that
 * every caller reads state before any caller writes. Without the lock these fail.
 */
function buildService() {
  const pos = new SimulatedPos({ failurePolicy: failFirstAttempts(0), latencyMs: 5 });
  const service = new OrderService({ orders: new SlowRepository(), pos, locks: new InMemoryKeyedLock() });
  return { service, pos };
}

describe('race conditions at service level', () => {
  it('simultaneous payment events create one order and one POS transaction', async () => {
    const { service, pos } = buildService();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => service.receivePayment(makeEvent({ eventId: `evt_${i}` }))));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(pos.listTransactions()).toHaveLength(1);
  });

  it('simultaneous refunds refund exactly once', async () => {
    const { service } = buildService();
    await service.receivePayment(makeEvent());
    const results = await Promise.all(Array.from({ length: 10 }, () => service.refundOrder('ord_001')));
    expect(results.filter((r) => !r.alreadyRefunded)).toHaveLength(1);
    expect(new Set(results.map((r) => r.order.refund.refundedAt)).size).toBe(1);
  });

  it('a payment event racing a refund cannot reset the refund', async () => {
    const { service } = buildService();
    await service.receivePayment(makeEvent());
    await Promise.all([service.refundOrder('ord_001'), service.receivePayment(makeEvent({ eventId: 'evt_2' })), service.receivePayment(makeEvent())]);
    expect((await service.getOrder('ord_001')).refund).toMatchObject({ status: 'REFUNDED', amount: 2650 });
  });
});
