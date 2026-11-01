// 毎分の読み書きの回数を数える。Sheets API の上限は読み書きそれぞれ毎分60回。
// バックオフの再試行や初回の確認の分があるので、上限より少し手前で止める。

export interface RateLimits {
  readsPerWindow: number;
  writesPerWindow: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  readsPerWindow: 50,
  writesPerWindow: 50,
  windowMs: 60_000,
};

export class RateBudget {
  readonly #limits: RateLimits;
  readonly #now: () => number;
  #reads: number[] = [];
  #writes: number[] = [];

  constructor(limits: RateLimits, now: () => number) {
    this.#limits = limits;
    this.#now = now;
  }

  // 使えるなら数えて true を返す。足りなければ何も数えない
  tryTake(reads: number, writes: number): boolean {
    const now = this.#now();
    const since = now - this.#limits.windowMs;
    this.#reads = this.#reads.filter((t) => t > since);
    this.#writes = this.#writes.filter((t) => t > since);
    if (
      this.#reads.length + reads > this.#limits.readsPerWindow ||
      this.#writes.length + writes > this.#limits.writesPerWindow
    ) {
      return false;
    }
    for (let i = 0; i < reads; i += 1) this.#reads.push(now);
    for (let i = 0; i < writes; i += 1) this.#writes.push(now);
    return true;
  }
}
