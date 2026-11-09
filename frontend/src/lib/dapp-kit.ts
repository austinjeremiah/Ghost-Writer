// lib/dapp-kit.ts
import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

/**
 * Browser reads (coin lookup for the buy tx, gUSD balance) use the public Mysten fullnodes.
 * The Tatum key is a backend secret, so Tatum is used server-side only (backend §1.4).
 */
const GRPC_URLS = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
} as const;

function isLocalhost() {
  return typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
}

export const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'],
  defaultNetwork: 'testnet',            // buying happens on Testnet
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
  storageKey: 'ghostwriter:wallet',
  // The Slush *web* wallet fetches metadata from api.slush.app, which is CORS-blocked on localhost.
  // Disable it locally; wallet extensions (Slush extension included) still work everywhere.
  slushWalletConfig: isLocalhost() ? null : { appName: 'Ghostwriter' },
});

declare module '@mysten/dapp-kit-react' {
  interface Register { dAppKit: typeof dAppKit }
}
