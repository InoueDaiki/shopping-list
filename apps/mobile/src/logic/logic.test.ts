import type { Item } from "@shopping-list/core";
import { describe, expect, it, vi } from "vitest";

import { redirectSystemPath } from "../app/+native-intent.ts";
import type { SyncStatus } from "../data/syncRunner.ts";
import { accountCheck, ownerValue } from "./account.ts";
import { categoryToneMap } from "./categoryTone.ts";
import { inviteLink, inviteMessage, parseInviteLink } from "./invite.ts";
import { listRows } from "./listRows.ts";
import { splitMemo } from "./memo.ts";
import { refinedPosition } from "./storePosition.ts";
import { moveInOrder } from "./moveInOrder.ts";
import { syncNotice } from "./syncNotice.ts";

const mocks = vi.hoisted(() => ({ rememberInvite: vi.fn() }));
vi.mock("../data/runtime.ts", () => ({ rememberInvite: mocks.rememberInvite }));
vi.mock("../config.ts", () => ({ config: { demo: false } }));

const item = (id: string) => ({ id }) as Item;

describe("accountCheck", () => {
  const check = (email: string | undefined, owner: string | null, hasLocalCopy = true) => accountCheck({ email, owner, hasLocalCopy });

  it("持ち主と同じなら確認しない。大文字と小文字は区別しない", () => {
    expect(check("Someone@Example.com", "someone@example.com")).toBe("ok");
  });

  it("違うアカウントなら確認を出す", () => {
    expect(check("other@example.com", "someone@example.com")).toBe("different");
  });

  it.each([
    ["メールが取れない", undefined, "someone@example.com"],
    ["持ち主を覚えていない", "someone@example.com", null],
    ["どちらも分からない", undefined, null],
    ["前はメールが取れなかった", "someone@example.com", ""],
  ])("比べられないときは確認を出す: %s", (_, email, owner) => {
    expect(check(email, owner)).toBe("unknown");
  });

  it("写しが無ければ確認せず持ち主にする", () => {
    expect(check("someone@example.com", null, false)).toBe("adopt");
    expect(check("other@example.com", "someone@example.com", false)).toBe("adopt");
  });

  it("メールが取れないまま受け入れた写しでは、毎回は聞かない", () => {
    expect(check(undefined, ownerValue(undefined))).toBe("ok");
  });
});

describe("listRows", () => {
  it("未チェックのあとにチェック済みの見出しを置く", () => {
    const rows = listRows({
      unchecked: [{ categoryId: "a", items: [item("1")] }],
      checked: [
        { categoryId: "a", items: [item("2")] },
        { categoryId: null, items: [item("3")] },
      ],
    });
    expect(rows.map((row) => row.kind)).toEqual(["section", "item", "checkedHeader", "section", "item", "section", "item"]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows[2]).toMatchObject({ count: 2 });
  });

  it("チェック済みが無ければ見出しを出さない", () => {
    expect(listRows({ unchecked: [], checked: [] })).toEqual([]);
  });
});

describe("refinedPosition", () => {
  const home = { lat: 1, lng: 2 };
  const shop = { lat: 3, lng: 4 };

  it("前回の場所で登録しても、測れたら置き換える", () => {
    expect(refinedPosition(home, shop)).toEqual(shop);
    expect(refinedPosition(null, shop)).toEqual(shop);
  });

  it("測れないか同じ位置なら書かない", () => {
    expect(refinedPosition(home, null)).toBeNull();
    expect(refinedPosition(shop, { ...shop })).toBeNull();
  });
});

describe("splitMemo", () => {
  it("URL を分け、文末の句読点は含めない", () => {
    expect(splitMemo("見る https://example.com/a?b=1。次")).toEqual([
      { text: "見る ", url: false },
      { text: "https://example.com/a?b=1", url: true },
      { text: "。次", url: false },
    ]);
  });

  it("http と https のほかは URL にしない", () => {
    expect(splitMemo("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)", url: false }]);
  });
});

describe("categoryToneMap", () => {
  it("マスタの順に8色を回す", () => {
    const categories = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, name: "", sort: 9 - index, updatedAt: "" }));
    const tones = categoryToneMap(categories);
    expect(tones.get("c8")).toBe("cat-1");
    expect(tones.get("c0")).toBe("cat-1");
    expect(tones.get("c7")).toBe("cat-2");
  });
});

describe("moveInOrder", () => {
  it("隣と入れ替え、端を超えない", () => {
    expect(moveInOrder(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveInOrder(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("syncNotice", () => {
  const status = (patch: Partial<SyncStatus>): SyncStatus => ({
    running: false,
    lastStatus: "ok",
    errorKind: null,
    issues: [],
    lastSyncedAt: null,
    ...patch,
  });

  it("問題が無ければ何も出さない", () => {
    expect(syncNotice(status({}), 3)).toBeNull();
  });

  it("圏外は未送信があるときだけ、静かに知らせる", () => {
    expect(syncNotice(status({ errorKind: "offline" }), 0)).toBeNull();
    expect(syncNotice(status({ errorKind: "offline" }), 2)).toMatchObject({ tone: "info" });
  });

  it("権限やシートの問題は強く知らせる", () => {
    expect(syncNotice(status({ errorKind: "forbidden" }), 0)?.tone).toBe("danger");
    expect(syncNotice(status({ errorKind: "notFound" }), 1)?.text).toContain("未送信 1 件");
  });

  it("読めない行の数を知らせる", () => {
    const issues = [{ table: "items" as const, row: 2, id: null, problems: [] }];
    expect(syncNotice(status({ issues }), 0)?.text).toContain("1 行");
  });
});

describe("招待リンク", () => {
  const ID = "abcdefghijklmnopqrstuvwxyz012345";

  it("作ったリンクからシートの ID を取り出す", () => {
    expect(parseInviteLink(inviteLink(ID))).toBe(ID);
    expect(parseInviteLink(` /join?x=1&sheet=${ID}#y `)).toBe(ID);
  });

  it.each(["shoppinglist://join", "shoppinglist://join?sheet=short", "https://example.com/join?sheet=abcdefghijklmnopqrstuvwxyz012345", "shoppinglist://other?sheet=abcdefghijklmnopqrstuvwxyz012345"])(
    "%s は招待リンクではない",
    (input) => {
      expect(parseInviteLink(input)).toBeNull();
    },
  );

  it("文にリンクとシートの URL を入れる", () => {
    const message = inviteMessage({ spreadsheetId: ID, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit` });
    expect(message).toContain(inviteLink(ID));
    expect(message).toContain(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
  });
});

describe("redirectSystemPath", () => {
  const ID = "abcdefghijklmnopqrstuvwxyz012345";

  it("招待リンクは覚えて一覧へ送る", () => {
    mocks.rememberInvite.mockClear();
    expect(redirectSystemPath({ path: `shoppinglist://join?sheet=${ID}`, initial: true })).toBe("/");
    expect(mocks.rememberInvite).toHaveBeenCalledWith(ID);
  });

  it("形の違う join は覚えない", () => {
    mocks.rememberInvite.mockClear();
    expect(redirectSystemPath({ path: "/join?sheet=x", initial: false })).toBe("/");
    expect(mocks.rememberInvite).not.toHaveBeenCalled();
  });

  it.each(["io.github.inouedaiki.shoppinglist:/oauth2redirect?code=1", "/oauth2redirect", "oauth2redirect#x"])("%s は一覧へ送る", (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe("/");
  });

  it("ほかのパスはそのまま", () => {
    expect(redirectSystemPath({ path: "/lists/oauth2redirect", initial: false })).toBe("/lists/oauth2redirect");
  });
});
