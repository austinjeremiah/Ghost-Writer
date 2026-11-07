// lib/dapp-kit.ts
import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

/**
 * Browser reads (coin lookup for the buy tx, DUSDC balance) use the public Mysten fullnodes.
 * The Tatum key is a backend secret, so Tatum is used server-side only (backend §1.4).
 */
const GRPC_URLS = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
} as const;

export const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'],
  defaultNetwork: 'testnet',            // buying happens on Testnet
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
  storageKey: 'ghostwriter:wallet',
  // Shown by the Slush web wallet when connecting. (On localhost its metadata fetch is CORS-blocked; harmless.)
  slushWalletConfig: { appName: 'Ghostwriter' },
});

declare module '@mysten/dapp-kit-react' {
  interface Register { dAppKit: typeof dAppKit }
}
