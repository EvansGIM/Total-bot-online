/**
 * ==========================================
 * ALIEXPRESS (알리익스프레스) 크롤러
 * ==========================================
 * 사이트: *.aliexpress.com
 * 알리바바 그룹의 글로벌 B2C 플랫폼
 */

import { cleanImageUrl, safeSrc, cleanText, cleanPrice } from '../utils.js';

export async function crawlAliexpressProduct() {
  console.log('[AliExpress Crawler] 시작:', window.location.href);

  try {
    const data = {
      title: '',
      titleCn: '',
      price: '',
      images: [],
      titleImage: [],
      options: [],
      description: '',
      url: window.location.href,
      timestamp: new Date().toISOString(),
      type: 'aliexpress'
    };

    // 상품명
    const titleEl = document.querySelector('h1.product-title-text, .product-title');
    if (titleEl) {
      data.title = cleanText(titleEl.textContent);
      data.titleCn = data.title;  // 영문 또는 중문
    } else {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    console.log('[AliExpress] 상품명:', data.title);

    // 가격
    const priceEl = document.querySelector('.product-price-value, .uniform-banner-box-price');
    if (priceEl) {
      data.price = cleanPrice(priceEl.textContent);
    }

    // 이미지
    const imageEls = document.querySelectorAll('.images-view-item img');
    for (const img of imageEls) {
      let src = img.src;
      if (src && !src.startsWith('data:')) {
        // 알리익스프레스 이미지는 _50x50 같은 크기 제한 제거
        src = src.replace(/_\d+x\d+\./g, '.');
        data.images.push(cleanImageUrl(src));
        data.titleImage.push(cleanImageUrl(src));
      }
    }

    console.log('[AliExpress] 이미지 개수:', data.images.length);

    // 옵션 (SKU)
    const skuModule = document.querySelector('.product-sku');
    if (skuModule) {
      const skuProps = skuModule.querySelectorAll('.sku-property');

      for (const prop of skuProps) {
        const nameEl = prop.querySelector('.sku-property-text span');
        const valueEls = prop.querySelectorAll('.sku-property-item');

        if (nameEl && valueEls.length > 0) {
          const optionName = cleanText(nameEl.textContent);
          const optionValues = Array.from(valueEls).map(v => {
            const title = v.getAttribute('title') || v.textContent;
            return cleanText(title);
          });

          data.options.push({
            name: optionName,
            values: optionValues
          });
        }
      }
    }

    console.log('[AliExpress] 옵션 개수:', data.options.length);

    console.log('[AliExpress] 크롤링 완료');
    return {
      results: [data],
      title: data.title,
      exportType: 'aliexpress'
    };

  } catch (error) {
    console.error('[AliExpress Crawler] 오류:', error);
    throw error;
  }
}

/**
 * 알리익스프레스 검색 리스트 페이지 크롤러
 * URL: *.aliexpress.com/*wholesale*, *.aliexpress.com/*category/*, etc.
 */
export async function crawlAliexpressList() {
  console.log('[AliExpress List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자 (여러 패턴 지원)
    const productSelectors = [
      '[data-product-id]',
      '.product-item',
      '.list--item--main',
      '[class*="multi-"]'
    ];

    let productCards = [];

    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[AliExpress List] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    for (const card of productCards) {
      try {
        // 상품 링크
        const linkEl = card.querySelector('a[href*="/item/"]');
        if (!linkEl) continue;

        const productUrl = linkEl.href;

        // 상품명
        const titleEl = card.querySelector('.multi--title--G7dOCj3, .product-title, h3, [class*="title"]');
        const title = titleEl ? cleanText(titleEl.textContent || titleEl.getAttribute('title') || '') : '';
        if (!title) continue;

        // 이미지
        const imgEl = card.querySelector('img');
        let imageUrl = '';
        if (imgEl) {
          const src = imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('src');
          imageUrl = src ? cleanImageUrl(src.replace(/_\d+x\d+\./g, '.')) : '';
        }

        // 가격
        const priceEl = card.querySelector('.multi--price--XpqUI0R, .price, [class*="price"]');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        // 주문 수
        const ordersEl = card.querySelector('[class*="order"], [class*="sold"]');
        const orders = ordersEl ? cleanText(ordersEl.textContent) : '';

        results.push({
          title: title,
          titleCn: title,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          orders: orders,
          type: 'aliexpress-list'
        });

      } catch (err) {
        console.warn('[AliExpress List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[AliExpress List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'aliexpress-list',
      url: window.location.href,
      title: `알리익스프레스 검색 결과 (${results.length}개)`,
      exportType: 'aliexpress-list'
    };

  } catch (error) {
    console.error('[AliExpress List Crawler] 오류:', error);
    throw error;
  }
}
