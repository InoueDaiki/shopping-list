import type { Category, Id, Item } from "@shopping-list/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inferItemCategory } from "./inference.ts";
import { SqliteLocalStore } from "./localStore.ts";
import { Repository } from "./repository.ts";
import { openTestDatabase } from "./testDb.ts";

const mocks = vi.hoisted(() => ({ store: null as never as SqliteLocalStore, repository: null as never as Repository }));

vi.mock("./runtime.ts", () => ({
  localStore: { rows: (table: "items") => mocks.store.rows(table) },
  repository: { applyInferredCategory: (id: Id, categoryId: Id) => mocks.repository.applyInferredCategory(id, categoryId) },
}));

const NONE = { categoryId: null, categorySource: null };
const DAIRY: Category = { id: "cat-dairy", name: "乳製品", sort: 1, updatedAt: "2028-01-01T00:00:00.000Z" };

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("inferItemCategory", () => {
  let repo: Repository;
  let clock: number;
  let next: number;

  beforeEach(() => {
    clock = Date.parse("2028-01-01T00:00:00.000Z");
    next = 0;
    mocks.store = new SqliteLocalStore(openTestDatabase());
    mocks.store.commitNow([{ action: "put", table: "categories", row: DAIRY }]);
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
