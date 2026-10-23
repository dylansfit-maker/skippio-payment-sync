/**
 * Core domain types. All monetary values are integer minor units (cents).
 * Nothing in here knows about HTTP, storage or the POS vendor.
 */
export const SUPPORTED_CURRENCIES = ['EUR'] as const;
export const SUPPORTED_EVENT_TYPES = ['payment.succeeded'] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export type PaymentEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

export interface OrderItem {
  productId: string;
  quantity: number;
  /** Price per single item, in cents. */
  price: number;
}

/** The business data of an order, as supplied by the payment event. */
export interface OrderDetails {
  id: string;
  venueId: string;
  currency: Currency;
  items: OrderItem[];
  /** Order total in cents. */
  total: number;
}

/**
 * PENDING  - recorded, no POS attempt yet
 * SYNCING  - a POS attempt is in flight
 * SYNCED   - POS accepted; transactionRef is set
 * FAILED   - last POS attempt failed; can be retried
 */
export type PosSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface OrderRecord extends OrderDetails {
  payment: {
    status: 'PAID';
    /** Every distinct event id that has confirmed this order. */
    eventIds: string[];
    paidAt: string;
  };
  pos: {
    status: PosSyncStatus;
    attempts: number;
    transactionRef?: string;
    lastError?: string;
    lastAttemptAt?: string;
  };
  refund: {
    status: 'NONE' | 'REFUNDED';
    /** Refunded amount in cents (0 until refunded). */
    amount: number;
    refundedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export function calculateTotal(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

/**
 * Compares two orders field by field (items in supplied order) and returns a
 * human-readable list of differences. Empty list = identical order data.
 */
export function describeOrderDifferences(existing: OrderDetails, incoming: OrderDetails): string[] {
  const diffs: string[] = [];
  const check = (field: string, a: unknown, b: unknown) => {
    if (a !== b) diffs.push(`${field}: existing ${JSON.stringify(a)}, received ${JSON.stringify(b)}`);
  };

  check('venueId', existing.venueId, incoming.venueId);
  check('currency', existing.currency, incoming.currency);
  check('total', existing.total, incoming.total);
  check('items.length', existing.items.length, incoming.items.length);

  const common = Math.min(existing.items.length, incoming.items.length);
  for (let i = 0; i < common; i++) {
    const a = existing.items[i]!;
    const b = incoming.items[i]!;
    check(`items[${i}].productId`, a.productId, b.productId);
    check(`items[${i}].quantity`, a.quantity, b.quantity);
    check(`items[${i}].price`, a.price, b.price);
  }
  return diffs;
}
