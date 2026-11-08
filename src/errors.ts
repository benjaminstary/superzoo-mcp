export type ToolErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'invalid_response'
  | 'timeout'
  | 'cancelled'
  | 'overloaded'
  | 'internal_error';

export class SuperzooError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'SuperzooError';
  }
}

export function toToolError(error: unknown): { code: ToolErrorCode; message: string; retryable: boolean } {
  if (error instanceof SuperzooError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: 'internal_error', message: 'Superzoo request failed', retryable: false };
}
