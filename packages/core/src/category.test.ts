import { describe, expect, it, vi } from "vitest";
import { lookupCategory, resolveCategory, type CategoryInferrer } from "./category.ts";
import { categoriesFixture as categories, historyFixture, itemFixture } from "./test-support.ts";

const base = { name: "タマゴ", listId: "list-a", categories, items: [], history: [] };

function inferring(result: string | null): CategoryInferrer {
  return { infer: vi.fn(async () => result) };
}

describe("resolveCategory", () => {
  it("同じリストの記録をほかのリストより先に使う", async () => {
    const history = [
      historyFixture({
        id: "h1",
        listId: "list-b",
        categoryId: "cat-meat",
        checkedAt: "2029-01-01T00:00:00.000Z",
      }),
      historyFixture({ id: "h2", listId: "list-a", categoryId: "cat-dairy" }),
    ];
    expect(await resolveCategory({ ...base, history })).toEqual({
      categoryId: "cat-dairy",
      categorySource: "history",
    });
  });

  it("同じリストに無ければほかのリストから引く", async () => {
    const history = [historyFixture({ listId: "list-b", categoryId: "cat-meat" })];
    expect((await resolveCategory({ ...base, history })).categoryId).toBe("cat-meat");
  });

  it("同じリストの中では新しい記録より利用者の修正を使う", async () => {
    const items = [
      itemFixture({ categoryId: "cat-fish", categorySource: "user" }),
    ];
    const history = [
      historyFixture({ categoryId: "cat-meat", checkedAt: "2029-01-01T00:00:00.000Z" }),
    ];
    expect((await resolveCategory({ ...base, items, history })).categoryId).toBe("cat-fish");
  });

  it("ほかのリストの中でも利用者の修正を使う", async () => {
    const items = [
      itemFixture({ listId: "list-b", categoryId: "cat-fish", categorySource: "user" }),
    ];
    const history = [
      historyFixture({
        listId: "list-c",
        categoryId: "cat-meat",
        checkedAt: "2029-01-01T00:00:00.000Z",
      }),
    ];
    expect((await resolveCategory({ ...base, items, history })).categoryId).toBe("cat-fish");
  });

  it("推定で入ったカテゴリは履歴より弱い", async () => {
    const items = [
      itemFixture({
        categoryId: "cat-fish",
        categorySource: "inferred",
        updatedAt: "2029-01-01T00:00:00.000Z",
      }),
    ];
    const history = [historyFixture({ categoryId: "cat-meat" })];
    expect((await resolveCategory({ ...base, items, history })).categoryId).toBe("cat-meat");
  });

  it("未分類の記録とマスタに無いカテゴリの記録は使わない", async () => {
    const history = [
      historyFixture({ id: "h1", categoryId: null }),
      historyFixture({ id: "h2", categoryId: "cat-gone" }),
    ];
    expect(await resolveCategory({ ...base, history })).toEqual({
      categoryId: null,
      categorySource: null,
    });
  });

  it("過去の記録があれば推定を呼ばない", async () => {
    const inferrer = inferring("cat-fish");
    const history = [historyFixture({ categoryId: "cat-meat" })];
    await resolveCategory({ ...base, history, inferrer });
    expect(inferrer.infer).not.toHaveBeenCalled();
  });

  it("記録が無ければ推定し、マスタの ID だけを受け取る", async () => {
    expect(await resolveCategory({ ...base, inferrer: inferring("cat-fish") })).toEqual({
      categoryId: "cat-fish",
      categorySource: "inferred",
    });
    expect(await resolveCategory({ ...base, inferrer: inferring("cat-made-up") })).toEqual({
      categoryId: null,
      categorySource: null,
    });
  });

  it("推定が null か失敗なら未分類にする", async () => {
    const failing: CategoryInferrer = {
      infer: async () => {
        throw new Error("推定できない");
      },
    };
    expect((await resolveCategory({ ...base, inferrer: inferring(null) })).categoryId).toBeNull();
    expect((await resolveCategory({ ...base, inferrer: failing })).categoryId).toBeNull();
  });

  it("空の品目名は推定しない", async () => {
    const inferrer = inferring("cat-fish");
    await resolveCategory({ ...base, name: "  ", inferrer });
    expect(inferrer.infer).not.toHaveBeenCalled();
  });
});

describe("lookupCategory", () => {
  it("待たずに過去の記録だけから決める", () => {
    const history = [historyFixture({ categoryId: "cat-meat" })];
    expect(lookupCategory({ ...base, history }).categoryId).toBe("cat-meat");
    expect(lookupCategory(base).categoryId).toBeNull();
  });
});
