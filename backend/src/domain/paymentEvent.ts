import { z } from 'zod';
import { ValidationError } from './errors';
import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_EVENT_TYPES,
  calculateTotal,
  type OrderDetails,
  type PaymentEventType,
} from './order';

const identifier = z.string({ required_error: 'is required', invalid_type_error: 'must be a string' }).trim().min(1, 'must not be empty');
const cents = z.number({ required_error: 'is required', invalid_type_error: 'must be a number' }).int('must be an integer (cents)').nonnegative('must not be negative').safe();

const itemSchema = z.object({
  productId: identifier,
  quantity: z.number({ required_error: 'is required', invalid_type_error: 'must be a number' }).int('must be an integer').positive('must be greater than 0').safe(),
  price: cents,
});

const orderSchema = z
  .object({
    id: identifier,
    venueId: identifier,
    currency: z.enum(SUPPORTED_CURRENCIES, { errorMap: () => ({ message: `must be one of: ${SUPPORTED_CURRENCIES.join(', ')}` }) }),
    items: z.array(itemSchema, { required_error: 'is required' }).min(1, 'must contain at least one item'),
    total: cents,
  })
  .superRefine((order, ctx) => {
    const calculated = calculateTotal(order.items);
    if (!Number.isSafeInteger(calculated) || calculated !== order.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: `does not match the calculated total of ${calculated}`,
      });
    }
  });

const paymentEventSchema = z.object({
  eventId: identifier,
  type: z.enum(SUPPORTED_EVENT_TYPES, { errorMap: () => ({ message: `unsupported event type; supported: ${SUPPORTED_EVENT_TYPES.join(', ')}` }) }),
  order: orderSchema,
});

export interface PaymentEvent {
  eventId: string;
  type: PaymentEventType;
  order: OrderDetails;
}

function formatPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part), '');
}

/** Validates untrusted input. Throws ValidationError listing every problem found. */
export function parsePaymentEvent(input: unknown): PaymentEvent {
  const result = paymentEventSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${formatPath(i.path) || 'body'}: ${i.message}`));
  }
  return result.data;
}
