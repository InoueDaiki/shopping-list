// DOM の型を入れないので、使うものだけを宣言する。実体は React Native と Node にある。

declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

declare class AbortController {
  readonly signal: unknown;
  abort(): void;
}
