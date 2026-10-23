import { InMemoryKeyedLock } from './concurrency/KeyedLock';
import { loadConfig } from './config';
import { createApp } from './http/app';
import { SimulatedPos, failFirstAttempts } from './pos/SimulatedPos';
import { OrderService } from './services/OrderService';
import { InMemoryOrderRepository } from './storage/OrderRepository';

// Composition root: the only place that picks concrete implementations.
const config = loadConfig();
const pos = new SimulatedPos({ failurePolicy: failFirstAttempts(config.posFailFirstAttempts), latencyMs: config.posLatencyMs });
const orders = new OrderService({ orders: new InMemoryOrderRepository(), pos, locks: new InMemoryKeyedLock() });

createApp({ orders, posInspector: pos }).listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
  console.log(`Simulated POS: fails first ${config.posFailFirstAttempts} attempt(s) per order, ${config.posLatencyMs}ms latency`);
});
