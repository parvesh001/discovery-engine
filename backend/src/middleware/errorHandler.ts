import type { ErrorRequestHandler } from 'express';

const GENERIC_CLIENT_ERROR = { error: 'Invalid request.' };
const GENERIC_SERVER_ERROR = { error: 'Internal server error.' };

/**
 * Passes through a real 4xx status (e.g. body-parser's 400 on malformed JSON) so the
 * client still gets an accurate response class — but never the status text/message that
 * came with it, since that can describe internal parsing details. Anything else (no
 * status, or a 5xx) collapses to a plain 500.
 */
function safeStatus(err: unknown): number {
  const candidate = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === 'number' && candidate >= 400 && candidate < 500) {
    return candidate;
  }
  return 500;
}

/**
 * Catch-all Express error middleware (spec 10, error hygiene) — registered last in
 * app.ts. Every route already handles its own known failure modes with a generic
 * response (search.ts's try/catch blocks), but this closes the gap for anything that
 * throws or calls next(err) outside those — a malformed JSON body from express.json(),
 * or an unexpected synchronous throw in future code. No stack trace or internal message
 * ever reaches the client; the full error is always logged server-side (CLAUDE.md rule #6).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  console.error(`[errorHandler] ${req.method} ${req.path} failed:`, err);

  const status = safeStatus(err);
  res.status(status).json(status === 500 ? GENERIC_SERVER_ERROR : GENERIC_CLIENT_ERROR);
};
