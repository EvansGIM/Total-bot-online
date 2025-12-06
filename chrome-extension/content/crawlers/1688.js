/**
 * 1688.com 크롤러
 * - 신 UI 및 구 UI 모두 지원
 * - type1 ~ type4 옵션 구조 처리
 */

import { cleanImageUrl, isVideoOverlayOrIcon, safeSrc, waitForElement, safeClick, sleep, cleanText, cleanPrice } from '../utils.js';

// 가격 추출 헬퍼 함수 (강화됨 - 3단계 검색)
function extractPrice(element = document) {
  console.log('[가격 추출] 시작');

  const priceSelectors = [
    // 신 UI 가격 선택자들 (우선순위 높음)
    '[class*="promotion"] [class*="price"]',  // 프로모션 가격
    '[class*="sku"] [class*="price"]',        // SKU 가격
    '[class*="discountPrice"]',               // 할인 가격
    '.price-text',                            // 주요 가격
    '.price-original',                        // 원가
    '.discountPrice-price',                   // 할인 가격 (구 UI)
    '.price-now',                             // 현재 가격
    '.offer-price',                           // 제안 가격
    // 수량별 가격
    '[class*="priceRange"]',
    '[class*="price-range"]',
    // 일반 가격 클래스
    '[class*="price"]',                       // 가격 포함 클래스 모두
  ];

  // 1. 선택자로 찾기
  for (const selector of priceSelectors) {
    const priceEl = element.querySelector(selector);
    if (priceEl && priceEl.textContent.trim()) {
      const priceText = cleanPrice(priceEl.textContent);
      if (priceText && priceText !== '0' && priceText.match(/\d+/)) {
        console.log('[가격 추출] 성공 (선택자):', selector, '→', priceText);
        return priceText;
      }
    }
  }

  // 2. 텍스트로 ¥ 또는 元 기호 찾기
  console.log('[가격 추출] 선택자 실패, 텍스트 검색 시작');
  const bodyText = (element.innerText || element.textContent || '').substring(0, 5000); // 성능을 위해 앞부분만

  // ¥21.90, ¥16.9 같은 패턴 찾기
  const pricePatterns = [
    /¥\s*(\d+\.?\d*)/,           // ¥16.9, ¥21.90
    /￥\s*(\d+\.?\d*)/,           // ￥16.9
    /(\d+\.?\d*)\s*元/,           // 16.9元
    /价格[：:]\s*¥?(\d+\.?\d*)/,  // 价格：21.90
    /券后[：:]\s*¥?(\d+\.?\d*)/,  // 券后：16.9
  ];

  for (const pattern of pricePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[1]) {
      const price = match[1];
      console.log('[가격 추출] 성공 (텍스트):', pattern, '→', price);
      return price;
    }
  }

  // 3. 요소에서 ¥ 기호가 있는 것 찾기
  const allElements = element.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent;
    if (text && text.length < 100 && text.includes('¥')) {
      const match = text.match(/¥\s*(\d+\.?\d*)/);
      if (match && match[1] && parseFloat(match[1]) > 0) {
        const price = match[1];
        console.log('[가격 추출] 성공 (요소):', el.className, '→', price);
        return price;
      }
    }
  }

  console.warn('[가격 추출] 실패');
  return '';
}

export async function crawl1688Product() {
  console.log('[1688 Crawler] 시작:', window.location.href);

  try {
    // 페이지 유형 감지
    const isNewUI = !!document.querySelector('.title-content h1');
    const isOldUI = !!document.querySelector('.title-text');

    if (!isNewUI && !isOldUI) {
      throw new Error('1688 상품 페이지가 아닙니다.');
    }

    if (isNewUI) {
      console.log('[1688] 신 UI 감지');
      return await crawlNewUI();
    } else {
      console.log('[1688] 구 UI 감지');
      return await crawlOldUI();
    }
  } catch (error) {
    console.error('[1688 Crawler] 오류:', error);
    throw error;
  }
}

// 신 UI 크롤링
async function crawlNewUI() {
  const results = [];

  // 상품명
  const titleEl = document.querySelector('.title-content h1');
  if (!titleEl) {
    throw new Error('상품명을 찾을 수 없습니다.');
  }
  const titleCn = cleanText(titleEl.textContent);

  console.log('[신 UI] 상품명:', titleCn);

  // 대표 이미지
  const imageUrls = [];
  const imageElements = document.querySelectorAll('.img-list-wrapper img, .img-list-wrapper .od-gallery-img');

  for (const img of imageElements) {
    const src = img.getAttribute('src');
    if (src && !isVideoOverlayOrIcon(src)) {
      imageUrls.push(cleanImageUrl(src));
    }
  }

  console.log('[신 UI] 이미지 개수:', imageUrls.length);

  // 옵션 구조 감지 및 처리
  const hasTransverseFilter = !!document.querySelector('.transverse-filter');
  const hasExpandView = !!document.querySelector('.expand-view-list .expand-view-item');
  const hasFeatureItem = !!document.querySelector('.feature-item button.sku-filter-button');

  if (hasTransverseFilter) {
    // Type 3-A: 색상 + 사이즈
    console.log('[신 UI] Type 3-A: 색상 + 사이즈');
    const option1List = await extractTransverseOptions();

    for (const opt1 of option1List) {
      // 옵션1(색상) 클릭
      const btn = opt1.element;
      if (btn) {
        safeClick(btn);
        await sleep(50); // 속도 개선: 100ms → 50ms
      }

      // 옵션2(사이즈) + 가격 추출
      const expandItems = document.querySelectorAll('.expand-view-list .expand-view-item');
      for (const item of expandItems) {
        const opt2Label = item.querySelector('.item-label');

        if (!opt2Label) continue;

        const opt2Cn = cleanText(opt2Label.getAttribute('title') || opt2Label.textContent);

        // 가격 추출 개선
        let priceRaw = '';
        const priceEl = item.querySelector('.item-price-stock, .price, [class*="price"]');
        if (priceEl && priceEl.textContent.trim()) {
          priceRaw = cleanPrice(priceEl.textContent);
        }

        // 못 찾으면 전역에서 찾기
        if (!priceRaw) {
          priceRaw = extractPrice();
        }

        const opt2Price = priceRaw ? (priceRaw.includes(',') ? priceRaw.split(',') : [priceRaw]) : [''];

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrls,
          optionName1: opt1.name,
          optionName1Cn: opt1.nameCn,
          option1Img: opt1.img,
          optionName2: opt2Cn,
          optionName2Cn: opt2Cn,
          optionName2Price: opt2Price,
          imageLink: opt1.img,
          link: window.location.href,
          type: 'type3'
        });
      }
    }

  } else if (hasExpandView) {
    // Type 3-B: 사이즈만 (옵션1로 이동)
    console.log('[신 UI] Type 3-B: 사이즈만');
    const expandItems = document.querySelectorAll('.expand-view-list .expand-view-item');

    for (const item of expandItems) {
      const opt2Label = item.querySelector('.item-label');

      if (!opt2Label) continue;

      const opt2Cn = cleanText(opt2Label.getAttribute('title') || opt2Label.textContent);

      // 가격 추출 개선
      let priceRaw = '';
      const priceEl = item.querySelector('.item-price-stock, .price, [class*="price"]');
      if (priceEl && priceEl.textContent.trim()) {
        priceRaw = cleanPrice(priceEl.textContent);
      }

      // 못 찾으면 전역에서 찾기
      if (!priceRaw) {
        priceRaw = extractPrice();
      }

      const opt2Price = priceRaw ? (priceRaw.includes(',') ? priceRaw.split(',') : [priceRaw]) : [''];

      // 옵션 이미지 추출
      const opt2Img = safeSrc('img.ant-image-img, .item-image-icon, .v-image-wrap img', item) || '';

      results.push({
        title: titleCn,
        titleCn: titleCn,
        titleImage: imageUrls,
        optionName1: opt2Cn,  // 옵션2 → 옵션1
        optionName1Cn: opt2Cn,
        option1Img: opt2Img,
        optionName2: '',
        optionName2Cn: '',
        optionName2Price: opt2Price,
        imageLink: opt2Img,
        link: window.location.href,
        type: 'type3'
      });
    }

  } else if (hasFeatureItem) {
    // Type 4: 썸네일 버튼만
    console.log('[신 UI] Type 4: 썸네일 버튼만');
    const buttons = document.querySelectorAll('.feature-item button.sku-filter-button');

    // 전역 가격 추출 (한 번만)
    const globalPrice = extractPrice();

    for (const btn of buttons) {
      const labelEl = btn.querySelector('span.label-name');
      if (!labelEl) continue;

      const labelCn = cleanText(labelEl.textContent);
      const thumb = safeSrc('img.ant-image-img', btn);

      results.push({
        title: titleCn,
        titleCn: titleCn,
        titleImage: imageUrls,
        optionName1: labelCn,
        optionName1Cn: labelCn,
        option1Img: thumb,
        optionName2: '',
        optionName2Cn: '',
        optionName2Price: globalPrice ? [globalPrice] : [],
        imageLink: thumb,
        link: window.location.href,
        type: 'type4'
      });
    }
  } else {
    throw new Error('옵션 구조를 인식할 수 없습니다.');
  }

  console.log('[신 UI] 수집 완료:', results.length, '개');
  return {
    results,
    title: titleCn,
    exportType: results[0]?.type || 'unknown'
  };
}

// transverse-filter (색상) 옵션 추출
async function extractTransverseOptions() {
  const options = [];
  const transEl = document.querySelector('.transverse-filter');
  if (!transEl) return options;

  const buttons = transEl.querySelectorAll('button.sku-filter-button');

  for (const btn of buttons) {
    const labelEl = btn.querySelector('span.label-name');
    if (!labelEl) continue;

    const labelCn = cleanText(labelEl.textContent);
    const thumb = safeSrc('img.ant-image-img', btn);

    options.push({
      name: labelCn,
      nameCn: labelCn,
      img: thumb,
      element: btn
    });
  }

  return options;
}

// 구 UI 크롤링
async function crawlOldUI() {
  const results = [];

  // 상품명
  await waitForElement('.title-text', 3000);
  const titleEl = document.querySelector('.title-text');
  const titleCn = cleanText(titleEl.textContent);

  console.log('[구 UI] 상품명:', titleCn);

  // "더보기" 버튼 클릭 (옵션 펼치기)
  const expandBtn = document.querySelector('.sku-wrapper-expend-button');
  if (expandBtn) {
    safeClick(expandBtn);
    await sleep(50); // 속도 개선: 100ms → 50ms
  }

  // 대표 이미지
  const imageUrls = [];
  const imgWrapper = document.querySelector('.img-list-wrapper');

  if (imgWrapper) {
    const turns = imgWrapper.querySelectorAll('.detail-gallery-turn-wrapper');
    for (const turn of turns) {
      // 비디오 아이콘이 없는 경우만
      if (turn.querySelector('.video-icon')) continue;

      const imgSrc = safeSrc('.detail-gallery-img', turn);
      if (imgSrc) {
        imageUrls.push(imgSrc);
      }
    }
  }

  console.log('[구 UI] 이미지 개수:', imageUrls.length);

  // 옵션 구조 감지
  const propItems = document.querySelectorAll('.prop-item');

  if (propItems.length > 0) {
    // Type 1: 옵션1(색상) + 옵션2(사이즈)
    console.log('[구 UI] Type 1: 옵션1 + 옵션2');

    for (const propItem of propItems) {
      const propNameEl = propItem.querySelector('.prop-name');
      if (!propNameEl) continue;

      const opt1Cn = cleanText(propNameEl.getAttribute('title') || propNameEl.textContent);
      const thumb = safeSrc('img.prop-img, .prop-img, .ant-image-img', propItem) || '';

      // 옵션1 클릭
      try {
        propNameEl.click();
        await sleep(50); // 속도 개선: 100ms → 50ms
      } catch (e) {
        console.warn('옵션1 클릭 실패:', e);
      }

      // 옵션2(사이즈) + 가격 추출
      const opt2Names = [];
      const opt2NamesCn = [];
      const opt2Prices = [];

      const skuItems = document.querySelectorAll('.count-widget-wrapper .sku-item-wrapper');
      for (const sku of skuItems) {
        const nameEl = sku.querySelector('.sku-item-name');

        if (nameEl) {
          const opt2Cn = cleanText(nameEl.textContent);

          // 가격 추출 개선
          let priceRaw = '';
          const priceSelectors = ['.discountPrice-price', '.price-text', '.price', '[class*="price"]'];

          for (const selector of priceSelectors) {
            const priceEl = sku.querySelector(selector);
            if (priceEl && priceEl.textContent.trim()) {
              priceRaw = cleanPrice(priceEl.textContent);
              if (priceRaw) break;
            }
          }

          // 못 찾으면 전역에서 찾기
          if (!priceRaw) {
            priceRaw = extractPrice();
          }

          opt2Names.push(opt2Cn);
          opt2NamesCn.push(opt2Cn);
          opt2Prices.push(priceRaw);
        }
      }

      results.push({
        title: titleCn,
        titleCn: titleCn,
        titleImage: imageUrls,
        optionName1: opt1Cn,
        optionName1Cn: opt1Cn,
        imageLink: thumb,
        optionName2: opt2Names.join(','),
        optionName2Cn: opt2NamesCn.join(','),
        optionName2Price: opt2Prices,
        link: window.location.href,
        type: 'type1'
      });
    }

  } else {
    // Type 2: 옵션1(사이즈)만
    console.log('[구 UI] Type 2: 옵션1만');

    const opt2Names = [];
    const opt2NamesCn = [];
    const opt2Prices = [];
    const opt2Imgs = [];

    const skuItems = document.querySelectorAll('.count-widget-wrapper .sku-item-wrapper');
    for (const sku of skuItems) {
      const nameEl = sku.querySelector('.sku-item-name');

      if (nameEl) {
        const opt2Cn = cleanText(nameEl.textContent);

        // 가격 추출 개선
        let priceRaw = '';
        const priceSelectors = ['.discountPrice-price', '.price-text', '.price', '[class*="price"]'];

        for (const selector of priceSelectors) {
          const priceEl = sku.querySelector(selector);
          if (priceEl && priceEl.textContent.trim()) {
            priceRaw = cleanPrice(priceEl.textContent);
            if (priceRaw) break;
          }
        }

        // 못 찾으면 전역에서 찾기
        if (!priceRaw) {
          priceRaw = extractPrice();
        }

        const imgSrc = safeSrc('.sku-item-image img, .sku-item-image, .sku-item-img', sku) || '';

        opt2Names.push(opt2Cn);
        opt2NamesCn.push(opt2Cn);
        opt2Prices.push(priceRaw);
        opt2Imgs.push(imgSrc);
      }
    }

    results.push({
      title: titleCn,
      titleCn: titleCn,
      titleImage: imageUrls,
      optionName1: opt2Names,  // 배열로 저장
      optionName1Cn: opt2NamesCn,
      imageLink: opt2Imgs,
      optionName2: '',
      optionName2Cn: '',
      optionName2Price: opt2Prices,
      link: window.location.href,
      type: 'type2'
    });
  }

  console.log('[구 UI] 수집 완료:', results.length, '개');
  return {
    results,
    title: titleCn,
    exportType: results[0]?.type || 'unknown'
  };
}

// ===== 리스트 페이지 크롤러 (s.1688.com) =====
export async function crawl1688ListPage() {
  console.log('[1688 List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자 (여러 패턴 지원 - 2024/2025 신 UI 포함)
    const productSelectors = [
      '.search-offer-item',                       // 2024/2025 신 UI (메인)
      '.search-offer-wrapper',                    // 2024/2025 신 UI
      '.major-offer',                             // 2024/2025 신 UI
      'a[data-tracker="offer"]',                  // data 속성 기반
      '.sm-floorhead-offerlist .sm-offer-item',  // 구 UI
      '.offer-item',                              // 구 UI
      '.seo-offer-item',                          // SEO 페이지
      '.sm-offer-wrapper .list-item',            // 리스트 뷰
    ];

    let productCards = [];

    // 상품 카드 찾기
    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[1688 List] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
      // 디버깅: 페이지 구조 로그
      console.log('[1688 List] 페이지 구조 디버깅:');
      console.log('  - .feeds-wrapper:', document.querySelectorAll('.feeds-wrapper').length);
      console.log('  - a[href*="detail"]:', document.querySelectorAll('a[href*="detail"]').length);
      console.log('  - .offer:', document.querySelectorAll('[class*="offer"]').length);
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    // 각 상품 카드에서 정보 추출
    for (const card of productCards) {
      try {
        // 상품 링크 (2024/2025 신 UI: 카드 자체가 a 태그이거나, 내부에 있음)
        let productUrl = '';

        // 카드 자체가 a 태그인 경우
        if (card.tagName === 'A' && card.href) {
          productUrl = card.href;
        } else {
          // 내부에서 링크 찾기
          const linkEl = card.querySelector('a[href*="detail.1688.com"], a[href*="detail.m.1688.com"], a.sm-offer-item-link, a.offer-title-link');
          if (linkEl) {
            productUrl = linkEl.href;
          }
        }

        if (!productUrl) continue;

        // 광고/리다이렉트 URL 필터링
        if (productUrl.includes('dj.1688.com') || productUrl.includes('click.1688.com')) {
          console.log('[1688 List] 광고 URL 스킵:', productUrl.substring(0, 50));
          continue;
        }

        // URL 정규화
        if (!productUrl.startsWith('http')) {
          productUrl = 'https:' + productUrl;
        }

        // 모바일 URL에서 offerId 추출하여 데스크탑 URL로 변환
        if (productUrl.includes('detail.m.1688.com')) {
          const offerIdMatch = productUrl.match(/offerId=(\d+)/);
          if (offerIdMatch) {
            productUrl = `https://detail.1688.com/offer/${offerIdMatch[1]}.html`;
          }
        }

        // offerId가 URL에 직접 있는 경우 정리 (쿼리스트링 제거)
        if (productUrl.includes('detail.1688.com/offer/')) {
          const offerMatch = productUrl.match(/detail\.1688\.com\/offer\/(\d+)/);
          if (offerMatch) {
            productUrl = `https://detail.1688.com/offer/${offerMatch[1]}.html`;
          }
        }

        // 상품명 (2024/2025 신 UI)
        const titleSelectors = [
          '.offer-title-row .title-text',  // 2024/2025 신 UI
          '.title-text',                   // 2024/2025 신 UI 단축
          '.sm-offer-title',               // 구 UI
          '.offer-title',                  // 구 UI
          '.title'                         // 일반
        ];

        let titleCn = '';
        for (const sel of titleSelectors) {
          const titleEl = card.querySelector(sel);
          if (titleEl && titleEl.textContent.trim()) {
            titleCn = cleanText(titleEl.textContent);
            break;
          }
        }

        if (!titleCn) continue;

        // 이미지 (2024/2025 신 UI)
        const imgSelectors = [
          'img.main-img',                  // 2024/2025 신 UI
          '.offer-img-wrapper img',        // 2024/2025 신 UI
          'img.sm-offer-image',            // 구 UI
          'img.offer-image',               // 구 UI
          'img[src*="cbu01.alicdn.com"]',  // alicdn 이미지
          'img[src*="cbu02.alicdn.com"]'   // alicdn 이미지
        ];

        let imageUrl = '';
        for (const sel of imgSelectors) {
          const imgEl = card.querySelector(sel);
          if (imgEl && imgEl.src) {
            imageUrl = cleanImageUrl(imgEl.src);
            break;
          }
        }

        // 가격 (2024/2025 신 UI)
        const priceSelectors = [
          '.price-item .text-main',        // 2024/2025 신 UI
          '.offer-price-row .text-main',   // 2024/2025 신 UI
          '.price-text',                   // 구 UI
          '.price',                        // 일반
          '.sm-offer-price'                // 구 UI
        ];

        let price = '';
        for (const sel of priceSelectors) {
          const priceEl = card.querySelector(sel);
          if (priceEl && priceEl.textContent.trim()) {
            price = cleanPrice(priceEl.textContent);
            break;
          }
        }

        // 판매자 정보
        const shopSelectors = [
          '.offer-desc-item .desc-text',   // 2024/2025 신 UI (첫번째는 보통 판매자)
          '.sm-offer-shop',
          '.shop-name',
          '.seller-name'
        ];

        let shopName = '';
        for (const sel of shopSelectors) {
          const shopEl = card.querySelector(sel);
          if (shopEl && shopEl.textContent.trim()) {
            shopName = cleanText(shopEl.textContent);
            break;
          }
        }

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          shopName: shopName,
          type: '1688-list'
        });

      } catch (err) {
        console.warn('[1688 List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[1688 List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: '1688-list',
      url: window.location.href,
      title: `1688 검색 결과 (${results.length}개)`,
      exportType: '1688-list'
    };

  } catch (error) {
    console.error('[1688 List Crawler] 오류:', error);
    throw error;
  }
}

// ===== 쇼케이스 페이지 크롤러 (show.1688.com) =====
export async function crawl1688ShowPage() {
  console.log('[1688 Show Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 쇼케이스 상품 카드 선택자
    const productSelectors = [
      '.exhibition-offer-item',              // 전시회 페이지
      '.show-offer-item',                    // 쇼케이스 페이지
      '.expo-offer-card',                    // 엑스포 카드
      '.offer-card-wrapper',                 // 일반 카드
      'div[class*="offer"]'                  // 백업 선택자
    ];

    let productCards = [];

    // 상품 카드 찾기
    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[1688 Show] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
      // 대체 방법: 모든 링크에서 detail.1688.com 포함된 것 찾기
      const allLinks = document.querySelectorAll('a[href*="detail.1688.com"]');
      console.log(`[1688 Show] 대체 방법: ${allLinks.length}개 링크 발견`);

      for (const link of allLinks) {
        const container = link.closest('div[class*="item"], li[class*="item"]');
        if (container) {
          productCards = [container];
          break;
        }
      }
    }

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    // 각 상품 카드에서 정보 추출
    for (const card of productCards) {
      try {
        // 상품 링크
        const linkEl = card.querySelector('a[href*="detail.1688.com"], a[href*="/offer/"]');
        if (!linkEl) continue;

        let productUrl = linkEl.href;
        if (!productUrl.startsWith('http')) {
          productUrl = 'https:' + productUrl;
        }

        // 상품명
        const titleSelectors = [
          '.offer-title',
          '.title',
          '.product-name',
          'h3',
          'h4',
          'a[title]'
        ];

        let titleCn = '';
        for (const selector of titleSelectors) {
          const titleEl = card.querySelector(selector);
          if (titleEl) {
            titleCn = cleanText(titleEl.textContent || titleEl.getAttribute('title') || '');
            if (titleCn) break;
          }
        }

        if (!titleCn) continue;

        // 이미지
        const imgEl = card.querySelector('img[src*="cbu01.alicdn.com"], img[src*="cbu02.alicdn.com"], img.offer-image, img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        // 가격
        const priceSelectors = ['.price', '.offer-price', 'span[class*="price"]'];
        let price = '';
        for (const selector of priceSelectors) {
          const priceEl = card.querySelector(selector);
          if (priceEl) {
            price = cleanPrice(priceEl.textContent);
            if (price) break;
          }
        }

        // 판매자 정보
        const shopEl = card.querySelector('.shop-name, .seller-name, .company-name');
        const shopName = shopEl ? cleanText(shopEl.textContent) : '';

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          shopName: shopName,
          type: '1688-show'
        });

      } catch (err) {
        console.warn('[1688 Show] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[1688 Show] 수집 완료:', results.length, '개');

    return {
      results,
      platform: '1688-show',
      url: window.location.href,
      title: `1688 쇼케이스 (${results.length}개)`,
      exportType: '1688-show'
    };

  } catch (error) {
    console.error('[1688 Show Crawler] 오류:', error);
    throw error;
  }
}
