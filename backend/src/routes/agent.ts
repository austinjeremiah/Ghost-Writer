import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { makeQuote, getQuote, QuoteInput } from '../pricing/quote.js';
import { paymentRequired, settlePayment, quoteIdFromHeader, X402_NETWORK } from '../x402/agent.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');

export async function agentRoutes(app: FastifyInstance) {
  app.post('/v1/agent/cover', async (req, reply) => {
    // x402 v2 names the header PAYMENT-SIGNATURE; v1 clients send X-PAYMENT. Accept either.
    const raw = req.headers['payment-signature'] ?? req.headers['x-payment'];

    const send402 = (quote: Parameters<typeof paymentRequired>[0], error: string) => {
      const body = paymentRequired(quote, error);
      reply.header('payment-required', b64(body));
      return reply.status(402).send(body);
    };

    // No payment yet: price the cover and quote terms the agent can pay.
    if (!raw) return send402(await makeQuote(QuoteInput.parse(req.body)), 'payment required');

    const header = Array.isArray(raw) ? raw[0] : raw;
    try {
      const r = await settlePayment(header);
      const receipt = b64({ success: true, transaction: r.digest, network: X402_NETWORK, payer: r.payer });
      reply.header('payment-response', receipt);
      reply.header('x-payment-response', receipt);
      return r.policy;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      // Retryable failures come back as another 402 with the same terms, per the scheme.
      const qid = quoteIdFromHeader(header);
      const quote = qid ? getQuote(qid) : null;
      if (quote && quote.status === 'issued') return send402(quote, e.message);
      throw e;
    }
  });
}
