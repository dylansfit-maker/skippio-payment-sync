import request from 'supertest';
import type { Express } from 'express';
import { InMemoryKeyedLock } from '../src/concurrency/KeyedLock';
import { createApp } from '../src/http/app';
import type { PosAcceptance, PosAdapter, PosOrderPayload } from '../src/pos/PosAdapter';
import { SimulatedPos, failFirstAttempts } from '../src/pos/SimulatedPos';
import { OrderService } from '../src/services/OrderService';
import { InMemoryOrderRepository } from '../src/storage/OrderRepository';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a POS so tests can hold calls "in flight". While closed, submitOrder
 * blocks, which guarantees a second request arrives DURING the first POS call.
 */
export class GatedPos implements PosAdapter {
  calls = 0;
  inFlight = 0;
  maxInFlight = 0;
  private closed = false;
  private waiters: (() => void)[] = [];

  constructor(private readonly inner: PosAdapter) {}

  close() {
    this.closed = true;
  }

  open() {
    this.closed = false;
    this.waiters.splice(0).forEach((release) => release());
  }

  async waitForCalls(n: number, timeoutMs = 2000) {
    const start = Date.now();
    while (this.calls < n) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${n} POS call(s); saw ${this.calls}`);
      await sleep(2);
    }
  }

  async submitOrder(payload: PosOrderPayload): Promise<PosAcceptance> {
    this.calls++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.closed) await new Promise<void>((resolve) => this.waiters.push(resolve));
      return await this.inner.submitOrder(payload);
    } finally {
      this.inFlight--;
    }
  }
}

export function buildHarness(opts: { failFirstAttempts?: number } = {}) {
  const pos = new SimulatedPos({ failurePolicy: failFirstAttempts(opts.failFirstAttempts ?? 0), latencyMs: 0 });
  const gate = new GatedPos(pos);
  const orders = new OrderService({ orders: new InMemoryOrderRepository(), pos: gate, locks: new InMemoryKeyedLock() });
  const app = createApp({ orders, posInspector: pos });
  return { app, pos, gate };
}

export interface EventOverrides {
  eventId?: string;
  type?: string;
  order?: Record<string, unknown>;
}

export function makeEvent(overrides: EventOverrides = {}) {
  return {
    eventId: overrides.eventId ?? 'evt_001',
    type: overrides.type ?? 'payment.succeeded',
    order: {
      id: 'ord_001',
      venueId: 'venue_001',
      currency: 'EUR',
      items: [
        { productId: 'burger', quantity: 2, price: 1200 },
        { productId: 'water', quantity: 1, price: 250 },
      ],
      total: 2650,
      ...overrides.order,
    },
  };
}

export const postEvent = (app: Express, body: unknown) => request(app).post('/payment-events').send(body as object);
export const getOrder = (app: Express, id: string) => request(app).get(`/orders/${id}`);
export const syncOrder = (app: Express, id: string) => request(app).post(`/orders/${id}/sync`);
export const refundOrder = (app: Express, id: string) => request(app).post(`/orders/${id}/refund`);

/**
 * Repository that returns what it read only AFTER a delay, so concurrent callers all hold
 * stale state when they proceed to write. This is what makes check-then-act races observable.
 */
export class SlowRepository extends InMemoryOrderRepository {
  override async get(orderId: string) {
    const snapshot = await super.get(orderId);
    await sleep(5);
    return snapshot;
  }
}
