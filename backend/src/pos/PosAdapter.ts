import type { Currency } from '../domain/order';

/** What we send to a POS. Vendor-specific mapping lives in the adapter's own module. */
export interface PosOrderPayload {
  venueId: string;
  /** Our order id, used by the POS as the external reference. */
  orderReference: string;
  currency: Currency;
  /** Cents. */
  total: number;
  items: { productId: string; quantity: number; unitPrice: number }[];
}

export interface PosAcceptance {
  transactionRef: string;
}

/** Thrown by an adapter when the POS did not accept the order. Safe to retry. */
export class PosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PosError';
  }
}

/** Port implemented by every POS integration (simulated or real). */
export interface PosAdapter {
  submitOrder(payload: PosOrderPayload): Promise<PosAcceptance>;
}

/** Optional read-only view of what a POS has accepted. Used by debug endpoint and tests. */
export interface PosTransaction extends PosOrderPayload {
  reference: string;
  acceptedAt: string;
}

export interface PosInspector {
  listTransactions(): PosTransaction[];
}
