import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env, corsOrigins } from './config.js';
import { AppError } from './errors.js';
import { log } from './log.js';
import { metaRoutes } from './routes/meta.js';
import { eventRoutes } from './routes/events.js';
import { borrowerRoutes } from './routes/borrowers.js';
import { quoteRoutes } from './routes/quotes.js';
import { policyRoutes } from './routes/policies.js';
import { rebuildRulesFromMemory } from './memory/rules.js';
import { resyncPolicies } from './policies/sync.js';
import { startPriceWatcher } from './workers/priceWatcher.js';
import { startCheckpointPulse } from './workers/checkpointPulse.js';
import { startLiquidationWatcher } from './workers/liquidationWatcher.js';
import { underwriterRoutes } from './routes/underwriter.js';
import { agentRoutes } from './routes/agent.js';
import { startLearning } from './policies/learning.js';
import { startMemoryQueue } from './memory/queue.js';

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
await app.register(borrowerRoutes);
await app.register(quoteRoutes);
await app.register(policyRoutes);
await app.register(underwriterRoutes);
await app.register(agentRoutes);

startMemoryQueue();
// Walrus is canonical for rules; a fresh database rebuilds them from memory.
void rebuildRulesFromMemory();
void resyncPolicies();
startPriceWatcher();
startCheckpointPulse();
startLearning();
// Mainnet Suilend watcher: matches liquidations to covered obligations and settles via the enclave.
startLiquidationWatcher();
await app.listen({ port: env.PORT, host: '0.0.0.0' });
log.info(`ghostwriter backend on :${env.PORT}`);
