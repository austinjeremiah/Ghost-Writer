// Confirms the Suilend shapes the enclave and the watcher depend on, against Sui Mainnet.
//
// Usage:
//   pnpm peek:suilend <mainnet liquidation tx digest>   # prints that transaction's events
//   pnpm peek:suilend                                   # explains how to find one
//
// Why a digest is needed: this Tatum plan does not allow the event RPCs (ListEvents /
// SubscribeEvents answer "gRPC method not allowed"), so liquidations cannot be searched for. Find one
// on Suiscan by opening the Suilend lending_market package and filtering for LiquidateEvent.
import { env } from '../src/config.js';
import { mainnet, tatumMain } from '../src/chain/clients.js';
import { decodeLiquidation, obligationPreviousTx } from '../src/chain/suilend.js';

const digest = process.argv[2];

console.log('Suilend config in use:');
console.log('  LiquidateEvent type :', env.SUILEND_LIQUIDATE_EVENT_TYPE);
console.log('  event module        :', env.SUILEND_EVENT_MODULE);
console.log('  obligation cap type :', env.SUILEND_OBLIGATION_CAP_TYPE || '(unset — positions endpoint returns [])');

if (!digest) {
  console.log(`
No digest given. To fill SUILEND_OBLIGATION_CAP_TYPE:
  1. Find a Suilend liquidation on https://suiscan.xyz/mainnet (search the lending_market package).
  2. Re-run: pnpm peek:suilend <digest>   — it prints the event, including lending_market_id.
  3. sui client switch --env mainnet && sui client object <lending_market_id> --json
  4. Copy the type argument P out of LendingMarket<P> and set:
     SUILEND_OBLIGATION_CAP_TYPE=${env.SUILEND_EVENT_MODULE}::ObligationOwnerCap<P>
`);
  process.exit(0);
}

console.log(`\nreading mainnet tx ${digest}`);
const r = await tatumMain(
  () => mainnet.getTransaction({ digest, include: { events: true, effects: true } }),
  'peek:getTransaction',
);
const t = r.Transaction ?? r.FailedTransaction;
const events = (t as unknown as { events?: { events?: Array<{ eventType?: string; json?: unknown }> } }).events?.events ?? [];
console.log(`status ${t.status.success ? 'success' : 'failed'}, ${events.length} event(s)\n`);

for (const [i, ev] of events.entries()) {
  const type = ev.eventType ?? '(unknown type)';
  console.log(`[${i}] ${type}`);
  console.log(JSON.stringify(ev.json, null, 1).slice(0, 1200));
  if (type === env.SUILEND_LIQUIDATE_EVENT_TYPE) {
    const decoded = decodeLiquidation(ev.json, digest, null);
    console.log('  → decoded by our parser:', decoded
      ? {
          obligationId: decoded.obligationId,
          repayAmount: decoded.repayAmount.toString(),
          withdrawAmount: decoded.withdrawAmount.toString(),
        }
      : 'FAILED — field names differ from decodeLiquidation()');
    if (decoded) {
      const prev = await obligationPreviousTx(decoded.obligationId);
      console.log('  → obligation previousTransaction now:', prev?.digest ?? '(unreadable)');
    }
  }
  console.log();
}

if (!events.some((e) => e.eventType === env.SUILEND_LIQUIDATE_EVENT_TYPE)) {
  console.log(`No ${env.SUILEND_LIQUIDATE_EVENT_TYPE} in this transaction.`);
}
