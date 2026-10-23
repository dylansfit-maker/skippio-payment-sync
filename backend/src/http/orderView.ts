import type { OrderRecord } from '../domain/order';

/** Public representation of an order. Decouples the API shape from the storage shape. */
export function toOrderView(order: OrderRecord) {
  return {
    id: order.id,
    venueId: order.venueId,
    currency: order.currency,
    items: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
    total: order.total,
    payment: { status: order.payment.status, eventIds: [...order.payment.eventIds], paidAt: order.payment.paidAt },
    pos: {
      status: order.pos.status,
      attempts: order.pos.attempts,
      transactionRef: order.pos.transactionRef ?? null,
      lastError: order.pos.lastError ?? null,
      lastAttemptAt: order.pos.lastAttemptAt ?? null,
    },
    refund: { status: order.refund.status, amount: order.refund.amount, refundedAt: order.refund.refundedAt ?? null },
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
