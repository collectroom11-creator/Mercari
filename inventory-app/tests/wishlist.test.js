const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWishlistHtml } = require("../wishlist");

// 실제 켄즈포스트 관심상품(/user/mypage/one?o=-1) 마크업을 줄인 것.
const block = (id, alt, price) => `<!-- 리스트1개 --><div class="row box-process"><div class="process-thumb"><img loading="lazy" src="https://static.mercdn.net/item/detail/orig/photos/${id}_1.jpg?1" alt="${alt}" class="img-thumbnail"></div><div class="process-content-top"><p class="auc-num">상품번호 : ${id}</p><a href="https://jp.mercari.com/item/${id}" class="subject DicoLink">한글제목<br>${alt}</a></div><div class="bottom-content"><span class="item">상품가 : <span class="bold">JPY ${price} x 1</span></span><span class="item">상태/주문 : 관심물품/미주문</span></div></div>`;

test("parseWishlistHtml: 메루카리 관심상품의 id/제목/관심등록 당시 가격을 읽는다", () => {
  const html = block("m16495099677", "希少 HYSTERIC GLAMOUR デニム", "15,800") + block("m83057473715", "ARMANI EXCHANGE ニット", "7,500") + `<!--//부트스트랩 리스트--><nav class="text-center"><ul class="pagination pagination-sm pagination-gray"><li class="active "><a>1</a></li></ul></nav>`;
  const { items, pageLinks } = parseWishlistHtml(html);
  assert.deepEqual(items, [
    { id: "m16495099677", title: "希少 HYSTERIC GLAMOUR デニム", listedPrice: 15800, imageUrl: "https://static.mercdn.net/item/detail/orig/photos/m16495099677_1.jpg?1" },
    { id: "m83057473715", title: "ARMANI EXCHANGE ニット", listedPrice: 7500, imageUrl: "https://static.mercdn.net/item/detail/orig/photos/m83057473715_1.jpg?1" },
  ]);
  assert.deepEqual(pageLinks, []);
});

test("parseWishlistHtml: 다음 페이지 링크를 모은다", () => {
  const html = block("m1", "a", "100") + `<ul class="pagination pagination-sm"><li class="active "><a>1</a></li><li><a href="?o=-1&amp;page=2">2</a></li></ul>`;
  assert.deepEqual(parseWishlistHtml(html).pageLinks, ["?o=-1&page=2"]);
});
