export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new HttpError(400, message, 'BAD_REQUEST', details);
  }
  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, message, 'UNAUTHORIZED');
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new HttpError(403, message, 'FORBIDDEN');
  }
  static notFound(message = 'Resource not found') {
    return new HttpError(404, message, 'NOT_FOUND');
  }
  static conflict(message: string) {
    return new HttpError(409, message, 'CONFLICT');
  }
}
