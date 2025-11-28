/**
 * ==========================================
 * AMAZON (아마존) 크롤러
 * ==========================================
 * 사이트: amazon.com, amazon.co.jp, amazon.de 등 (10개국)
 * 글로벌 최대 이커머스 플랫폼
 * 지원 국가: US, JP, MX, IN, DE, FR, IT, ES, UK, CA
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * 아마존 상품 상세 페이지 크롤러
 * URL: *.amazon.*/*
 */
export async function crawlAmazonProduct() {
  console.log('[Amazon Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    const titleSelectors = [
      '#productTitle',
      'h1.product-title',
      '#title'
    ];

    let titleEl = null;
    for (const selector of titleSelectors) {
      titleEl = document.querySelector(selector);
      if (titleEl) break;
    }

    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const title = cleanText(titleEl.textContent);
    console.log('[Amazon] 상품명:', title);

    // 이미지 수집
    const imageUrls = [];
    const imageSelectors = [
      '#altImages img',
      '#imageBlock img',
      '.imageThumbnail img'
    ];

    for (const selector of imageSelectors) {
      const imgs = document.querySelectorAll(selector);
      for (const img of imgs) {
        const src = img.src || img.getAttribute('data-old-hires');
        if (src && !isVideoOverlayOrIcon(src) && !src.includes('play-icon')) {
          imageUrls.push(cleanImageUrl(src));
        }
      }
      if (imageUrls.length > 0) break;
    }

    console.log('[Amazon] 이미지 개수:', imageUrls.length);

    // 가격
    const priceSelectors = [
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price-whole'
    ];

    let price = '';
    for (const selector of priceSelectors) {
      const priceEl = document.querySelector(selector);
      if (priceEl) {
        price = cleanPrice(priceEl.textContent);
        if (price) break;
      }
    }

    // 옵션 (색상, 사이즈 등)
    const variationSelectors = [
      '#variation_color_name li',
      '#variation_size_name li',
      '.a-button-group li'
    ];

    let hasVariations = false;

    for (const selector of variationSelectors) {
      const variations = document.querySelectorAll(selector);
      if (variations.length > 0) {
        hasVariations = true;

        for (const variation of variations) {
          const valueEl = variation.querySelector('img, .a-button-text, span');
          if (!valueEl) continue;

          const optionValue = cleanText(valueEl.getAttribute('alt') || valueEl.textContent || '');
          const optionImg = safeSrc('img', variation) || '';

          results.push({
            title: title,
            titleCn: title,
            titleImage: imageUrls,
            optionName1: 'Variation',
            optionValue1: optionValue,
            option1Img: optionImg,
            imageLink: optionImg || imageUrls[0],
            link: window.location.href,
            price: price,
            type: 'amazon-product'
          });
        }
        break;
      }
    }

    // 옵션 없는 경우
    if (!hasVariations) {
      results.push({
        title: title,
        titleCn: title,
        titleImage: imageUrls,
        optionName1: '',
        optionValue1: '',
        option1Img: '',
        imageLink: imageUrls[0] || '',
        link: window.location.href,
        price: price,
        type: 'amazon-product'
      });
    }

    console.log('[Amazon] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'amazon',
      url: window.location.href,
      title: title,
      price: price,
      exportType: 'amazon-product'
    };

  } catch (error) {
    console.error('[Amazon Product Crawler] 오류:', error);
    throw error;
  }
}

/**
 * 아마존 검색 리스트 페이지 크롤러
 * URL: *.amazon.*/s?*
 */
export async function crawlAmazonList() {
  console.log('[Amazon List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자
    const productCards = document.querySelectorAll('[data-component-type="s-search-result"], .s-result-item[data-asin]');

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    console.log(`[Amazon List] 상품 카드 발견: ${productCards.length}개`);

    for (const card of productCards) {
      try {
        const asin = card.getAttribute('data-asin');
        if (!asin) continue;

        // 상품 링크
        const linkEl = card.querySelector('h2 a, .a-link-normal');
        if (!linkEl) continue;

        const productUrl = linkEl.href;

        // 상품명
        const titleEl = card.querySelector('h2 span, .a-text-normal');
        const title = titleEl ? cleanText(titleEl.textContent) : '';
        if (!title) continue;

        // 이미지
        const imgEl = card.querySelector('img.s-image');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src) : '';

        // 가격
        const priceEl = card.querySelector('.a-price .a-offscreen, .a-price-whole');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        // 평점
        const ratingEl = card.querySelector('.a-icon-alt');
        const rating = ratingEl ? cleanText(ratingEl.textContent) : '';

        results.push({
          title: title,
          titleCn: title,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          rating: rating,
          asin: asin,
          type: 'amazon-list'
        });

      } catch (err) {
        console.warn('[Amazon List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Amazon List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'amazon-list',
      url: window.location.href,
      title: `아마존 검색 결과 (${results.length}개)`,
      exportType: 'amazon-list'
    };

  } catch (error) {
    console.error('[Amazon List Crawler] 오류:', error);
    throw error;
  }
}
