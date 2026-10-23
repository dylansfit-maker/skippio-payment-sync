import { PosError, type PosAcceptance, type PosAdapter, type PosInspector, type PosOrderPayload, type PosTransaction } from './PosAdapter';

export interface FailureContext {
  orderReference: string;
  /** 1-based count of calls this POS has received for this order reference. */
  attempt: number;
}

/** Decides, deterministically, whether a call should be rejected. */
export interface FailurePolicy {
  shouldFail(ctx: FailureContext): boolean;
}

/** Rejects the first `n` attempts of every order, then accepts. n = 0 never fails. */
export const failFirstAttempts = (n: number): FailurePolicy => ({
  shouldFail: ({ attempt }) => attempt <= n,
});

export interface SimulatedPosOptions {
  failurePolicy: FailurePolicy;
  /** Artificial latency per call. Makes overlapping requests possible and UI spinners visible. */
  latencyMs: number;
  now?: () => Date;
}

/**
 * Fake POS. Keeps its own transaction list, separate from order records, so a
 * duplicate side effect would be visible. It intentionally does NOT
 * deduplicate: duplicate prevention is the service's job and tests prove it.
 */
export class SimulatedPos implements PosAdapter, PosInspector {
  private readonly attempts = new Map<string, number>();
  private readonly transactions: PosTransaction[] = [];
  private sequence = 0;
  private readonly now: () => Date;

  constructor(private readonly options: SimulatedPosOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async submitOrder(payload: PosOrderPayload): Promise<PosAcceptance> {
    const attempt = (this.attempts.get(payload.orderReference) ?? 0) + 1;
    this.attempts.set(payload.orderReference, attempt);

    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }

    if (this.options.failurePolicy.shouldFail({ orderReference: payload.orderReference, attempt })) {
      throw new PosError('POS is temporarily unavailable (simulated failure)');
    }

    const reference = `pos_txn_${String(++this.sequence).padStart(6, '0')}`;
    this.transactions.push({ ...structuredClone(payload), reference, acceptedAt: this.now().toISOString() });
    return { transactionRef: reference };
  }

  listTransactions(): PosTransaction[] {
    return structuredClone(this.transactions);
  }
}
