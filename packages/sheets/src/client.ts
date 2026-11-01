// Sheets API v4 の薄いクライアント。fetch とアクセストークンの取得は外から渡す。

import { RemoteError, type RemoteErrorKind } from "@shopping-list/core";

export type Cell = string | number | boolean | null;

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: unknown;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

// forceRefresh が true のときは、手元のトークンを捨ててリフレッシュトークンで取り直す。
// 取り直せないときは RemoteError(オフラインなら offline、ログインが要るなら auth)を投げる
export type GetAccessToken = (options: { forceRefresh: boolean }) => Promise<string>;

export interface SheetsClientOptions {
  fetch: FetchLike;
  getAccessToken: GetAccessToken;
  // 408、425、429 と 5xx の再試行の回数
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface ValueRange {
  range?: string;
  values?: Cell[][];
}

export interface SheetProperties {
  sheetId: number;
  title: string;
}

export interface Spreadsheet {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  sheets?: { properties: SheetProperties }[];
}

export type SheetsRequest = Record<string, unknown>;

const BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
// 408(要求の時間切れ)と 425(早すぎる)も一時的な失敗。中身の拒否ではないので隔離しない
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function errorKind(status: number): RemoteErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 429) return "rateLimited";
  if (status >= 500 || status === 408 || status === 425) return "server";
  return "invalid";
}

function errorMessage(status: number, body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    if (message !== undefined) return `Sheets API ${status}: ${message}`;
  } catch {
    // JSON でなければ状態の番号だけを出す
  }
  return `Sheets API ${status}`;
}

export class SheetsClient {
  readonly #fetch: FetchLike;
  readonly #getAccessToken: GetAccessToken;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #timeoutMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: SheetsClientOptions) {
    this.#fetch = options.fetch;
    this.#getAccessToken = options.getAccessToken;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#baseDelayMs = options.baseDelayMs ?? 500;
    this.#maxDelayMs = options.maxDelayMs ?? 32_000;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#sleep = options.sleep ?? delay;
    this.#random = options.random ?? Math.random;
  }

  create(title: string): Promise<Spreadsheet> {
    return this.#request("POST", BASE_URL, { properties: { title } });
  }

  // シートの一覧。fields で返す内容を絞る
  get(spreadsheetId: string, fields: string): Promise<Spreadsheet> {
    const query = `fields=${encodeURIComponent(fields)}`;
    return this.#request("GET", `${BASE_URL}/${spreadsheetId}?${query}`);
  }

  // 入力のままの値を読む。日付や数の表示形式を通さない
  async batchGet(spreadsheetId: string, ranges: string[]): Promise<ValueRange[]> {
    const query = [
      ...ranges.map((range) => `ranges=${encodeURIComponent(range)}`),
      "majorDimension=ROWS",
      "valueRenderOption=UNFORMATTED_VALUE",
    ].join("&");
    const url = `${BASE_URL}/${spreadsheetId}/values:batchGet?${query}`;
    const result = await this.#request<{ valueRanges?: ValueRange[] }>("GET", url);
    return result.valueRanges ?? [];
  }

  // 値は RAW で書く。"=1+1" のような品目名を数式にしない
  append(spreadsheetId: string, range: string, values: Cell[][]): Promise<unknown> {
    const query = "valueInputOption=RAW&insertDataOption=INSERT_ROWS";
    const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?${query}`;
    return this.#request("POST", url, { values });
  }

  batchUpdate(
    spreadsheetId: string,
    requests: SheetsRequest[],
  ): Promise<{ replies?: unknown[] }> {
    return this.#request("POST", `${BASE_URL}/${spreadsheetId}:batchUpdate`, { requests });
  }

  valuesBatchUpdate(
    spreadsheetId: string,
    data: { range: string; values: Cell[][] }[],
  ): Promise<unknown> {
    return this.#request("POST", `${BASE_URL}/${spreadsheetId}/values:batchUpdate`, {
      valueInputOption: "RAW",
      data,
    });
  }

  async #request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let refreshed = false;
    let forceRefresh = false;
    let attempt = 0;
    for (;;) {
      const token = await this.#token(forceRefresh);
      forceRefresh = false;
      const response = await this.#send(method, url, token, payload);

      if (response.status >= 200 && response.status < 300) {
        return JSON.parse(response.body) as T;
      }
      // 期限切れのことがあるので、取り直して1回だけ試す
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      if (RETRYABLE.has(response.status) && attempt < this.#maxRetries) {
        await this.#sleep(this.#backoffMs(attempt, response.retryAfter));
        attempt += 1;
        continue;
      }
      throw new RemoteError(
        errorKind(response.status),
        errorMessage(response.status, response.body),
      );
    }
  }

  async #token(forceRefresh: boolean): Promise<string> {
    try {
      return await this.#getAccessToken({ forceRefresh });
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError("auth", "アクセストークンを取得できない");
    }
  }

  async #send(method: string, url: string, token: string, body: string | undefined) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: await response.text(),
      };
    } catch {
      // つながらないときに待ち続けない。送信待ちは残るので、次の同期で送る
      throw new RemoteError("offline", "Sheets API に接続できない");
    } finally {
      clearTimeout(timer);
    }
  }

  // 指数バックオフ。同時に再開しないよう、後ろ半分に揺らぎを入れる
  #backoffMs(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, this.#maxDelayMs);
    }
    const ceiling = Math.min(this.#baseDelayMs * 2 ** attempt, this.#maxDelayMs);
    return ceiling / 2 + (this.#random() * ceiling) / 2;
  }
}
