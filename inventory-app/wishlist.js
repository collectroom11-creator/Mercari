// 켄즈포스트 관심상품 페이지(/user/mypage/one?o=-1) 파싱. 상품 하나가
// "<!-- 리스트1개 -->" 주석으로 구분돼 있다(실제 페이지 마크업 확인함).
// 야후옥션 등 메루카리가 아닌 상품은 가격 확인 방법이 달라서 건너뛴다.
function parseWishlistHtml(html) {
  const items = [];
  for (const chunk of html.split("<!-- 리스트1개 -->").slice(1)) {
    const idMatch = chunk.match(/jp\.mercari\.com\/item\/(m\d+)/);
    if (!idMatch) continue;
    const imgMatch = chunk.match(/<img[^>]+src="(https:\/\/static\.mercdn\.net[^"]+)"[^>]*alt="([^"]*)"/);
    const priceMatch = chunk.match(/상품가 : <span class="bold">JPY ([\d,]+)/);
    items.push({
      id: idMatch[1],
      title: imgMatch ? imgMatch[2] : idMatch[1],
      listedPrice: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : null,
      imageUrl: imgMatch ? imgMatch[1] : null,
    });
  }
  const pagination = html.match(/<ul class="pagination[\s\S]*?<\/ul>/);
  const pageLinks = pagination
    ? [...pagination[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))
    : [];
  return { items, pageLinks };
}

module.exports = { parseWishlistHtml };
