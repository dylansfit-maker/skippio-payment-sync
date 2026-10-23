import express, { type Express } from 'express';
import { SUPPORTED_CURRENCIES, SUPPORTED_EVENT_TYPES } from '../domain/order';
import type { PosInspector } from '../pos/PosAdapter';
import type { OrderService } from '../services/OrderService';
import { errorHandler, notFoundHandler } from './errorHandler';
import { toOrderView } from './orderView';

export interface AppDeps {
  orders: OrderService;
  /** Optional: exposes the POS's accepted transactions on a debug endpoint. */
  posInspector?: PosInspector;
}

export function createApp({ orders, posInspector }: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Lets clients (the UI) discover what is supported instead of hard-coding it.
  app.get('/meta', (_req, res) => {
    res.json({ supportedEventTypes: SUPPORTED_EVENT_TYPES, supportedCurrencies: SUPPORTED_CURRENCIES });
  });

  // 201 = new order recorded (POS outcome is in order.pos). 200 = duplicate, nothing created.
  app.post('/payment-events', async (req, res) => {
    const { order, duplicate } = await orders.receivePayment(req.body);
    res.status(duplicate ? 200 : 201).json({ duplicate, order: toOrderView(order) });
  });

  app.get('/orders/:orderId', async (req, res) => {
    res.json({ order: toOrderView(await orders.getOrder(req.params.orderId)) });
  });

  // 200 = order is synced. 502 = a POS attempt (ours or an overlapping one) failed; order is returned either way.
  app.post('/orders/:orderId/sync', async (req, res) => {
    const { order, attempted } = await orders.syncOrder(req.params.orderId);
    const view = toOrderView(order);
    if (order.pos.status === 'SYNCED') {
      res.status(200).json({ attempted, order: view });
    } else {
      res.status(502).json({
        attempted,
        order: view,
        error: { code: 'POS_SYNC_FAILED', message: order.pos.lastError ?? 'POS synchronisation did not complete' },
      });
    }
  });

  // Idempotent: a repeat returns 200 with alreadyRefunded=true and the original refund.
  app.post('/orders/:orderId/refund', async (req, res) => {
    const { order, alreadyRefunded } = await orders.refundOrder(req.params.orderId);
    res.status(200).json({ alreadyRefunded, order: toOrderView(order) });
  });

  if (posInspector) {
    app.get('/debug/pos-transactions', (_req, res) => {
      res.json({ transactions: posInspector.listTransactions() });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
