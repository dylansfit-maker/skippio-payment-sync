import type { OrderRecord } from '../domain/order';

/**
 * Persistence port. Deliberately tiny. Atomicity of read-modify-write is the
 * responsibility of the KeyedLock, not of the repository, so a SQL
 * implementation can be dropped in without changing the service.
 */
export interface OrderRepository {
  get(orderId: string): Promise<OrderRecord | undefined>;
  save(order: OrderRecord): Promise<void>;
}

/** Stores copies so callers can never mutate stored state by accident. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, OrderRecord>();

  async get(orderId: string): Promise<OrderRecord | undefined> {
    const stored = this.orders.get(orderId);
    return stored ? structuredClone(stored) : undefined;
  }

  async save(order: OrderRecord): Promise<void> {
    this.orders.set(order.id, structuredClone(order));
  }
}
