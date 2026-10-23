export interface Config {
  port: number;
  /** Simulated POS rejects this many initial attempts per order (0 disables failures). */
  posFailFirstAttempts: number;
  posLatencyMs: number;
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readInt(env, 'PORT', 3001, 1),
    posFailFirstAttempts: readInt(env, 'POS_FAIL_FIRST_ATTEMPTS', 1),
    posLatencyMs: readInt(env, 'POS_LATENCY_MS', 600),
  };
}
