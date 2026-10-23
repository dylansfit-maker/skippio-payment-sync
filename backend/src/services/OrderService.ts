import type { KeyedLock } from '../concurrency/KeyedLock';
import { ConflictError, NotFoundError } from '../domain/errors';
import { describeOrderDifferences, type OrderRecord } from '../domain/order';
import { parsePaymentEvent, type PaymentEvent } from '../domain/paymentEvent';
import type { PosAdapter } from '../pos/PosAdapter';
import { mapOrderToPosPayload } from '../pos/mapOrderToPosPayload';
import type { OrderRepository } from '../storage/OrderRepository';

export interface OrderServiceDeps {
  orders: OrderRepository;
  pos: PosAdapter;
  locks: KeyedLock;
  now?: () => Date;
}

export interface ReceivePaymentResult {
  order: OrderRecord;
  /** True when the order already existed; nothing was created and the POS was not called. */
  duplicate: boolean;
}

export interface SyncResult {
  order: OrderRecord;
  /** False when no new POS call was made (already synced, or an overlapping request did the work). */
  attempted: boolean;
}

export interface RefundResult {
  order: OrderRecord;
  /** True when the order had already been refunded; nothing changed. */
  alreadyRefunded: boolean;
}

/**
 * Application logic. Every operation that touches an order runs inside the
 * same per-order lock key, so receive / sync / refund for one order never interleave.
 */
export class OrderService {
  private readonly now: () => Date;

  constructor(private readonly deps: OrderServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private lockKey(orderId: string): string {
    return `order:${orderId}`;
  }

  async receivePayment(input: unknown): Promise<ReceivePaymentResult> {
    const event = parsePaymentEvent(input);
    return this.deps.locks.runExclusive(this.lockKey(event.order.id), async () => {
      const existing = await this.deps.orders.get(event.order.id);

      if (existing) {
        const differences = describeOrderDifferences(existing, event.order);
        if (differences.length > 0) {
          throw new ConflictError('ORDER_CONFLICT', `Order ${existing.id} already exists with different data`, differences);
        }
        // Same order, possibly a new event id: remember it, but never touch POS or refund state.
        if (!existing.payment.eventIds.includes(event.eventId)) {
          existing.payment.eventIds.push(event.eventId);
          existing.updatedAt = this.timestamp();
          await this.deps.orders.save(existing);
        }
        return { order: existing, duplicate: true };
      }

      const order = this.createPaidOrder(event);
      await this.deps.orders.save(order); // payment is durable before we talk to the POS
      await this.attemptPosSync(order);
      return { order, duplicate: false };
    });
  }

  async getOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.deps.orders.get(orderId);
    if (!order) throw new NotFoundError(orderId);
    return order;
  }

  async syncOrder(orderId: string): Promise<SyncResult> {
    // Snapshot before queueing so we can tell if an overlapping request did the work while we waited.
    const before = await this.getOrder(orderId);
    const completedAttemptsSeen = before.pos.status === 'SYNCING' ? before.pos.attempts - 1 : before.pos.attempts;

    return this.deps.locks.runExclusive(this.lockKey(orderId), async () => {
      const order = await this.getOrder(orderId);
      if (order.pos.status === 'SYNCED') return { order, attempted: false };
      if (order.pos.attempts > completedAttemptsSeen) return { order, attempted: false };

      await this.attemptPosSync(order);
      return { order, attempted: true };
    });
  }

  async refundOrder(orderId: string): Promise<RefundResult> {
    return this.deps.locks.runExclusive(this.lockKey(orderId), async () => {
      const order = await this.getOrder(orderId);

      if (order.refund.status === 'REFUNDED') return { order, alreadyRefunded: true };
      if (order.pos.status !== 'SYNCED') {
        throw new ConflictError(
          'REFUND_NOT_ELIGIBLE',
          `Order ${orderId} cannot be refunded until it has been synchronised with the POS (current POS status: ${order.pos.status})`,
        );
      }

      const refundedAt = this.timestamp();
      order.refund = { status: 'REFUNDED', amount: order.total, refundedAt };
      order.updatedAt = refundedAt;
      await this.deps.orders.save(order);
      return { order, alreadyRefunded: false };
    });
  }

  private createPaidOrder(event: PaymentEvent): OrderRecord {
    const ts = this.timestamp();
    return {
      ...event.order,
      items: event.order.items.map((i) => ({ ...i })),
      payment: { status: 'PAID', eventIds: [event.eventId], paidAt: ts },
      pos: { status: 'PENDING', attempts: 0 },
      refund: { status: 'NONE', amount: 0 },
      createdAt: ts,
      updatedAt: ts,
    };
  }

  /** Must be called while holding the order's lock. Mutates and persists `order`. */
  private async attemptPosSync(order: OrderRecord): Promise<void> {
    order.pos.status = 'SYNCING';
    order.pos.attempts += 1;
    order.pos.lastAttemptAt = this.timestamp();
    await this.deps.orders.save(order);

    try {
      const acceptance = await this.deps.pos.submitOrder(mapOrderToPosPayload(order));
      order.pos.status = 'SYNCED';
      order.pos.transactionRef = acceptance.transactionRef;
      delete order.pos.lastError;
    } catch (err) {
      // Any failure is treated as "not accepted": payment stays PAID and the order stays retryable.
      order.pos.status = 'FAILED';
      order.pos.lastError = err instanceof Error ? err.message : 'Unknown POS error';
    }
    order.updatedAt = this.timestamp();
    await this.deps.orders.save(order);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
