/**
 * ==========================================
 * TEMU (테무) 크롤러
 * ==========================================
 * 사이트: www.temu.com
 * 글로벌 저가 이커머스 플랫폼 (PDD 계열)
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * 테무 상품 상세 페이지 크롤러
 * URL: www.temu.com/*/g-*.html
 */
export async function crawlTemuProduct() {
  console.log('[Temu Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    await waitForElement('[data-testid="product-title"], h1', 3000);
    const titleEl = document.querySelector('[data-testid="product-title"], h1, .product-title');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const title = cleanText(titleEl.textContent);
    console.log('[Temu] 상품명:', title);

    // 이미지
    const imageUrls = [];
    const imageSelectors = [
      '[data-testid="product-image"]',
      '.product-carousel img',
      '.gallery img'
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

    console.log('[Temu] 이미지 개수:', imageUrls.length);

    // 가격
    const priceEl = document.querySelector('[data-testid="product-price"], .price, [class*="price"]');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    // 옵션 확인 (색상, 사이즈 등)
    const optionGroups = document.querySelectorAll('[data-testid="sku-selector"], .sku-group');

    if (optionGroups.length > 0) {
      // 옵션이 있는 경우
      for (const group of optionGroups) {
        const options = group.querySelectorAll('[class*="option"], button, .sku-item');

        for (const option of options) {
          const valueEl = option.querySelector('span, img');
          if (!valueEl) continue;

          const optionValue = cleanText(valueEl.textContent || valueEl.getAttribute('alt') || '');
          const optionImg = safeSrc('img', option) || '';

          results.push({
            title: title,
            titleCn: title,
            titleImage: imageUrls,
            optionName1: 'Option',
            optionValue1: optionValue,
            option1Img: optionImg,
            imageLink: optionImg || imageUrls[0],
            link: window.location.href,
            price: price,
            type: 'temu-product'
          });
        }
      }
    } else {
      // 옵션 없는 단일 상품
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
        type: 'temu-product'
      });
    }

    console.log('[Temu] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'temu',
      url: window.location.href,
      title: title,
      price: price,
      exportType: 'temu-product'
    };

  } catch (error) {
    console.error('[Temu Product Crawler] 오류:', error);
    throw error;
  }
}
