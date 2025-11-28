/**
 * ==========================================
 * TAOBAO (타오바오) 크롤러
 * ==========================================
 * 사이트: item.taobao.com (상세), s.taobao.com (검색)
 * 중국 최대 온라인 쇼핑몰
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

/**
 * 타오바오 상품 상세 페이지 크롤러
 * URL: item.taobao.com/*
 */
export async function crawlTaobaoProduct() {
  console.log('[Taobao Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    await waitForElement('.tb-main-title', 3000);
    const titleEl = document.querySelector('.tb-main-title, h1[data-title]');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }
    const titleCn = cleanText(titleEl.textContent || titleEl.getAttribute('data-title'));

    console.log('[Taobao] 상품명:', titleCn);

    // 이미지 수집
    const imageUrls = [];
    const imageSelectors = [
      'ul#J_UlThumb img',
      '.tb-thumb img',
      '#J_ImgBooth img'
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

    console.log('[Taobao] 이미지 개수:', imageUrls.length);

    // SKU 옵션 추출
    const skuProps = document.querySelectorAll('.tb-sku .tb-prop');

    if (skuProps.length > 0) {
      // 옵션이 있는 경우
      for (const prop of skuProps) {
        const propName = prop.querySelector('.tb-property-type');
        const propValues = prop.querySelectorAll('li');

        if (!propName) continue;

        const optionName = cleanText(propName.textContent);

        for (const li of propValues) {
          const valueEl = li.querySelector('a, span');
          if (!valueEl) continue;

          const optionValue = cleanText(valueEl.textContent);
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
            type: 'taobao-product'
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
        type: 'taobao-product'
      });
    }

    // 가격 정보
    const priceEl = document.querySelector('.tb-rmb-num, .price-now');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    console.log('[Taobao] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'taobao',
      url: window.location.href,
      title: titleCn,
      price: price,
      exportType: 'taobao-product'
    };

  } catch (error) {
    console.error('[Taobao Product Crawler] 오류:', error);
    throw error;
  }
}

/**
 * 타오바오 검색 리스트 페이지 크롤러
 * URL: s.taobao.com/*
 */
export async function crawlTaobaoList() {
  console.log('[Taobao List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자
    const productSelectors = [
      '.m-itemlist .items .item',
      '.item.J_MouserOnverReq',
      '.grid .items .item'
    ];

    let productCards = [];

    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[Taobao List] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    for (const card of productCards) {
      try {
        // 상품 링크
        const linkEl = card.querySelector('a.pic-link, a.J_ClickStat');
        if (!linkEl) continue;

        let productUrl = linkEl.href;
        if (!productUrl.startsWith('http')) {
          productUrl = 'https:' + productUrl;
        }

        // 상품명
        const titleEl = card.querySelector('.title, .item-title');
        const titleCn = titleEl ? cleanText(titleEl.textContent) : '';
        if (!titleCn) continue;

        // 이미지
        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        // 가격
        const priceEl = card.querySelector('.price strong, .price');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        // 판매량
        const salesEl = card.querySelector('.deal-cnt');
        const sales = salesEl ? cleanText(salesEl.textContent) : '';

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          sales: sales,
          type: 'taobao-list'
        });

      } catch (err) {
        console.warn('[Taobao List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Taobao List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'taobao-list',
      url: window.location.href,
      title: `타오바오 검색 결과 (${results.length}개)`,
      exportType: 'taobao-list'
    };

  } catch (error) {
    console.error('[Taobao List Crawler] 오류:', error);
    throw error;
  }
}
