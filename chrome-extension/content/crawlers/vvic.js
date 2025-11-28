/**
 * ==========================================
 * VVIC (브이빅) 크롤러
 * ==========================================
 * 사이트: www.vvic.com
 * 중국 도매 의류 플랫폼
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * VVIC 상품 상세 페이지 크롤러
 * URL: www.vvic.com/item/*
 */
export async function crawlVVICProduct() {
  console.log('[VVIC Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    const titleEl = document.querySelector('.product-title, h1.title, .item-title');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const titleCn = cleanText(titleEl.textContent);
    console.log('[VVIC] 상품명:', titleCn);

    // 이미지
    const imageUrls = [];
    const imgs = document.querySelectorAll('.product-image img, .gallery img, .item-img img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src');
      if (src && !isVideoOverlayOrIcon(src)) {
        imageUrls.push(cleanImageUrl(src));
      }
    }

    console.log('[VVIC] 이미지 개수:', imageUrls.length);

    // 가격
    const priceEl = document.querySelector('.price, .product-price');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    results.push({
      title: titleCn,
      titleCn: titleCn,
      titleImage: imageUrls,
      imageLink: imageUrls[0] || '',
      link: window.location.href,
      price: price,
      type: 'vvic-product'
    });

    console.log('[VVIC] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'vvic',
      url: window.location.href,
      title: titleCn,
      price: price,
      exportType: 'vvic-product'
    };

  } catch (error) {
    console.error('[VVIC Product Crawler] 오류:', error);
    throw error;
  }
}

/**
 * VVIC 검색 리스트 페이지 크롤러
 * URL: www.vvic.com/list/*
 */
export async function crawlVVICList() {
  console.log('[VVIC List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    const productCards = document.querySelectorAll('.product-item, .item, [class*="goods-item"]');

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    console.log(`[VVIC List] 상품 카드 발견: ${productCards.length}개`);

    for (const card of productCards) {
      try {
        const linkEl = card.querySelector('a');
        if (!linkEl) continue;

        const productUrl = linkEl.href;

        const titleEl = card.querySelector('.title, .name, .product-name');
        const titleCn = titleEl ? cleanText(titleEl.textContent) : '';
        if (!titleCn) continue;

        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        const priceEl = card.querySelector('.price, .product-price');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          type: 'vvic-list'
        });

      } catch (err) {
        console.warn('[VVIC List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[VVIC List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'vvic-list',
      url: window.location.href,
      title: `VVIC 검색 결과 (${results.length}개)`,
      exportType: 'vvic-list'
    };

  } catch (error) {
    console.error('[VVIC List Crawler] 오류:', error);
    throw error;
  }
}
