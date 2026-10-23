export interface OrderItem {
  productId: string;
  quantity: number;
  /** Cents, per item. */
  price: number;
}

export type PosStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface Order {
  id: string;
  venueId: string;
  currency: string;
  items: OrderItem[];
  total: number;
  payment: { status: 'PAID'; eventIds: string[]; paidAt: string };
  pos: { status: PosStatus; attempts: number; transactionRef: string | null; lastError: string | null; lastAttemptAt: string | null };
  refund: { status: 'NONE' | 'REFUNDED'; amount: number; refundedAt: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface PaymentEventPayload {
  eventId: string;
  type: string;
  order: { id: string; venueId: string; currency: string; items: OrderItem[]; total: number };
}

export interface Meta {
  supportedEventTypes: string[];
  supportedCurrencies: string[];
}

export interface PosTransaction {
  reference: string;
  orderReference: string;
  venueId: string;
  currency: string;
  total: number;
  items: { productId: string; quantity: number; unitPrice: number }[];
  acceptedAt: string;
}

export interface SubmitResult {
  duplicate: boolean;
  order: Order;
}

export interface SyncResult {
  /** True if a new POS call was made by this request. */
  attempted: boolean;
  order: Order;
  /** Present when the POS (still) failed. */
  error?: string;
}
