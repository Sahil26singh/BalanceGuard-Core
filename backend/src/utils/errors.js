/** An error that carries an HTTP status and a machine-readable code. */
export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
  }
}

/** Validate a request body with a zod schema, or throw a 400 AppError. */
export function parseBody(schema, body, label) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${label}`, result.error.format());
  }
  return result.data;
}
