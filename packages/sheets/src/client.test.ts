import { RemoteError } from "@shopping-list/core";
import { describe, expect, it } from "vitest";

import { SheetsClient, type FetchInit, type FetchResponse } from "./client.ts";

function response(status: number, body: unknown = {}, retryAfter?: string): FetchResponse {
  return {
    status,
    headers: { get: (name) => (name === "retry-after" ? (retryAfter ?? null) : null) },
    text: async () => JSON.stringify(body),
  };
}

function setup(responses: FetchResponse[]) {
  const requests: { url: string; init: FetchInit }[] = [];
  const delays: number[] = [];
  const tokens: boolean[] = [];
  const client = new SheetsClient({
    fetch: async (url, init) => {
      requests.push({ url, init });
      const next = responses.shift();
      if (next === undefined) throw new Error("通信できない");
      return next;
    },
    getAccessToken: async ({ forceRefresh }) => {
      tokens.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "old-token";
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 1,
    maxRetries: 3,
  });
  return { client, requests, delays, tokens };
}

describe("SheetsClient", () => {
  it.each([408, 425])("%i は再試行する", async (code) => {
    const { client, requests } = setup([response(code), response(200, { valueRanges: [] })]);
    await client.batchGet("sheet", ["Items!A2:B"]);
    expect(requests).toHaveLength(2);
  });

  it.each([408, 425])("%i が続いても拒否(invalid)にしない", async (code) => {
    const { client } = setup([response(code), response(code), response(code), response(code)]);
    await expect(client.batchGet("sheet", ["Items!A2:B"])).rejects.toMatchObject({ kind: "server" });
  });

  it("batchGet は範囲を符号化し、入力のままの値を求める", async () => {
    const { client, requests } = setup([
      response(200, { valueRanges: [{ values: [["a"]] }, {}] }),
    ]);
    const ranges = await client.batchGet("sid", ["Items!A2:J", "Meta!A2"]);

    expect(ranges[0]?.values).toEqual([["a"]]);
    expect(requests[0]?.url).toContain("/sid/values:batchGet?ranges=Items!A2%3AJ&ranges=");
    expect(requests[0]?.url).toContain("valueRenderOption=UNFORMATTED_VALUE");
    expect(requests[0]?.init.headers.authorization).toBe("Bearer old-token");
  });

  it("append と values.batchUpdate は RAW で書く", async () => {
    const { client, requests } = setup([response(200), response(200)]);
    await client.append("sid", "History!A:H", [["=1+1"]]);
    await client.valuesBatchUpdate("sid", [{ range: "Items!A2", values: [["x"]] }]);

    expect(requests[0]?.url).toContain("valueInputOption=RAW");
    expect(JSON.parse(requests[1]?.init.body ?? "")).toMatchObject({
      valueInputOption: "RAW",
    });
  });

  it("429 と 5xx は指数バックオフで再試行する", async () => {
    const { client, delays, requests } = setup([
      response(429),
      response(503),
      response(500),
      response(200, { replies: [] }),
    ]);
    await client.batchUpdate("sid", []);

    expect(requests).toHaveLength(4);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it("Retry-After があれば従う", async () => {
    const { client, delays } = setup([
      response(429, {}, "7"),
      response(200, { replies: [] }),
    ]);
    await client.batchUpdate("sid", []);
    expect(delays).toEqual([7000]);
  });

  it("再試行が尽きたら失敗の種類を伝える", async () => {
    const { client, requests } = setup([
      response(429),
      response(429),
      response(429),
      response(429),
    ]);
    await expect(client.get("sid", "spreadsheetId")).rejects.toMatchObject({
      kind: "rateLimited",
    });
    expect(requests).toHaveLength(4);
  });

  it("401 はトークンを取り直して1回だけ試す", async () => {
    const { client, requests, tokens } = setup([response(401), response(200, {})]);
    await client.get("sid", "spreadsheetId");

    expect(tokens).toEqual([false, true]);
    expect(requests[1]?.init.headers.authorization).toBe("Bearer fresh-token");
  });

  it("取り直しても 401 ならログインし直しを求める", async () => {
    const { client, requests } = setup([response(401), response(401)]);
    await expect(client.get("sid", "spreadsheetId")).rejects.toMatchObject({ kind: "auth" });
    expect(requests).toHaveLength(2);
  });

  it("トークンを取れないときは auth にする", async () => {
    const client = new SheetsClient({
      fetch: async () => response(200),
      getAccessToken: async () => {
        throw new Error("取得の失敗");
      },
    });
    await expect(client.get("sid", "x")).rejects.toMatchObject({ kind: "auth" });
  });

  it("再試行しない状態は種類とメッセージを返す", async () => {
    const { client } = setup([
      response(403, { error: { message: "権限が無い" } }),
      response(404),
      response(400),
    ]);
    const failure = await client.get("sid", "x").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RemoteError);
    expect((failure as RemoteError).kind).toBe("forbidden");
    expect((failure as RemoteError).message).toContain("権限が無い");
    await expect(client.get("sid", "x")).rejects.toMatchObject({ kind: "notFound" });
    await expect(client.get("sid", "x")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("つながらないときは待たずに offline にする", async () => {
    const { client, delays } = setup([]);
    await expect(client.get("sid", "x")).rejects.toMatchObject({ kind: "offline" });
    expect(delays).toEqual([]);
  });
});
