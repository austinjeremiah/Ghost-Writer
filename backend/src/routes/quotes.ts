import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { makeQuote, getQuote, QuoteInput } from '../pricing/quote.js';

export async function quoteRoutes(app: FastifyInstance) {
  app.post('/v1/quotes', async (req) => makeQuote(QuoteInput.parse(req.body)));

  app.get('/v1/quotes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const q = getQuote(id);
    if (!q) throw new AppError('NOT_FOUND', 'unknown quote');
    return q;
  });
}
