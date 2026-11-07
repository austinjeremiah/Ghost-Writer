import type { FastifyInstance } from 'fastify';
import { bus, eventsAfter, type BusEvent } from '../bus.js';
import { corsOrigins } from '../config.js';

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export async function eventRoutes(app: FastifyInstance) {
  app.get('/v1/events', (req, reply) => {
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (origin && corsOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    reply.hijack();
    reply.raw.writeHead(200, headers);

    const write = (ev: BusEvent) => {
      const idLine = ev.id ? `id: ${ev.id}\n` : '';
      reply.raw.write(`${idLine}event: ${ev.type}\ndata: ${toJson(ev.payload)}\n\n`);
    };

    const lastIdHeader = req.headers['last-event-id'];
    const lastId = Number(Array.isArray(lastIdHeader) ? lastIdHeader[0] : lastIdHeader ?? 0);
    if (Number.isFinite(lastId) && lastId > 0) for (const ev of eventsAfter(lastId)) write(ev);

    bus.on('event', write);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', write);
    });
  });
}
