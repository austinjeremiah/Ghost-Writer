import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env, corsOrigins } from './config.js';
import { AppError } from './errors.js';
import { log } from './log.js';
import { metaRoutes } from './routes/meta.js';
import { eventRoutes } from './routes/events.js';

const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
await app.register(cors, { origin: corsOrigins, methods: ['GET', 'POST', 'PUT'], allowedHeaders: ['content-type', 'payment-signature', 'x-payment', 'x-admin-token', 'last-event-id'], exposedHeaders: ['payment-response', 'x-payment-response'] });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AppError) return reply.status(err.status).send(err.toBody());
  if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'invalid request', details: { issues: err.issues } } });
  // Fastify's own client errors (malformed JSON, body too large, …) keep their 4xx status.
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: (err as Error).message, details: {} } });
  }
  log.error('unhandled', { message: err instanceof Error ? err.message : String(err) });
  return reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error', details: {} } });
});

await app.register(metaRoutes);
await app.register(eventRoutes);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
log.info(`ghostwriter backend on :${env.PORT}`);
