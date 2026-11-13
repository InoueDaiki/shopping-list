import { withoutForgotten, type Category, type Id, type Item } from "@shopping-list/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inferItemCategory } from "./inference.ts";
import { SqliteLocalStore } from "./localStore.ts";
import { Repository } from "./repository.ts";
import { openTestDatabase } from "./testDb.ts";

const mocks = vi.hoisted(() => ({ store: null as never as SqliteLocalStore, repository: null as never as Repository }));

vi.mock("./runtime.ts", () => ({
  localStore: { rows: (table: "items") => mocks.store.rows(table) },
  rememberedHistory: () => withoutForgotten(mocks.store.rows("history"), mocks.store.rows("forgottenItems")),
  repository: { applyInferredCategory: (id: Id, categoryId: Id) => mocks.repository.applyInferredCategory(id, categoryId) },
}));

const NONE = { categoryId: null, categorySource: null };
const AT = "2028-01-01T00:00:00.000Z";
const DAIRY: Category = { id: "cat-dairy", name: "乳製品", sort: 1, updatedAt: AT, listId: "list" };
// 辞書に無い架空の売り場。履歴だけで学ぶ
const PARTS: Category = { id: "cat-parts", name: "架空の部品", sort: 2, updatedAt: AT, listId: "list" };
const OTHER_DAIRY: Category = { id: "other-dairy", name: "乳製品", sort: 1, updatedAt: AT, listId: "other" };
const OTHER_PARTS: Category = { id: "other-parts", name: "架空の部品", sort: 2, updatedAt: AT, listId: "other" };

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("inferItemCategory", () => {
  let repo: Repository;
  let clock: number;
  let next: number;

  beforeEach(() => {
    clock = Date.parse("2028-01-01T00:00:00.000Z");
    next = 0;
    mocks.store = new SqliteLocalStore(openTestDatabase());
    mocks.store.commitNow([DAIRY, PARTS, OTHER_DAIRY, OTHER_PARTS].map((row) => ({ action: "put", table: "categories", row })));
    repo = new Repository({
      store: mocks.store,
      newId: () => `id-${++next}`,
      now: () => new Date(clock++).toISOString(),
      learnedOrder: () => null,
    });
    mocks.repository = repo;
  });

  const add = (name: string) => repo.addItem("list", name, NONE) as Item;
  const itemOf = (id: Id) => mocks.store.rows("items").find((row) => row.id === id);

  it("呼び出しの中では書かず、裏で推定を入れて版を進める", async () => {
    const item = add("低脂肪牛乳");
    inferItemCategory(item);
    expect(itemOf(item.id)?.categoryId).toBeNull();

    await vi.waitFor(() => expect(itemOf(item.id)?.categoryId).toBe("cat-dairy"));
    expect(itemOf(item.id)?.categorySource).toBe("inferred");
    expect(itemOf(item.id)!.updatedAt > item.updatedAt).toBe(true);
  });

  it("推定の途中で利用者が決めたら上書きしない", async () => {
    const item = add("牛乳");
    const apply = vi.spyOn(repo, "applyInferredCategory");
    inferItemCategory(item);
    repo.updateItem(item.id, { categoryId: "cat-mine" });

    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    expect(itemOf(item.id)).toMatchObject({ categoryId: "cat-mine", categorySource: "user" });
  });

  it("分からない品目は未分類のままにする", async () => {
    const item = add("架空の品物");
    inferItemCategory(item);

    await nextTask();
    expect(itemOf(item.id)?.categoryId).toBeNull();
  });

  it("忘れた品目名の履歴からはカテゴリを引かない", async () => {
    mocks.store.commitNow([
      {
        action: "put",
        table: "history",
        row: { id: "h1", listId: "list", name: "架空の品物", categoryId: "cat-dairy", categorySource: "user", storeId: null, tripId: null, checkedAt: "2027-12-31T00:00:00.000Z", checkedSeq: 0 },
      },
    ]);
    repo.forgetItemName("list", "架空の品物");
    const item = add("架空の品物");
    inferItemCategory(item);

    await nextTask();
    expect(itemOf(item.id)?.categoryId).toBeNull();
  });

  it("推定はその品目のリストのカテゴリで返す", async () => {
    const item = repo.addItem("other", "低脂肪牛乳", NONE) as Item;
    inferItemCategory(item);
    await vi.waitFor(() => expect(itemOf(item.id)?.categoryId).toBe("other-dairy"));
  });

  it("履歴の学習はそのリストの履歴だけを使う", async () => {
    const learned = (listId: Id, categoryId: Id) =>
      ["ねじ大", "ねじ中", "ねじ小", "ねじ長", "ねじ短"].map((name, index) => ({
        action: "put" as const,
        table: "history" as const,
        row: { id: `${listId}-${index}`, listId, name, categoryId, categorySource: "user" as const, storeId: null, tripId: null, checkedAt: AT, checkedSeq: 0 },
      }));
    mocks.store.commitNow(learned("other", "other-parts"));

    // ほかのリストで学んだ名前は、このリストの推定に使わない(同じ名前のカテゴリがあっても)
    const here = add("ねじ特大");
    inferItemCategory(here);
    await nextTask();
    expect(itemOf(here.id)?.categoryId).toBeNull();

    const there = repo.addItem("other", "ねじ特大", NONE) as Item;
    inferItemCategory(there);
    await vi.waitFor(() => expect(itemOf(there.id)?.categoryId).toBe("other-parts"));
  });

  it("野良品目は推定しない(カテゴリを持たない)", async () => {
    const stray = repo.addStrayItem("低脂肪牛乳") as Item;
    const apply = vi.spyOn(repo, "applyInferredCategory");
    inferItemCategory(stray);
    await nextTask();
    expect(apply).not.toHaveBeenCalled();
  });

  it("野良品目をリストへ移した後は、そのリストのカテゴリで推定できる", async () => {
    const listId = repo.addList("架空のドラッグストア");
    const stray = repo.addStrayItem("ハンドソープ") as Item;
    const moved = repo.moveStrayItem(stray.id, listId) as Item;
    expect(moved.categoryId).toBeNull();
    inferItemCategory(moved);
    await vi.waitFor(() => expect(itemOf(stray.id)).toMatchObject({ categoryId: `cat_household-${listId}`, categorySource: "inferred" }));
  });

  it("分類済みの品目は推定しない", async () => {
    const item = repo.addItem("list", "牛乳", { categoryId: "cat-other", categorySource: "history" }) as Item;
    const apply = vi.spyOn(repo, "applyInferredCategory");
    inferItemCategory(item);

    await nextTask();
    expect(apply).not.toHaveBeenCalled();
  });

  it("途中の例外を外へ出さない", async () => {
    const item = add("牛乳");
    const apply = vi.spyOn(repo, "applyInferredCategory").mockImplementation(() => {
      throw new Error("書けない");
    });
    expect(() => inferItemCategory(item)).not.toThrow();

    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  });
});
