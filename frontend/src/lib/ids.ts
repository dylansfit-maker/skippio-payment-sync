/** Short random identifier such as "ord_k3j9x2". Used only to pre-fill the form; the backend owns validation. */
export function generateId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
  return `${prefix}_${suffix}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
