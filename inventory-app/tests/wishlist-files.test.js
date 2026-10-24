const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseWishlistLink, mercariItemUrl, loadManual, addManual, removeManual, appendDrop, loadDrops, mergeWishlist, loadHidden, hideItem,
} = require("../wishlist-files");

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wish-")), name);

test("parseWishlistLink: 켄즈포스트/메루카리 링크에서 id, 그 외 null", () => {
  assert.equal(parseWishlistLink("https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/item/m55393345053"), "m55393345053");
  assert.equal(parseWishlistLink("https://jp.mercari.com/item/m82394126177?source=x"), "m82394126177");
  assert.equal(parseWishlistLink("https://auctions.yahoo.co.jp/jp/auction/x123"), null);
  assert.equal(parseWishlistLink("아무거나"), null);
});

test("parseWishlistLink / mercariItemUrl: 메루카리 Shops 상품도 id로, 주소는 종류에 맞게", () => {
  assert.equal(parseWishlistLink("https://jp.mercari.com/shops/product/2JYaH9veBAGGWUmg3SjSUL"), "2JYaH9veBAGGWUmg3SjSUL");
  assert.equal(parseWishlistLink("https://kenzpost.com/mercari/bid.s/https://jp.mercari.com/shops/product/2JYaH9veBAGGWUmg3SjSUL"), "2JYaH9veBAGGWUmg3SjSUL");
  assert.equal(mercariItemUrl("m55393345053"), "https://jp.mercari.com/item/m55393345053");
  assert.equal(mercariItemUrl("2JYaH9veBAGGWUmg3SjSUL"), "https://jp.mercari.com/shops/product/2JYaH9veBAGGWUmg3SjSUL");
});

test("addManual/removeManual: 중복은 무시하고 삭제된다", () => {
  const f = tmp("manual.json");
  assert.deepEqual(loadManual(f), []);
  addManual(f, "m1");
  addManual(f, "m1");
  assert.deepEqual(loadManual(f).map((m) => m.id), ["m1"]);
  removeManual(f, "m1");
  assert.deepEqual(loadManual(f), []);
});

test("mergeWishlist: 켄즈 목록에 없는 직접 추가 id는 유지되고, 새 id는 추가된다", () => {
  const state = { m1: { title: "a", lastPrice: 100, soldOut: false }, m2: { title: "b", lastPrice: 200, soldOut: false }, m3: { title: "c", lastPrice: 1, soldOut: false } };
  const out = mergeWishlist(state, [{ id: "m1", title: "a", listedPrice: 100 }], ["m2", "m9"]);
  assert.ok(out.m1);
  assert.ok(out.m2);
  assert.equal(out.m3, undefined);
  assert.deepEqual(out.m9, { title: "m9", lastPrice: null, soldOut: false });
});

test("mergeWishlist: 켄즈 목록이 null(로그아웃)이면 아무것도 지우지 않는다", () => {
  const out = mergeWishlist({ m1: { title: "a", lastPrice: 1, soldOut: false } }, null, []);
  assert.ok(out.m1);
});

test("mergeWishlist: 켄즈에서 새로 담은 상품은 담을 당시 가격이 기준가", () => {
  const out = mergeWishlist({}, [{ id: "m5", title: "t", listedPrice: 8800 }], []);
  assert.deepEqual(out.m5, { title: "t", lastPrice: 8800, soldOut: false });
});

test("hideItem/loadHidden: 숨긴 id가 쌓이고 중복은 무시", () => {
  const f = tmp("hidden.json");
  assert.deepEqual(loadHidden(f), []);
  hideItem(f, "m1");
  hideItem(f, "m1");
  hideItem(f, "m2");
  assert.deepEqual(loadHidden(f), ["m1", "m2"]);
});

test("mergeWishlist: 숨긴 상품은 켄즈 목록에 있어도, 직접 추가했어도 빠진다", () => {
  const out = mergeWishlist({ m1: { title: "a", lastPrice: 1, soldOut: false } }, [{ id: "m1", title: "a", listedPrice: 1 }, { id: "m3", title: "c", listedPrice: 3 }], ["m2"], ["m1", "m2"]);
  assert.equal(out.m1, undefined);
  assert.equal(out.m2, undefined);
  assert.ok(out.m3);
});

test("appendDrop/loadDrops: 기록이 쌓이고 at과 dropId가 붙는다", () => {
  const f = tmp("drops.json");
  appendDrop(f, { id: "m1", title: "t", oldPrice: 13000, newPrice: 11000, imageUrl: null });
  appendDrop(f, { id: "m2", title: "u", oldPrice: 5000, newPrice: 4000, imageUrl: null });
  const drops = loadDrops(f);
  assert.equal(drops.length, 2);
  assert.equal(drops[0].newPrice, 11000);
  assert.ok(drops[0].at);
  assert.equal(drops[0].dropId, `m1@${drops[0].at}`);
});
