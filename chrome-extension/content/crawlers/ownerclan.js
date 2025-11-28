/**
 * ==========================================
 * OWNERCLAN (오너클랜) 크롤러
 * ==========================================
 * 사이트: www.ownerclan.com
 * 한국 도매 전문 플랫폼
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * 오너클랜 상품 상세 페이지 크롤러
 * URL: www.ownerclan.com/product/*
 */
export async function crawlOwnerclanProduct() {
  console.log('[Ownerclan Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    const titleEl = document.querySelector('.product_name, h1.title, .item-title, .product-title');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const title = cleanText(titleEl.textContent);
    console.log('[Ownerclan] 상품명:', title);

    // 이미지
    const imageUrls = [];
    const imgs = document.querySelectorAll('.product-image img, #product_image img, .item-img img, .swiper-slide img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src');
      if (src && !isVideoOverlayOrIcon(src)) {
        imageUrls.push(cleanImageUrl(src));
      }
    }

    console.log('[Ownerclan] 이미지 개수:', imageUrls.length);

    // 가격
    const priceEl = document.querySelector('.price, .product-price, .selling-price');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    results.push({
      title: title,
      titleCn: title,
      titleImage: imageUrls,
      imageLink: imageUrls[0] || '',
      link: window.location.href,
      price: price,
      type: 'ownerclan-product'
    });

    console.log('[Ownerclan] 수집 완료');

    return {
      results,
      platform: 'ownerclan',
      url: window.location.href,
      title: title,
      price: price,
      exportType: 'ownerclan-product'
    };

  } catch (error) {
    console.error('[Ownerclan Product Crawler] 오류:', error);
    throw error;
  }
}

/**
 * 오너클랜 리스트 페이지 크롤러
 * URL: www.ownerclan.com/list/*
 */
export async function crawlOwnerclanList() {
  console.log('[Ownerclan List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    const productCards = document.querySelectorAll('.product-item, .item, [class*="goods-item"], [class*="product-list"] > div');

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    console.log(`[Ownerclan List] 상품 카드 발견: ${productCards.length}개`);

    for (const card of productCards) {
      try {
        const linkEl = card.querySelector('a');
        if (!linkEl) continue;

        const productUrl = linkEl.href;

        const titleEl = card.querySelector('.title, .name, .product-name');
        const title = titleEl ? cleanText(titleEl.textContent) : '';
        if (!title) continue;

        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        const priceEl = card.querySelector('.price, .product-price');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        results.push({
          title: title,
          titleCn: title,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          type: 'ownerclan-list'
        });

      } catch (err) {
        console.warn('[Ownerclan List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Ownerclan List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'ownerclan-list',
      url: window.location.href,
      title: `오너클랜 검색 결과 (${results.length}개)`,
      exportType: 'ownerclan-list'
    };

  } catch (error) {
    console.error('[Ownerclan List Crawler] 오류:', error);
    throw error;
  }
}
