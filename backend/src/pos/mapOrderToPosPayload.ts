import type { OrderDetails } from '../domain/order';
import type { PosOrderPayload } from './PosAdapter';

/** Domain order -> generic POS payload. A vendor adapter can map further from here. */
export function mapOrderToPosPayload(order: OrderDetails): PosOrderPayload {
  return {
    venueId: order.venueId,
    orderReference: order.id,
    currency: order.currency,
    total: order.total,
    items: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.price })),
  };
}
