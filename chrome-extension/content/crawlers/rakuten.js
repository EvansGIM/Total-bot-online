/**
 * ==========================================
 * RAKUTEN (라쿠텐) 크롤러
 * ==========================================
 * 사이트: item.rakuten.co.jp (상세), search.rakuten.co.jp (검색)
 * 일본 최대 이커머스 플랫폼
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * 라쿠텐 상품 상세 페이지 크롤러
 * URL: item.rakuten.co.jp/*
 */
export async function crawlRakutenProduct() {
  console.log('[Rakuten Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    const titleEl = document.querySelector('h1.item_name, .item-name, h1[itemprop="name"]');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const title = cleanText(titleEl.textContent);
    console.log('[Rakuten] 상품명:', title);

    // 이미지
    const imageUrls = [];
    const imageSelectors = [
      '.item-img img',
      '#rakutenLimitedId_ImageMain img',
      '.item_photo img'
    ];

    for (const selector of imageSelectors) {
      const imgs = document.querySelectorAll(selector);
      for (const img of imgs) {
        const src = img.src || img.getAttribute('data-src');
        if (src && !isVideoOverlayOrIcon(src)) {
          imageUrls.push(cleanImageUrl(src));
        }
      }
      if (imageUrls.length > 0) break;
    }

    console.log('[Rakuten] 이미지 개수:', imageUrls.length);

    // 가격
    const priceEl = document.querySelector('.price2, [itemprop="price"]');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    // 단일 상품 (라쿠텐은 대부분 옵션이 없음)
    results.push({
      title: title,
      titleCn: title,
      titleImage: imageUrls,
      imageLink: imageUrls[0] || '',
      link: window.location.href,
      price: price,
      type: 'rakuten-product'
    });

    console.log('[Rakuten] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'rakuten',
      url: window.location.href,
      title: title,
      price: price,
      exportType: 'rakuten-product'
    };

  } catch (error) {
    console.error('[Rakuten Product Crawler] 오류:', error);
    throw error;
  }
}

/**
 * 라쿠텐 검색 리스트 페이지 크롤러
 * URL: search.rakuten.co.jp/*, www.rakuten.co.jp/category/*
 */
export async function crawlRakutenList() {
  console.log('[Rakuten List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자
    const productCards = document.querySelectorAll('.searchresultitem, .item, [data-eno]');

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    console.log(`[Rakuten List] 상품 카드 발견: ${productCards.length}개`);

    for (const card of productCards) {
      try {
        // 상품 링크
        const linkEl = card.querySelector('a.image, a[href*="item.rakuten.co.jp"]');
        if (!linkEl) continue;

        const productUrl = linkEl.href;

        // 상품명
        const titleEl = card.querySelector('.title, .content.title a');
        const title = titleEl ? cleanText(titleEl.textContent) : '';
        if (!title) continue;

        // 이미지
        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        // 가격
        const priceEl = card.querySelector('.price, .important');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        results.push({
          title: title,
          titleCn: title,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          type: 'rakuten-list'
        });

      } catch (err) {
        console.warn('[Rakuten List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Rakuten List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'rakuten-list',
      url: window.location.href,
      title: `라쿠텐 검색 결과 (${results.length}개)`,
      exportType: 'rakuten-list'
    };

  } catch (error) {
    console.error('[Rakuten List Crawler] 오류:', error);
    throw error;
  }
}
