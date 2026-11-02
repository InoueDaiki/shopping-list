import { describe, expect, it } from "vitest";

import { decodePresence, markerChanged, writeMarker } from "./presence.ts";

const T = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;

describe("markerChanged", () => {
  const mine = writeMarker(T(1), "deviceA");
  const theirs = writeMarker(T(2), "deviceB");

  it("前回と同じ印なら変わっていない", () => {
    expect(markerChanged(theirs, { seen: theirs, own: null })).toBe(false);
    expect(markerChanged(null, { seen: null, own: null })).toBe(false);
  });

  it("ほかの端末の印なら変わった", () => {
    expect(markerChanged(theirs, { seen: mine, own: mine })).toBe(true);
    expect(markerChanged(theirs, { seen: null, own: null })).toBe(true);
  });

  it("自分が書いた印は無視する", () => {
    expect(markerChanged(mine, { seen: theirs, own: mine })).toBe(false);
  });

  it("まだ全部を読んでいなければ変わったことにする", () => {
    expect(markerChanged(null, { seen: undefined, own: null })).toBe(true);
  });

  it("印が消されたら変わったことにする", () => {
    expect(markerChanged(null, { seen: theirs, own: null })).toBe(true);
  });
});

describe("decodePresence", () => {
  it("読めない行は飛ばし、行の番号を残す", () => {
    expect(
      decodePresence([
        ["deviceA", "list1", T(9), T(1)],
        ["名前 ", "list1", T(9), T(1)],
        ["deviceB", "list1", "明日", T(1)],
        [],
        ["deviceC", "list2", T(8), T(2)],
      ]),
    ).toEqual([
      { deviceId: "deviceA", listId: "list1", until: T(9), updatedAt: T(1), rowNumber: 2 },
      { deviceId: "deviceC", listId: "list2", until: T(8), updatedAt: T(2), rowNumber: 6 },
    ]);
  });
});
