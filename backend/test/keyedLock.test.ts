import { describe, expect, it } from 'vitest';
import { InMemoryKeyedLock } from '../src/concurrency/KeyedLock';
import { sleep } from './helpers';

describe('InMemoryKeyedLock', () => {
  it('runs tasks for the same key one at a time, in arrival order', async () => {
    const lock = new InMemoryKeyedLock();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await sleep(ms);
      log.push(`${name}:end`);
    };
    await Promise.all([lock.runExclusive('k', task('a', 20)), lock.runExclusive('k', task('b', 1)), lock.runExclusive('k', task('c', 1))]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('does not block different keys', async () => {
    const lock = new InMemoryKeyedLock();
    let running = 0;
    let max = 0;
    const task = async () => {
      max = Math.max(max, ++running);
      await sleep(20);
      running--;
    };
    await Promise.all([lock.runExclusive('a', task), lock.runExclusive('b', task)]);
    expect(max).toBe(2);
  });

  it('releases the lock when a task throws, and propagates the error', async () => {
    const lock = new InMemoryKeyedLock();
    await expect(lock.runExclusive('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock.runExclusive('k', async () => 'ok')).resolves.toBe('ok');
  });
});
