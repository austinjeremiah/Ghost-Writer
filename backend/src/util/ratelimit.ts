import { sleep } from './sleep.js';

export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rps: number) { this.tokens = rps; }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.rps, this.tokens + ((now - this.last) / 1000) * this.rps);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(Math.ceil(((1 - this.tokens) / this.rps) * 1000));
    }
  }
}
