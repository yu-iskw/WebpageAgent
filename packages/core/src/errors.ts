export class WebpageAgentError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WebpageAgentError';
  }
}

export function serializeError(error: unknown): { code?: string; message: string; name: string } {
  if (error instanceof WebpageAgentError) {
    return { code: error.code, message: error.message, name: error.name };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error), name: 'Error' };
}
