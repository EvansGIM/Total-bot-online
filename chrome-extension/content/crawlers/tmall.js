/**
 * ==========================================
 * TMALL (티몰) 크롤러
 * ==========================================
 * 사이트: detail.tmall.com (상세), list.tmall.com (검색)
 * 알리바바 그룹의 프리미엄 B2C 쇼핑몰
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * 티몰 상품 상세 페이지 크롤러
 * URL: detail.tmall.com/*, *.detail.tmall.com/*, detail.tmall.hk/*
 */
export async function crawlTmallProduct() {
  console.log('[Tmall Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    await waitForElement('.tb-detail-hd h1, h1[data-spm]', 3000);
    const titleEl = document.querySelector('.tb-detail-hd h1, h1[data-spm], .itemTitle');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }
    const titleCn = cleanText(titleEl.textContent);

    console.log('[Tmall] 상품명:', titleCn);

    // 이미지 수집
    const imageUrls = [];
    const imageSelectors = [
      '#J_UlThumb img',
      'ul.tb-thumb img',
      '.tb-gallery img'
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

    console.log('[Tmall] 이미지 개수:', imageUrls.length);

    // SKU 옵션 추출
    const skuModule = document.querySelector('#J_DetailMeta');
    const skuProps = document.querySelectorAll('.tm-clear .tb-prop, .J_TSaleProp');

    if (skuProps.length > 0) {
      // 옵션이 있는 경우
      for (const prop of skuProps) {
        const propName = prop.querySelector('.tb-property-type, dt');
        const propValues = prop.querySelectorAll('li, dd ul li');

        if (!propName) continue;

        const optionName = cleanText(propName.textContent);

        for (const li of propValues) {
          const valueEl = li.querySelector('a, span');
          if (!valueEl) continue;

          const optionValue = cleanText(valueEl.textContent || valueEl.getAttribute('title'));
          const optionImg = safeSrc('img', li) || '';

          results.push({
            title: titleCn,
            titleCn: titleCn,
            titleImage: imageUrls,
            optionName1: optionName,
            optionName1Cn: optionName,
            optionValue1: optionValue,
            option1Img: optionImg,
            imageLink: optionImg || imageUrls[0],
            link: window.location.href,
            type: 'tmall-product'
          });
        }
      }
    } else {
      // 옵션 없는 단일 상품
      results.push({
        title: titleCn,
        titleCn: titleCn,
        titleImage: imageUrls,
        optionName1: '',
        optionValue1: '',
        option1Img: '',
        imageLink: imageUrls[0] || '',
        link: window.location.href,
        type: 'tmall-product'
      });
    }

    // 가격 정보
    const priceEl = document.querySelector('.tm-price, .tb-rmb-num');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    console.log('[Tmall] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'tmall',
      url: window.location.href,
      title: titleCn,
      price: price,
      exportType: 'tmall-product'
    };

  } catch (error) {
    console.error('[Tmall Product Crawler] 오류:', error);
    throw error;
  }
}

/**
 * 티몰 검색 리스트 페이지 크롤러
 * URL: list.tmall.com/*, list.tmall.hk/*
 */
export async function crawlTmallList() {
  console.log('[Tmall List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자
    const productSelectors = [
      '#J_ItemList .product',
      '.product-item',
      '.item.product'
    ];

    let productCards = [];

    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[Tmall List] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    for (const card of productCards) {
      try {
        // 상품 링크
        const linkEl = card.querySelector('a.productImg, a.pic-link');
        if (!linkEl) continue;

        let productUrl = linkEl.href;
        if (!productUrl.startsWith('http')) {
          productUrl = 'https:' + productUrl;
        }

        // 상품명
        const titleEl = card.querySelector('.productTitle, .title');
        const titleCn = titleEl ? cleanText(titleEl.textContent) : '';
        if (!titleCn) continue;

        // 이미지
        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        // 가격
        const priceEl = card.querySelector('.productPrice, .price');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        // 판매량
        const salesEl = card.querySelector('.productStatus, .sale-num');
        const sales = salesEl ? cleanText(salesEl.textContent) : '';

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          sales: sales,
          type: 'tmall-list'
        });

      } catch (err) {
        console.warn('[Tmall List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Tmall List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'tmall-list',
      url: window.location.href,
      title: `티몰 검색 결과 (${results.length}개)`,
      exportType: 'tmall-list'
    };

  } catch (error) {
    console.error('[Tmall List Crawler] 오류:', error);
    throw error;
  }
}
