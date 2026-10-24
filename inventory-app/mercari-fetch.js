const { BrowserWindow } = require("electron");
const { parseMercariPriceText } = require("./pricing");

// 메루카리 상품 페이지는 로그인 없이 열린다. 다만 화면을 JS로 그리는 페이지라
// 로드 직후엔 제목/가격이 아직 없을 수 있어서, 나타날 때까지 잠깐씩 기다리며 읽는다.
// 재고 등록(main.js)과 관심상품 할인 감시(wishlist-watch.js)가 같이 쓴다.
async function fetchMercariItem(mercariUrl) {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(mercariUrl);
    for (let attempt = 0; attempt < 20; attempt++) {
      const info = await win.webContents.executeJavaScript(`(() => {
        // 일반 상품은 price, 메루카리 Shops 상품은 product-price
        const priceEl = document.querySelector('[data-testid="price"]')
          || document.querySelector('[data-testid="product-price"]')
          || document.querySelector('[data-testid="converted-currency-section"]');
        const main = document.querySelector('main');
        return {
          title: document.querySelector('h1')?.innerText?.trim() || null,
          priceText: priceEl?.innerText || main?.innerText || '',
          imageUrl: document.querySelector('meta[property="og:image"]')?.content || null,
          soldOut: !!document.querySelector('[data-testid="image-0"][aria-label="売り切れ"]')
            || /売り切れ|在庫なし/.test(document.querySelector('[data-testid="product-title-section"]')?.parentElement?.innerText || ''),
        };
      })()`);
      const jpyPrice = parseMercariPriceText(info.priceText);
      if (info.title && jpyPrice != null) {
        // 팔린 상품은 첫 번째 상품 사진에 aria-label="売り切れ" 스티커가 붙는다(실제 페이지 확인함).
        return { title: info.title, jpyPrice, imageUrl: info.imageUrl, soldOut: info.soldOut };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  } finally {
    win.destroy();
  }
}

module.exports = { fetchMercariItem };
