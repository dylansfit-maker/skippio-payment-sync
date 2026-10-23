import type { Meta, Order, PaymentEventPayload, PosTransaction, SubmitResult, SyncResult } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string[] = [],
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the backend. Check that it is running and try again.');
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    const details = Array.isArray(error?.details) ? error.details.map(String) : [];
    throw new ApiError(response.status, error?.code ?? 'HTTP_ERROR', error?.message ?? `Request failed (${response.status})`, details, body);
  }
  return body as T;
}

export const getMeta = () => request<Meta>('/meta');

export const submitPaymentEvent = (payload: PaymentEventPayload) =>
  request<SubmitResult>('/payment-events', { method: 'POST', body: JSON.stringify(payload) });

export const getOrder = async (orderId: string) => (await request<{ order: Order }>(`/orders/${encodeURIComponent(orderId)}`)).order;

/**
 * A failed POS attempt is an expected outcome, not an exception: the backend answers 502
 * and still returns the updated order, so we hand it back as a normal result.
 */
export async function syncOrder(orderId: string): Promise<SyncResult> {
  try {
    return await request<SyncResult>(`/orders/${encodeURIComponent(orderId)}/sync`, { method: 'POST' });
  } catch (err) {
    const body = err instanceof ApiError ? (err.body as { attempted?: boolean; order?: Order } | undefined) : undefined;
    if (err instanceof ApiError && err.code === 'POS_SYNC_FAILED' && body?.order) {
      return { attempted: Boolean(body.attempted), order: body.order, error: err.message };
    }
    throw err;
  }
}

export const listPosTransactions = async () => (await request<{ transactions: PosTransaction[] }>('/debug/pos-transactions')).transactions;
