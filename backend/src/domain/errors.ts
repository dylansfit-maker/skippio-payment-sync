/** Errors that map to a client-visible HTTP response. Anything else is a 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: string[]) {
    super(400, 'VALIDATION_ERROR', 'The payment event is invalid', details);
  }
}

export class NotFoundError extends AppError {
  constructor(orderId: string) {
    super(404, 'ORDER_NOT_FOUND', `Order ${orderId} was not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}
