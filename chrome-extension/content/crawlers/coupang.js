/**
 * 쿠팡 크롤러
 * - 상품 상세 페이지 데이터 추출
 */

import { cleanImageUrl, safeSrc, cleanText, cleanPrice } from '../utils.js';

export async function crawlCoupangProduct() {
  console.log('[Coupang Crawler] 시작:', window.location.href);

  try {
    const data = {
      title: '',
      titleCn: '',  // 쿠팡은 한국어
      price: '',
      images: [],
      titleImage: [],
      options: [],
      description: '',
      url: window.location.href,
      timestamp: new Date().toISOString(),
      type: 'coupang'
    };

    // 상품명
    const titleEl = document.querySelector('.prod-buy-header__title');
    if (titleEl) {
      data.title = cleanText(titleEl.textContent);
      data.titleCn = data.title;  // 쿠팡은 한국어이므로 동일
    } else {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    console.log('[Coupang] 상품명:', data.title);

    // 가격
    const priceEl = document.querySelector('.total-price strong');
    if (priceEl) {
      data.price = cleanPrice(priceEl.textContent);
    }

    // 이미지
    const imageEls = document.querySelectorAll('.prod-image__item img');
    for (const img of imageEls) {
      const src = img.src;
      if (src && !src.startsWith('data:')) {
        data.images.push(cleanImageUrl(src));
        data.titleImage.push(cleanImageUrl(src));
      }
    }

    console.log('[Coupang] 이미지 개수:', data.images.length);

    // 옵션
    const optionGroups = document.querySelectorAll('.prod-option__item');
    for (const optGroup of optionGroups) {
      const nameEl = optGroup.querySelector('.prod-option__name');
      const valueEls = optGroup.querySelectorAll('.prod-option__value');

      if (nameEl && valueEls.length > 0) {
        const optionName = cleanText(nameEl.textContent);
        const optionValues = Array.from(valueEls).map(v => cleanText(v.textContent));

        data.options.push({
          name: optionName,
          values: optionValues
        });
      }
    }

    console.log('[Coupang] 옵션 개수:', data.options.length);

    // 상세 설명 (제한적)
    const descEl = document.querySelector('.prod-description');
    if (descEl) {
      data.description = cleanText(descEl.textContent).slice(0, 500);
    }

    console.log('[Coupang] 크롤링 완료');
    return {
      results: [data],
      title: data.title,
      exportType: 'coupang'
    };

  } catch (error) {
    console.error('[Coupang Crawler] 오류:', error);
    throw error;
  }
}
