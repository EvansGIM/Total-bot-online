/**
 * 크롤링 공통 유틸리티
 * - 이미지 URL 정리
 * - 데이터 추출 헬퍼
 */

// 서버 URL 설정
const SERVER_URL = 'https://totalbot.cafe24.com/node-api';

// 인증 토큰 가져오기 (content script용)
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], (result) => {
      resolve(result.authToken || null);
    });
  });
}

// 인증 헤더 포함 fetch 함수
async function authFetch(url, options = {}) {
  const token = await getAuthToken();

  if (!token) {
    throw new Error('로그인이 필요합니다.');
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };

  if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    ...options,
    headers
  });
}

// 이미지 URL 정리 (Python _clean_img 함수 포팅)
function cleanImageUrl(url) {
  if (!url) return '';

  // 쿼리 스트링 제거
  const urlObj = new URL(url);
  let cleanUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // 1) 썸네일 꼬리 제거 (_sum, _b)
  cleanUrl = cleanUrl.replace(/_(?:sum|b)(?=\.(jpe?g|png)$)/i, '');

  // 2) 사이즈·품질 꼬리 제거 (_60x60q90 등)
  cleanUrl = cleanUrl.replace(/_[0-9]+x[0-9]+q[0-9]+/i, '');

  // 3) 중복 확장자 제거 (.jpg.jpg → .jpg)
  cleanUrl = cleanUrl.replace(/\.(jpe?g|png)\.(jpe?g|png|webp)$/i, '.$1');

  // 4) 작은 숫자 꼬리 제거 (_1, -0, _12 등 1~2자리)
  cleanUrl = cleanUrl.replace(/[-_][0-9]{1,2}(?=\.(jpe?g|png)$)/i, '');

  // 5) 첫 확장자까지만
  const extMatch = cleanUrl.match(/\.(jpe?g|png)/i);
  if (extMatch) {
    cleanUrl = cleanUrl.substring(0, extMatch.index + extMatch[0].length);
  }

  return cleanUrl;
}

// 비디오 오버레이/아이콘 확인
function isVideoOverlayOrIcon(url) {
  if (!url) return false;

  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes('video') ||
    lowerUrl.includes('play') ||
    /-tps-\d+\.(png|jpe?g|webp)$/i.test(url) ||
    /\/imgextra\/i\d\/.+-(?:1|2)-tps-\d+\.(png|jpe?g|webp)$/i.test(url) ||
    // 추가: 작은 아이콘/플레이스홀더 이미지 필터링
    /imgextra.*tps-\d+\.png/i.test(url) ||  // imgextra의 tps 이미지
    /tps-48\.png/i.test(url) ||              // 48px 아이콘
    /tps-32\.png/i.test(url) ||              // 32px 아이콘
    /!!6000000005190/i.test(url)             // 특정 플레이스홀더 ID
  );
}

// 안전한 이미지 소스 추출 (img src 또는 background-image)
function safeSrc(selector, root = document) {
  try {
    const elements = root.querySelectorAll(selector);

    for (const el of elements) {
      // <img src="...">
      const src = el.getAttribute('src');
      if (src && !src.startsWith('data:')) {
        return cleanImageUrl(src);
      }

      // background-image: url(...)
      const style = el.getAttribute('style') || '';
      const bgMatch = style.match(/url\((['"']?)(.*?)\1\)/);
      if (bgMatch && bgMatch[2]) {
        return cleanImageUrl(bgMatch[2]);
      }
    }
  } catch (error) {
    console.error('safeSrc 오류:', error);
  }

  return '';
}

// 요소가 보일 때까지 대기
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`요소를 찾을 수 없습니다: ${selector}`));
    }, timeout);
  });
}

// 요소 클릭 (스크롤 포함)
function safeClick(element) {
  try {
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      element.click();
    }, 100);
    return true;
  } catch (error) {
    console.error('클릭 오류:', error);
    return false;
  }
}

// 대기 함수
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 텍스트 정리
function cleanText(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

// 가격 정리 (¥, 元 제거)
function cleanPrice(price) {
  if (!price) return '';
  return price.replace(/[¥元,\s]/g, '').trim();
}
/**
 * 1688.com 크롤러
 * - 신 UI 및 구 UI 모두 지원
 * - type1 ~ type4 옵션 구조 처리
 */

async function crawl1688Product() {
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

// 가격 추출 함수 (여러 선택자 시도) - 강화됨
function extractPriceFromPage() {
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
    // 수량별 가격
    '[class*="priceRange"]',
    '[class*="price-range"]',
    // 일반 가격 클래스
    '[class*="price"]',                       // 가격 포함 클래스 모두
  ];

  // 1. 선택자로 찾기
  for (const selector of priceSelectors) {
    const priceEl = document.querySelector(selector);
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
  const bodyText = document.body.innerText || document.body.textContent || '';

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

  // 3. 모든 요소에서 ¥ 기호가 있는 것 찾기
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent;
    if (text && text.includes('¥')) {
      const match = text.match(/¥\s*(\d+\.?\d*)/);
      if (match && match[1] && parseFloat(match[1]) > 0) {
        const price = match[1];
        console.log('[가격 추출] 성공 (요소 검색):', el.className, '→', price);
        return price;
      }
    }
  }

  console.warn('[가격 추출] 실패: 가격을 찾을 수 없습니다');
  return '';
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

  // 중복 제거
  const uniqueImageUrls = [...new Set(imageUrls)];
  console.log('[신 UI] 이미지 개수:', uniqueImageUrls.length);

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

        // 가격 추출 개선: 여러 선택자 시도
        let priceRaw = '';

        // 1. item 내부에서 먼저 찾기
        const itemPriceEl = item.querySelector('.item-price-stock, .price, [class*="price"]');
        if (itemPriceEl && itemPriceEl.textContent.trim()) {
          priceRaw = cleanPrice(itemPriceEl.textContent);
        }

        // 2. 못 찾았으면 페이지 전체에서 찾기
        if (!priceRaw) {
          priceRaw = extractPriceFromPage();
        }

        const prices = priceRaw ? (priceRaw.includes(',') ? priceRaw.split(',') : [priceRaw]) : [''];

        // 가격별로 개별 행 생성 (수량별 단가 분리)
        for (let i = 0; i < prices.length; i++) {
          const price = prices[i].trim();
          results.push({
            title: titleCn,
            titleCn: titleCn,
            titleImage: uniqueImageUrls,
            optionName1: opt1.name,
            optionName1Cn: opt1.nameCn,
            option1Img: opt1.img,
            optionName2: opt2Cn,
            optionName2Cn: opt2Cn,
            price: price,  // 추가: 편집 페이지에서 사용
            optionName2Price: price,  // 기존 호환성
            imageLink: opt1.img,
            link: window.location.href,
            type: 'type3'
          });
        }
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

      const itemPriceEl = item.querySelector('.item-price-stock, .price, [class*="price"]');
      if (itemPriceEl && itemPriceEl.textContent.trim()) {
        priceRaw = cleanPrice(itemPriceEl.textContent);
      }

      if (!priceRaw) {
        priceRaw = extractPriceFromPage();
      }

      const prices = priceRaw ? (priceRaw.includes(',') ? priceRaw.split(',') : [priceRaw]) : [''];

      // 옵션 이미지 추출
      const opt2Img = safeSrc('img.ant-image-img, .item-image-icon, .v-image-wrap img', item) || '';

      // 가격별로 개별 행 생성
      for (let i = 0; i < prices.length; i++) {
        const price = prices[i].trim();
        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: uniqueImageUrls,
          optionName1: opt2Cn,  // 옵션2 → 옵션1
          optionName1Cn: opt2Cn,
          option1Img: opt2Img,
          optionName2: '',
          optionName2Cn: '',
          price: price,  // 추가: 편집 페이지에서 사용
          optionName2Price: price,  // 기존 호환성
          imageLink: opt2Img,
          link: window.location.href,
          type: 'type3'
        });
      }
    }

  } else if (hasFeatureItem) {
    // Type 4: 썸네일 버튼만
    console.log('[신 UI] Type 4: 썸네일 버튼만');
    const buttons = document.querySelectorAll('.feature-item button.sku-filter-button');

    // 전역 가격 추출 (한 번만)
    const globalPrice = extractPriceFromPage();

    for (const btn of buttons) {
      const labelEl = btn.querySelector('span.label-name');
      if (!labelEl) continue;

      const labelCn = cleanText(labelEl.textContent);
      const thumb = safeSrc('img.ant-image-img', btn);

      results.push({
        title: titleCn,
        titleCn: titleCn,
        titleImage: uniqueImageUrls,
        optionName1: labelCn,
        optionName1Cn: labelCn,
        option1Img: thumb,
        optionName2: '',
        optionName2Cn: '',
        price: globalPrice,  // 추가: 편집 페이지에서 사용
        optionName2Price: globalPrice,  // 기존 호환성
        imageLink: thumb,
        link: window.location.href,
        type: 'type4'
      });
    }
  } else {
    throw new Error('옵션 구조를 인식할 수 없습니다.');
  }

  console.log('[신 UI] 수집 완료:', results.length, '개');

  // mainImage 선택: 실제 상품 이미지 우선 (cib.jpg, ibank)
  // 1순위: ibank + cib 패턴의 실제 상품 이미지
  // 2순위: 옵션의 imageLink
  // 3순위: uniqueImageUrls의 두 번째 이미지 (첫 번째는 아이콘일 수 있음)
  let mainImage = '';

  for (const imgUrl of uniqueImageUrls) {
    if (imgUrl.includes('ibank') && imgUrl.includes('cib')) {
      mainImage = imgUrl;
      break;
    }
  }

  // 못 찾았으면 옵션의 이미지 사용
  if (!mainImage && results.length > 0 && results[0].imageLink) {
    mainImage = results[0].imageLink;
  }

  // 그래도 없으면 두 번째 이미지 사용 (첫 번째는 아이콘일 수 있음)
  if (!mainImage && uniqueImageUrls.length > 1) {
    mainImage = uniqueImageUrls[1];
  }

  // 최후의 수단
  if (!mainImage && uniqueImageUrls.length > 0) {
    mainImage = uniqueImageUrls[0];
  }

  return {
    results,
    platform: '1688-product',
    url: window.location.href,
    mainImage: mainImage,
    images: uniqueImageUrls.slice(1, 6), // 추가 이미지 최대 5개
    titleCn: titleCn,
    title: '', // 서버에서 번역
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

  // 중복 제거
  const uniqueImageUrls = [...new Set(imageUrls)];
  console.log('[구 UI] 이미지 개수:', uniqueImageUrls.length);

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
      const skuItems = document.querySelectorAll('.count-widget-wrapper .sku-item-wrapper');
      for (const sku of skuItems) {
        const nameEl = sku.querySelector('.sku-item-name');

        if (!nameEl) continue;

        const opt2Cn = cleanText(nameEl.textContent);

        // 가격 추출 개선: 여러 선택자 시도
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
          priceRaw = extractPriceFromPage();
        }

        // 각 사이즈마다 개별 행 생성
        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: uniqueImageUrls,
          optionName1: opt1Cn,
          optionName1Cn: opt1Cn,
          imageLink: thumb,
          optionName2: opt2Cn,
          optionName2Cn: opt2Cn,
          price: priceRaw,  // 추가: 편집 페이지에서 사용
          optionName2Price: priceRaw,  // 기존 호환성
          link: window.location.href,
          type: 'type1'
        });
      }
    }

  } else {
    // Type 2: 옵션1(사이즈)만
    console.log('[구 UI] Type 2: 옵션1만');

    const skuItems = document.querySelectorAll('.count-widget-wrapper .sku-item-wrapper');
    for (const sku of skuItems) {
      const nameEl = sku.querySelector('.sku-item-name');

      if (!nameEl) continue;

      const opt2Cn = cleanText(nameEl.textContent);

      // 가격 추출 개선: 여러 선택자 시도
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
        priceRaw = extractPriceFromPage();
      }

      const imgSrc = safeSrc('.sku-item-image img, .sku-item-image, .sku-item-img', sku) || '';

      // 각 옵션마다 개별 행 생성
      results.push({
        title: titleCn,
        titleCn: titleCn,
        titleImage: uniqueImageUrls,
        optionName1: opt2Cn,
        optionName1Cn: opt2Cn,
        imageLink: imgSrc,
        optionName2: '',
        optionName2Cn: '',
        price: priceRaw,  // 추가: 편집 페이지에서 사용
        optionName2Price: priceRaw,  // 기존 호환성
        link: window.location.href,
        type: 'type2'
      });
    }
  }

  console.log('[구 UI] 수집 완료:', results.length, '개');

  // mainImage 선택: 실제 상품 이미지 우선 (cib.jpg, ibank)
  // 1순위: ibank + cib 패턴의 실제 상품 이미지
  // 2순위: 옵션의 imageLink
  // 3순위: uniqueImageUrls의 두 번째 이미지 (첫 번째는 아이콘일 수 있음)
  let mainImage = '';

  for (const imgUrl of uniqueImageUrls) {
    if (imgUrl.includes('ibank') && imgUrl.includes('cib')) {
      mainImage = imgUrl;
      break;
    }
  }

  // 못 찾았으면 옵션의 이미지 사용
  if (!mainImage && results.length > 0 && results[0].imageLink) {
    mainImage = results[0].imageLink;
  }

  // 그래도 없으면 두 번째 이미지 사용 (첫 번째는 아이콘일 수 있음)
  if (!mainImage && uniqueImageUrls.length > 1) {
    mainImage = uniqueImageUrls[1];
  }

  // 최후의 수단
  if (!mainImage && uniqueImageUrls.length > 0) {
    mainImage = uniqueImageUrls[0];
  }

  return {
    results,
    platform: '1688-product',
    url: window.location.href,
    mainImage: mainImage,
    images: uniqueImageUrls.slice(1, 6), // 추가 이미지 최대 5개
    titleCn: titleCn,
    title: '', // 서버에서 번역
    exportType: results[0]?.type || 'unknown'
  };
}
/**
 * 쿠팡 크롤러
 * - 상품 상세 페이지 데이터 추출
 */

async function crawlCoupangProduct() {
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
/**
 * 알리익스프레스 크롤러
 * - 상품 상세 페이지 데이터 추출
 */

async function crawlAliexpressProduct() {
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

// ===== content.js 메인 로직 =====

console.log('[TotalBot] Content Script 로드됨:', window.location.href);

// 현재 페이지 유형 감지
function detectPageType() {
  const url = window.location.href;
  const hostname = window.location.hostname;

  // 1688
  if (hostname.includes('1688.com')) {
    if (url.includes('/offer/') || url.includes('detail.1688.com')) {
      return '1688-product';
    } else if (url.includes('s.1688.com')) {
      return '1688-list';
    } else if (url.includes('show.1688.com')) {
      return '1688-show';
    }
    return '1688-other';
  }

  // AliExpress
  else if (hostname.includes('aliexpress.com')) {
    if (url.includes('/item/')) {
      return 'aliexpress-product';
    } else if (url.includes('wholesale') || url.includes('category') || url.includes('/af/')) {
      return 'aliexpress-list';
    }
    return 'aliexpress-other';
  }

  // Taobao
  else if (hostname.includes('taobao.com')) {
    if (url.includes('item.taobao.com')) {
      return 'taobao-product';
    } else if (url.includes('s.taobao.com')) {
      return 'taobao-list';
    }
    return 'taobao-other';
  }

  // Tmall
  else if (hostname.includes('tmall.com') || hostname.includes('tmall.hk')) {
    if (url.includes('detail.tmall')) {
      return 'tmall-product';
    } else if (url.includes('list.tmall')) {
      return 'tmall-list';
    }
    return 'tmall-other';
  }

  // Amazon
  else if (hostname.includes('amazon.')) {
    if (url.includes('/dp/') || url.includes('/gp/product/')) {
      return 'amazon-product';
    } else if (url.includes('/s?') || url.includes('/s/')) {
      return 'amazon-list';
    }
    return 'amazon-other';
  }

  // Rakuten
  else if (hostname.includes('rakuten.co.jp')) {
    if (url.includes('item.rakuten.co.jp')) {
      return 'rakuten-product';
    } else if (url.includes('search.rakuten') || url.includes('/category/')) {
      return 'rakuten-list';
    }
    return 'rakuten-other';
  }

  // VVIC
  else if (hostname.includes('vvic.com')) {
    if (url.includes('/item/') || url.includes('/gz/')) {
      return 'vvic-product';
    } else {
      return 'vvic-list';
    }
  }

  // Temu
  else if (hostname.includes('temu.com')) {
    if (url.includes('/g-')) {
      return 'temu-product';
    }
    return 'temu-other';
  }

  // Domeggook
  else if (hostname.includes('domeggook.com') && !hostname.includes('domeme')) {
    if (url.includes('/product/') || url.includes('/item/')) {
      return 'domeggook-product';
    } else {
      return 'domeggook-list';
    }
  }

  // Domeme
  else if (hostname.includes('domeme')) {
    if (url.includes('/product/') || url.includes('/item/')) {
      return 'domeme-product';
    } else {
      return 'domeme-list';
    }
  }

  // Ownerclan
  else if (hostname.includes('ownerclan.com')) {
    if (url.includes('/product/') || url.includes('/item/')) {
      return 'ownerclan-product';
    } else {
      return 'ownerclan-list';
    }
  }

  // Coupang
  else if (hostname.includes('coupang.com')) {
    if (url.includes('/vp/products/')) {
      return 'coupang-product';
    }
    return 'coupang-other';
  }

  return 'unknown';
}

/**
 * 1688 리스트 페이지 크롤러 (s.1688.com)
 */
async function crawl1688ListPage() {
  console.log('[1688 List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품 카드 선택자 (여러 패턴 지원)
    const productSelectors = [
      '.sm-floorhead-offerlist .sm-offer-item',
      '.offer-item',
      '.seo-offer-item',
      '.sm-offer-wrapper .list-item',
    ];

    let productCards = [];

    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[1688 List] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    for (const card of productCards) {
      try {
        const linkEl = card.querySelector('a.sm-offer-item-link, a.offer-title-link, a[href*="detail.1688.com"]');
        if (!linkEl) continue;

        let productUrl = linkEl.href;
        if (!productUrl.startsWith('http')) {
          productUrl = 'https:' + productUrl;
        }

        const titleEl = card.querySelector('.sm-offer-title, .offer-title, .title');
        const titleCn = titleEl ? cleanText(titleEl.textContent) : '';
        if (!titleCn) continue;

        const imgEl = card.querySelector('img.sm-offer-image, img.offer-image, img[src*="cbu01.alicdn.com"]');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src) : '';

        const priceEl = card.querySelector('.price-text, .price, .sm-offer-price');
        const price = priceEl ? cleanPrice(priceEl.textContent) : '';

        const shopEl = card.querySelector('.sm-offer-shop, .shop-name, .seller-name');
        const shopName = shopEl ? cleanText(shopEl.textContent) : '';

        const moqEl = card.querySelector('.moq, .sm-offer-moq, .min-order');
        const moq = moqEl ? cleanText(moqEl.textContent) : '';

        results.push({
          title: titleCn,
          titleCn: titleCn,
          titleImage: imageUrl ? [imageUrl] : [],
          imageLink: imageUrl,
          link: productUrl,
          price: price,
          shopName: shopName,
          moq: moq,
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

/**
 * 1688 쇼케이스 페이지 크롤러 (show.1688.com)
 */
async function crawl1688ShowPage() {
  console.log('[1688 Show Crawler] 시작:', window.location.href);

  try {
    const results = [];

    const productSelectors = [
      '.exhibition-offer-item',
      '.show-offer-item',
      '.expo-offer-card',
      '.offer-card-wrapper',
      'div[class*="offer"]'
    ];

    let productCards = [];

    for (const selector of productSelectors) {
      productCards = document.querySelectorAll(selector);
      if (productCards.length > 0) {
        console.log(`[1688 Show] 상품 카드 발견: ${selector}, ${productCards.length}개`);
        break;
      }
    }

    if (productCards.length === 0) {
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

    for (const card of productCards) {
      try {
        const linkEl = card.querySelector('a[href*="detail.1688.com"], a[href*="/offer/"]');
        if (!linkEl) continue;

        let productUrl = linkEl.href;
        if (!productUrl.startsWith('http')) {
          productUrl = 'https:' + productUrl;
        }

        const titleSelectors = ['.offer-title', '.title', '.product-name', 'h3', 'h4', 'a[title]'];
        let titleCn = '';
        for (const selector of titleSelectors) {
          const titleEl = card.querySelector(selector);
          if (titleEl) {
            titleCn = cleanText(titleEl.textContent || titleEl.getAttribute('title') || '');
            if (titleCn) break;
          }
        }
        if (!titleCn) continue;

        const imgEl = card.querySelector('img[src*="cbu01.alicdn.com"], img[src*="cbu02.alicdn.com"], img.offer-image, img');
        const imageUrl = imgEl ? cleanImageUrl(imgEl.src || imgEl.getAttribute('data-src') || '') : '';

        const priceSelectors = ['.price', '.offer-price', 'span[class*="price"]'];
        let price = '';
        for (const selector of priceSelectors) {
          const priceEl = card.querySelector(selector);
          if (priceEl) {
            price = cleanPrice(priceEl.textContent);
            if (price) break;
          }
        }

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

// ===== ALIEXPRESS 리스트 크롤러 =====
async function crawlAliexpressList() {
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

// ===== TAOBAO 크롤러 =====
async function crawlTaobaoProduct() {
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

async function crawlTaobaoList() {
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

// ===== TMALL 크롤러 =====
async function crawlTmallProduct() {
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

async function crawlTmallList() {
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

// ===== AMAZON 크롤러 =====
async function crawlAmazonProduct() {
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

async function crawlAmazonList() {
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

// ===== RAKUTEN 크롤러 =====
async function crawlRakutenProduct() {
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

async function crawlRakutenList() {
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

// ===== VVIC 크롤러 =====
async function crawlVVICProduct() {
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

async function crawlVVICList() {
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

// ===== TEMU 크롤러 =====
async function crawlTemuProduct() {
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

// ===== DOMEGGOOK 크롤러 =====
async function crawlDomeggookProduct() {
  console.log('[Domeggook Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    const titleEl = document.querySelector('.product_name, h1.title, .item-title');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const title = cleanText(titleEl.textContent);
    console.log('[Domeggook] 상품명:', title);

    // 이미지
    const imageUrls = [];
    const imgs = document.querySelectorAll('.product-image img, #product_image img, .item-img img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src');
      if (src && !isVideoOverlayOrIcon(src)) {
        imageUrls.push(cleanImageUrl(src));
      }
    }

    console.log('[Domeggook] 이미지 개수:', imageUrls.length);

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
      type: 'domeggook-product'
    });

    console.log('[Domeggook] 수집 완료');

    return {
      results,
      platform: 'domeggook',
      url: window.location.href,
      title: title,
      price: price,
      exportType: 'domeggook-product'
    };

  } catch (error) {
    console.error('[Domeggook Product Crawler] 오류:', error);
    throw error;
  }
}

async function crawlDomeggookList() {
  console.log('[Domeggook List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    const productCards = document.querySelectorAll('.product-item, .item, [class*="goods-item"]');

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    console.log(`[Domeggook List] 상품 카드 발견: ${productCards.length}개`);

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
          type: 'domeggook-list'
        });

      } catch (err) {
        console.warn('[Domeggook List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Domeggook List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'domeggook-list',
      url: window.location.href,
      title: `도매꾹 검색 결과 (${results.length}개)`,
      exportType: 'domeggook-list'
    };

  } catch (error) {
    console.error('[Domeggook List Crawler] 오류:', error);
    throw error;
  }
}

// ===== DOMEME 크롤러 =====
async function crawlDomemeProduct() {
  console.log('[Domeme Product Crawler] 시작:', window.location.href);

  try {
    const results = [];

    // 상품명
    const titleEl = document.querySelector('.product_name, h1.title, .item-title');
    if (!titleEl) {
      throw new Error('상품명을 찾을 수 없습니다.');
    }

    const title = cleanText(titleEl.textContent);
    console.log('[Domeme] 상품명:', title);

    // 이미지
    const imageUrls = [];
    const imgs = document.querySelectorAll('.product-image img, #product_image img, .item-img img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src');
      if (src && !isVideoOverlayOrIcon(src)) {
        imageUrls.push(cleanImageUrl(src));
      }
    }

    console.log('[Domeme] 이미지 개수:', imageUrls.length);

    // 가격
    const priceEl = document.querySelector('.price, .product-price');
    const price = priceEl ? cleanPrice(priceEl.textContent) : '';

    results.push({
      title: title,
      titleCn: title,
      titleImage: imageUrls,
      imageLink: imageUrls[0] || '',
      link: window.location.href,
      price: price,
      type: 'domeme-product'
    });

    console.log('[Domeme] 수집 완료');

    return {
      results,
      platform: 'domeme',
      url: window.location.href,
      title: title,
      price: price,
      exportType: 'domeme-product'
    };

  } catch (error) {
    console.error('[Domeme Product Crawler] 오류:', error);
    throw error;
  }
}

async function crawlDomemeList() {
  console.log('[Domeme List Crawler] 시작:', window.location.href);

  try {
    const results = [];

    const productCards = document.querySelectorAll('.product-item, .item, [class*="goods-item"]');

    if (productCards.length === 0) {
      throw new Error('상품 목록을 찾을 수 없습니다.');
    }

    console.log(`[Domeme List] 상품 카드 발견: ${productCards.length}개`);

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
          type: 'domeme-list'
        });

      } catch (err) {
        console.warn('[Domeme List] 상품 파싱 오류:', err);
        continue;
      }
    }

    console.log('[Domeme List] 수집 완료:', results.length, '개');

    return {
      results,
      platform: 'domeme-list',
      url: window.location.href,
      title: `도매매 검색 결과 (${results.length}개)`,
      exportType: 'domeme-list'
    };

  } catch (error) {
    console.error('[Domeme List Crawler] 오류:', error);
    throw error;
  }
}

// ===== OWNERCLAN 크롤러 =====
async function crawlOwnerclanProduct() {
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

async function crawlOwnerclanList() {
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

// Background Script로부터 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content] 메시지 수신:', request.action);

  if (request.action === 'extractProductData') {
    // async 함수를 즉시 실행하고 결과를 sendResponse로 전달
    (async () => {
      try {
        const pageType = detectPageType();
        console.log('[Content] 페이지 유형:', pageType);

        let result = null;

        switch (pageType) {
          // 1688
          case '1688-product':
            result = await crawl1688Product();
            break;
          case '1688-list':
            result = await crawl1688ListPage();
            break;
          case '1688-show':
            result = await crawl1688ShowPage();
            break;

          // AliExpress
          case 'aliexpress-product':
            result = await crawlAliexpressProduct();
            break;
          case 'aliexpress-list':
            result = await crawlAliexpressList();
            break;

          // Taobao
          case 'taobao-product':
            result = await crawlTaobaoProduct();
            break;
          case 'taobao-list':
            result = await crawlTaobaoList();
            break;

          // Tmall
          case 'tmall-product':
            result = await crawlTmallProduct();
            break;
          case 'tmall-list':
            result = await crawlTmallList();
            break;

          // Amazon
          case 'amazon-product':
            result = await crawlAmazonProduct();
            break;
          case 'amazon-list':
            result = await crawlAmazonList();
            break;

          // Rakuten
          case 'rakuten-product':
            result = await crawlRakutenProduct();
            break;
          case 'rakuten-list':
            result = await crawlRakutenList();
            break;

          // VVIC
          case 'vvic-product':
            result = await crawlVVICProduct();
            break;
          case 'vvic-list':
            result = await crawlVVICList();
            break;

          // Temu
          case 'temu-product':
            result = await crawlTemuProduct();
            break;

          // Domeggook
          case 'domeggook-product':
            result = await crawlDomeggookProduct();
            break;
          case 'domeggook-list':
            result = await crawlDomeggookList();
            break;

          // Domeme
          case 'domeme-product':
            result = await crawlDomemeProduct();
            break;
          case 'domeme-list':
            result = await crawlDomemeList();
            break;

          // Ownerclan
          case 'ownerclan-product':
            result = await crawlOwnerclanProduct();
            break;
          case 'ownerclan-list':
            result = await crawlOwnerclanList();
            break;

          // Coupang
          case 'coupang-product':
            result = await crawlCoupangProduct();
            break;

          default:
            sendResponse({
              success: false,
              error: '지원하지 않는 페이지입니다. 상품 페이지에서 실행해주세요.'
            });
            return;
        }

        if (result && result.results && result.results.length > 0) {
          console.log('[Content] 데이터 추출 성공:', result.results.length, '개');

          sendResponse({
            success: true,
            data: result,
            pageType: pageType
          });
        } else {
          sendResponse({
            success: false,
            error: '데이터를 추출할 수 없습니다.'
          });
        }

      } catch (error) {
        console.error('[Content] 추출 오류:', error);
        sendResponse({
          success: false,
          error: error.message || '알 수 없는 오류가 발생했습니다.'
        });
      }
    })();

    return true; // 비동기 응답을 위해 true 반환
  }

  return false;
});

// 페이지 로드 완료 후 자동 감지
window.addEventListener('load', () => {
  const pageType = detectPageType();
  console.log('[TotalBot] 페이지 유형 감지:', pageType);

  // 상품 페이지면 아이콘 표시 (선택사항)
  if (pageType.includes('product')) {
    console.log('[TotalBot] 상품 페이지 감지됨 - 크롤링 가능');

    // 페이지에 표시기 추가 (선택사항)
    showCrawlIndicator();
  }
});

// 크롤링 가능 표시기 (선택사항)
function showCrawlIndicator() {
  // 이미 표시기가 있으면 리턴
  if (document.querySelector('#totalbot-indicator')) return;

  const indicator = document.createElement('div');
  indicator.id = 'totalbot-indicator';
  indicator.innerHTML = '🤖 TotalBot';
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px 20px;
    border-radius: 24px;
    font-size: 14px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    cursor: pointer;
    transition: all 0.3s ease;
    font-family: 'Nanum Gothic', sans-serif;
  `;

  indicator.addEventListener('mouseenter', () => {
    indicator.style.transform = 'scale(1.05)';
    indicator.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
  });

  indicator.addEventListener('mouseleave', () => {
    indicator.style.transform = 'scale(1)';
    indicator.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  });

  indicator.addEventListener('click', async () => {
    indicator.innerHTML = '⏳ 수집 중...';
    indicator.style.pointerEvents = 'none';

    try {
      const pageType = detectPageType();
      console.log('[TotalBot] 수집 시작:', pageType);

      let result = null;

      switch (pageType) {
        case '1688-product':
          result = await crawl1688Product();
          break;

        case 'coupang-product':
          result = await crawlCoupangProduct();
          break;

        case 'aliexpress-product':
          result = await crawlAliexpressProduct();
          break;

        default:
          throw new Error('지원하지 않는 페이지입니다.');
      }

      if (result && result.results && result.results.length > 0) {
        console.log('[TotalBot] 수집 성공:', result.results.length, '개');

        // 서버로 데이터 전송
        const response = await authFetch(`${SERVER_URL}/api/products/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result)
        });

        if (response.ok) {
          indicator.innerHTML = '✅ 완료!';
          setTimeout(() => {
            indicator.innerHTML = '🤖 TotalBot';
            indicator.style.pointerEvents = 'auto';
          }, 2000);
        } else {
          throw new Error('서버 저장 실패');
        }
      } else {
        throw new Error('데이터를 추출할 수 없습니다.');
      }
    } catch (error) {
      console.error('[TotalBot] 크롤링 오류:', error);
      indicator.innerHTML = '❌ ' + error.message;
      setTimeout(() => {
        indicator.innerHTML = '🤖 TotalBot';
        indicator.style.pointerEvents = 'auto';
      }, 3000);
    }
  });

  document.body.appendChild(indicator);
}

console.log('[TotalBot] Content Script 준비 완료');
