import type { FastifyInstance } from 'fastify';
import { workerState } from '../state.js';

const started = Date.now();

export async function metaRoutes(app: FastifyInstance) {
  app.get('/v1/health', async () => ({ ok: true, version: '1.0.0', uptimeS: Math.round((Date.now() - started) / 1000), workers: workerState }));
}
