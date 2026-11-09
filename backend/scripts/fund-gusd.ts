// Mints test gUSD to any address, paid for by the server key.
//
// The in-app button calls `mint_to_sender`, which mints to whoever signs. This script is for
// funding a wallet you are not currently signed in as — e.g. filling the demo wallet before a
// recording. The faucet is shared and public; the cap is 1000 gUSD per call.
//
//     pnpm fund:gusd 0x<address> [amount, default 1000]
import { Transaction } from '@mysten/sui/transactions';
import { env } from '../src/config.js';
import { execServer } from '../src/chain/clients.js';

const to = process.argv[2];
const amount = Number(process.argv[3] ?? 1000);
if (!to?.startsWith('0x')) throw new Error('usage: pnpm fund:gusd 0x<address> [amount]');
if (!(amount > 0 && amount <= 1000)) throw new Error('amount must be 1..1000 (the contract caps each mint)');

const faucet = process.env.GUSD_FAUCET_ID ?? '0x728cea2bd6f17243b575bea09e017407919113aff264389f707bd7b3529501d5';
const pkg = env.COIN_TYPE.split('::')[0];
const base = BigInt(Math.round(amount * 1e6)); // gUSD has 6 decimals

const tx = new Transaction();
// `mint` returns the coin so it can be sent on; `mint_to_sender` would keep it here.
const [coin] = tx.moveCall({
  target: `${pkg}::gusd::mint`,
  arguments: [tx.object(faucet), tx.pure.u64(base)],
});
tx.transferObjects([coin], tx.pure.address(to));

const { digest } = await execServer(tx, 'mint_gusd');
console.log(`✔ minted ${amount} gUSD to ${to}`);
console.log(`  tx ${digest}`);
