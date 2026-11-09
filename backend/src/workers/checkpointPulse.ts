// Live heartbeat from Tatum's Sui gRPC checkpoint stream, with a polling fallback.
//
// This is a liveness signal for the UI only. It deliberately does NOT drive price checks: Sui
// produces checkpoints far faster than our Tatum rate limit, and letting the stream trigger work
// would starve user-facing requests. The price watcher keeps its own clock.
import { testnet, tatum } from '../chain/clients.js';
import { emitTransient } from '../bus.js';
import { workerState } from '../state.js';
import { sleep } from '../util/sleep.js';
import { log } from '../log.js';

const EMIT_GAP_MS = 5000;
let lastEmit = 0;

function beat(seq: string): void {
  const now = Date.now();
  if (now - lastEmit < EMIT_GAP_MS) return;
  lastEmit = now;
  emitTransient('chain.checkpoint', { network: 'testnet', seq, at: now });
}

/** Polling fallback: one cheap call per interval, same event shape as the stream. */
async function poll(): Promise<never> {
  workerState.checkpointPulse = 'polling';
  for (;;) {
    try {
      const info = await tatum(() => testnet.ledgerService.getServiceInfo({}).response, 'serviceInfo');
      if (info.checkpointHeight !== undefined) beat(String(info.checkpointHeight));
    } catch (e) {
      log.warn('checkpoint poll failed', { message: (e as Error).message });
    }
    await sleep(EMIT_GAP_MS);
  }
}

export function startCheckpointPulse(): void {
  void (async () => {
    try {
      const call = testnet.subscriptionService.subscribeCheckpoints({ readMask: { paths: ['sequence_number'] } });
      workerState.checkpointPulse = 'stream';
      log.info('checkpoint stream open (Tatum gRPC)');
      for await (const msg of call.responses) {
        const seq = msg.checkpoint?.sequenceNumber ?? msg.cursor;
        if (seq !== undefined) beat(String(seq));
      }
      log.warn('checkpoint stream ended; falling back to polling');
    } catch (e) {
      log.warn('checkpoint stream unavailable; falling back to polling', { message: (e as Error).message });
    }
    await poll();
  })();
}
