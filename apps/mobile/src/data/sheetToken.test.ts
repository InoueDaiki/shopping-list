import { describe, expect, it, vi } from "vitest";

import { sheetTokenProvider } from "./sheetToken.ts";

describe("sheetTokenProvider", () => {
  it("forceRefresh をそのまま渡す", async () => {
    const get = vi.fn(async () => "token");
    await expect(sheetTokenProvider(get)({ forceRefresh: true })).resolves.toBe("token");
    expect(get).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("ログインが要るときは auth にする", async () => {
    const error = Object.assign(new Error("x"), { name: "LoginRequiredError" });
    const provider = sheetTokenProvider(() => Promise.reject(error));
    await expect(provider({ forceRefresh: false })).rejects.toMatchObject({ kind: "auth" });
  });

  it("通信の失敗は offline にする(ログインは保つ)", async () => {
    const provider = sheetTokenProvider(() => Promise.reject(new TypeError("Network request failed")));
    await expect(provider({ forceRefresh: true })).rejects.toMatchObject({ kind: "offline" });
  });
});
