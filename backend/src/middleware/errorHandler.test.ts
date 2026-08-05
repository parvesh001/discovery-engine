import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from './errorHandler.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorHandler', () => {
  it('responds with a generic 500 body and never leaks the real error message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/boom', () => {
      throw new Error('sensitive internal detail: db password is hunter2');
    });
    app.use(errorHandler);

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('logs the full error server-side, with request context', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/boom', () => {
      throw new Error('sensitive internal detail: db password is hunter2');
    });
    app.use(errorHandler);

    await request(app).get('/boom');

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [context, loggedError] = consoleErrorSpy.mock.calls[0] as [string, Error];
    expect(context).toContain('GET /boom');
    expect(loggedError.message).toContain('hunter2');
  });

  it('passes through a real 4xx status but replaces the body with a generic message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/bad', (_req, _res, next) => {
      next(Object.assign(new Error('detailed parse failure at byte offset 12'), { status: 400 }));
    });
    app.use(errorHandler);

    const response = await request(app).get('/bad');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid request.' });
  });

  it('collapses a 5xx status on the error itself to a generic 500, not the raw status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/upstream-failure', (_req, _res, next) => {
      next(Object.assign(new Error('upstream 503'), { status: 503 }));
    });
    app.use(errorHandler);

    const response = await request(app).get('/upstream-failure');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error.' });
  });

  it('produces a generic response for a malformed JSON request body (express.json() parse failure)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.use(express.json());
    app.post('/echo', (req, res) => {
      res.status(200).json(req.body);
    });
    app.use(errorHandler);

    const response = await request(app).post('/echo').set('Content-Type', 'application/json').send('{not valid json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid request.' });
    expect(JSON.stringify(response.body)).not.toMatch(/unexpected token/i);
  });

  it('delegates to next(err) instead of double-responding when headers are already sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/already-sent', (_req, res, next) => {
      res.status(200).json({ ok: true });
      next(new Error('fires after response already flushed'));
    });
    app.use(errorHandler);

    const response = await request(app).get('/already-sent');

    // The original 200 response wins — errorHandler must not attempt a second res.status()/json()
    // call on a response whose headers are already sent (that would throw ERR_HTTP_HEADERS_SENT).
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
