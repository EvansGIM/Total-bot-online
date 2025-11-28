/**
 * TotalBot Content Script (통합 버전)
 * 모든 크롤러 코드를 하나의 파일로 통합
 */

console.log('[TotalBot] Content Script 로드됨:', window.location.href);

// ===== UTILS =====
function cleanImageUrl(url) {
  if (!url) return '';

  // URL 파라미터 제거
  let cleaned = url.split('?')[0].split('#')[0];

  // 1688 썸네일 제거: _sum.jpg -> .jpg
  cleaned = cleaned.replace(/_sum\.(jpg|png|webp|jpeg)$/i, '.$1');

  // _b.jpg 제거 (1688)
  cleaned = cleaned.replace(/_b\.(jpg|png|webp|jpeg)$/i, '.$1');

  // .jpg_ 같은 패턴 제거 (확장자 뒤에 _가 있는 경우)
  cleaned = cleaned.replace(/\.(jpg|png|webp|jpeg)_/i, '.$1');

  // _800x800. 같은 썸네일 크기 제거
  cleaned = cleaned.replace(/_\d+x\d+\./i, '.');

  // .webp를 .jpg로 변환 (선택적)
  cleaned = cleaned.replace(/\.webp$/i, '.jpg');

  // 이중 확장자 제거 (.jpg.jpg -> .jpg)
  cleaned = cleaned.replace(/\.(jpg|png|jpeg)\.(jpg|png|jpeg)$/i, '.$1');

  return cleaned;
}

function safeSrc(selector, root = document) {
  const el = root.querySelector(selector);
  if (!el) return null;
  
  if (el.tagName === 'IMG' && el.src) {
    return el.src;
  }
  
  const bgImage = window.getComputedStyle(el).backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
    if (match) return match[1];
  }
  
  return null;
}

function isVideoOverlayOrIcon(url) {
  if (!url) return false;
  const patterns = [
    /play[-_]?icon/i,
    /video[-_]?overlay/i,
    /player[-_]?btn/i
  ];
  return patterns.some(p => p.test(url));
}

// ===== 1688 CRAWLER =====
async function crawl1688Product() {
  console.log('[1688] 크롤링 시작');
  
  const isNewUI = !!document.querySelector('.title-content h1');
  const isOldUI = !!document.querySelector('.title-text');
  
  if (isNewUI) {
    return await crawlNewUI();
  } else if (isOldUI) {
    return await crawlOldUI();
  } else {
    throw new Error('알 수 없는 1688 UI 형식');
  }
}

async function crawlNewUI() {
  const titleEl = document.querySelector('.title-content h1');
  const titleCn = titleEl ? titleEl.textContent.trim() : '';

  console.log('[1688 New UI] 제목:', titleCn);

  // 대표 이미지 수집 (아이콘 제외)
  let titleImages = [];
  const titleImgEls = document.querySelectorAll('.img-list-wrapper img');
  for (const img of titleImgEls) {
    const src = img.src || img.dataset.src;
    if (src && !src.includes('tps-48-48.png') && !isVideoOverlayOrIcon(src)) {
      titleImages.push(cleanImageUrl(src));
    }
  }

  titleImages = [...new Set(titleImages)];
  console.log('[1688 New UI] 이미지 개수:', titleImages.length);
  
  // 옵션 추출
  let results = [];

  // 색상 옵션 수집
  const colorButtons = document.querySelectorAll('.sku-filter-button');
  const colors = [];

  console.log('[1688 New UI] 색상 버튼 개수:', colorButtons.length);

  for (const btn of colorButtons) {
    const colorName = btn.textContent.trim();
    const colorImg = btn.querySelector('img')?.src;

    if (colorName) {
      colors.push({
        name: colorName,
        img: colorImg ? cleanImageUrl(colorImg) : ''
      });
      console.log('[1688 New UI] 색상:', colorName, '이미지:', colorImg ? 'O' : 'X');
    }
  }

  // 사이즈/SKU 옵션 수집
  const skuItems = document.querySelectorAll('.expand-view-item');
  const sizes = [];

  console.log('[1688 New UI] SKU 항목 개수:', skuItems.length);

  for (const item of skuItems) {
    const text = item.textContent.trim();
    // "2XL建议155斤-180斤¥19.9库存4999件" 형식 파싱
    const sizeMatch = text.match(/^([^¥]+)/);
    const priceMatch = text.match(/¥([\d.]+)/);

    if (sizeMatch) {
      const sizeName = sizeMatch[1].trim();
      const price = priceMatch ? priceMatch[1] : '';

      sizes.push({
        name: sizeName,
        price: price
      });
      console.log('[1688 New UI] 사이즈:', sizeName, '가격:', price);
    }
  }

  // 색상 × 사이즈 조합 생성
  if (colors.length > 0 && sizes.length > 0) {
    console.log('[1688 New UI] 조합 생성:', colors.length, '×', sizes.length, '=', colors.length * sizes.length);

    for (const color of colors) {
      for (const size of sizes) {
        results.push({
          titleCn: titleCn,
          title: '',
          optionName1Cn: color.name,
          optionName1: '',
          optionName2Cn: size.name,
          optionName2: '',
          price: size.price,
          imageLink: color.img,
          titleImage: titleImages,
          link: window.location.href
        });
      }
    }
  } else if (colors.length > 0) {
    // 색상만 있는 경우
    console.log('[1688 New UI] 색상만:', colors.length);
    for (const color of colors) {
      results.push({
        titleCn: titleCn,
        title: '',
        optionName1Cn: color.name,
        optionName1: '',
        optionName2Cn: '',
        optionName2: '',
        price: '',
        imageLink: color.img,
        titleImage: titleImages,
        link: window.location.href
      });
    }
  } else if (sizes.length > 0) {
    // 사이즈만 있는 경우
    console.log('[1688 New UI] 사이즈만:', sizes.length);
    for (const size of sizes) {
      results.push({
        titleCn: titleCn,
        title: '',
        optionName1Cn: '',
        optionName1: '',
        optionName2Cn: size.name,
        optionName2: '',
        price: size.price,
        imageLink: '',
        titleImage: titleImages,
        link: window.location.href
      });
    }
  }
  
  // 옵션이 하나도 없으면 기본 항목 추가
  if (results.length === 0) {
    console.log('[1688 New UI] 옵션 없음 - 기본 항목 추가');
    results.push({
      titleCn: titleCn,
      title: '',
      optionName1Cn: '',
      optionName1: '',
      optionName2Cn: '',
      optionName2: '',
      price: '',
      imageLink: '',
      titleImage: titleImages,
      link: window.location.href
    });
  }

  console.log('[1688 New UI] 최종 결과 개수:', results.length);

  const mainImage = titleImages.length > 0 ? titleImages[0] : '';

  return {
    results,
    platform: '1688-product',
    url: window.location.href,
    mainImage: mainImage,
    images: titleImages.slice(1, 6), // 추가 이미지 최대 5개
    titleCn: titleCn,
    title: '' // 서버에서 번역
  };
}

async function crawlOldUI() {
  const titleEl = document.querySelector('.title-text');
  const titleCn = titleEl ? titleEl.textContent.trim() : '';
  
  let titleImages = [];
  const imgEls = document.querySelectorAll('.d-slider img, .detail-gallery img');
  for (const img of imgEls) {
    const src = img.src || img.dataset.src;
    if (src && !isVideoOverlayOrIcon(src)) {
      titleImages.push(cleanImageUrl(src));
    }
  }
  titleImages = [...new Set(titleImages)];
  
  let results = [];
  
  // Type 1: prop-item
  const propItems = document.querySelectorAll('.prop-item');
  if (propItems.length >= 2) {
    const option1Items = propItems[0].querySelectorAll('li');
    const option2Items = propItems[1].querySelectorAll('li');
    
    for (const opt1 of option1Items) {
      const opt1Name = opt1.textContent.trim();
      const opt1Img = safeSrc('img', opt1);
      
      for (const opt2 of option2Items) {
        const opt2Name = opt2.textContent.trim();
        const priceMatch = opt2.textContent.match(/¥\s*([\d.]+)/);
        
        results.push({
          titleCn,
          title: '',
          optionName1Cn: opt1Name,
          optionName1: '',
          optionName2Cn: opt2Name,
          optionName2: '',
          optionName2Price: priceMatch ? priceMatch[1] : '',
          imageLink: opt1Img ? cleanImageUrl(opt1Img) : '',
          titleImage: titleImages,
          link: window.location.href
        });
      }
    }
  }
  
  // Type 2: sku-item-wrapper (사이즈만)
  if (results.length === 0) {
    const skuItems = document.querySelectorAll('.sku-item-wrapper li');
    if (skuItems.length > 0) {
      for (const skuItem of skuItems) {
        const skuName = skuItem.textContent.trim();
        const priceMatch = skuItem.textContent.match(/¥\s*([\d.]+)/);
        
        results.push({
          titleCn,
          title: '',
          optionName1Cn: '',
          optionName1: '',
          optionName2Cn: skuName,
          optionName2: '',
          optionName2Price: priceMatch ? priceMatch[1] : '',
          imageLink: '',
          titleImage: titleImages,
          link: window.location.href
        });
      }
    }
  }
  
  if (results.length === 0) {
    results.push({
      titleCn,
      title: '',
      optionName1Cn: '',
      optionName1: '',
      optionName2Cn: '',
      optionName2: '',
      optionName2Price: '',
      imageLink: '',
      titleImage: titleImages,
      link: window.location.href
    });
  }

  const mainImage = titleImages.length > 0 ? titleImages[0] : '';

  return {
    results,
    platform: '1688-product',
    url: window.location.href,
    mainImage: mainImage,
    images: titleImages.slice(1, 6),
    titleCn: titleCn,
    title: ''
  };
}

// ===== COUPANG CRAWLER =====
async function crawlCoupangProduct() {
  console.log('[쿠팡] 크롤링 시작');
  
  const titleEl = document.querySelector('.prod-buy-header__title');
  const title = titleEl ? titleEl.textContent.trim() : '';
  
  const priceEl = document.querySelector('.total-price strong');
  const price = priceEl ? priceEl.textContent.trim() : '';
  
  let titleImages = [];
  const imgEls = document.querySelectorAll('.prod-image__item img');
  for (const img of imgEls) {
    const src = img.src || img.dataset.src;
    if (src) {
      titleImages.push(cleanImageUrl(src));
    }
  }
  titleImages = [...new Set(titleImages)];
  
  const optionEls = document.querySelectorAll('.prod-option__item');
  const options = [];
  for (const optEl of optionEls) {
    options.push(optEl.textContent.trim());
  }
  
  return {
    results: [{
      title,
      titleCn: '',
      optionName1: options.join(', '),
      optionName1Cn: '',
      optionName2: '',
      optionName2Cn: '',
      optionName2Price: price,
      imageLink: '',
      titleImage: titleImages,
      link: window.location.href
    }]
  };
}

// ===== ALIEXPRESS CRAWLER =====
async function crawlAliexpressProduct() {
  console.log('[알리익스프레스] 크롤링 시작');
  
  const titleEl = document.querySelector('.product-title-text, h1');
  const title = titleEl ? titleEl.textContent.trim() : '';
  
  const priceEl = document.querySelector('.product-price-value');
  const price = priceEl ? priceEl.textContent.trim() : '';
  
  let titleImages = [];
  const imgEls = document.querySelectorAll('.images-view-item img, .magnifier-image img');
  for (const img of imgEls) {
    let src = img.src || img.dataset.src;
    if (src) {
      src = src.replace(/_\d+x\d+\./, '.');
      titleImages.push(cleanImageUrl(src));
    }
  }
  titleImages = [...new Set(titleImages)];
  
  const skuEls = document.querySelectorAll('.sku-property-item');
  const skus = [];
  for (const skuEl of skuEls) {
    skus.push(skuEl.textContent.trim());
  }
  
  return {
    results: [{
      title,
      titleCn: '',
      optionName1: skus.join(', '),
      optionName1Cn: '',
      optionName2: '',
      optionName2Cn: '',
      optionName2Price: price,
      imageLink: '',
      titleImage: titleImages,
      link: window.location.href
    }]
  };
}

// ===== MAIN LOGIC =====
function detectPageType() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  
  if (hostname.includes('1688.com')) {
    if (url.includes('/offer/') || url.includes('detail.1688.com')) {
      return '1688-product';
    }
    return '1688-other';
  } else if (hostname.includes('coupang.com')) {
    if (url.includes('/vp/products/')) {
      return 'coupang-product';
    }
    return 'coupang-other';
  } else if (hostname.includes('aliexpress.com')) {
    if (url.includes('/item/')) {
      return 'aliexpress-product';
    }
    return 'aliexpress-other';
  }
  
  return 'unknown';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content] 메시지 수신:', request.action);

  if (request.action === 'extractProductData') {
    // async 함수를 즉시 실행하고 결과를 sendResponse로 전달
    (async () => {
      const pageType = detectPageType();
      console.log('[Content] 페이지 유형:', pageType);

      try {
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

        sendResponse({
          success: true,
          data: result,
          pageType
        });
      } catch (error) {
        console.error('[Content] 크롤링 오류:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();

    return true; // 비동기 응답을 위해 true 반환
  }

  return false;
});

function showCrawlIndicator() {
  if (document.getElementById('totalbot-indicator')) return;
  
  const pageType = detectPageType();
  if (!pageType.includes('product')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'totalbot-indicator';
  indicator.innerHTML = '🤖 TotalBot';
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #2a4d8f;
    color: white;
    padding: 12px 20px;
    border-radius: 25px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: all 0.3s;
  `;
  
  indicator.addEventListener('mouseenter', () => {
    indicator.style.transform = 'scale(1.1)';
    indicator.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
  });
  
  indicator.addEventListener('mouseleave', () => {
    indicator.style.transform = 'scale(1)';
    indicator.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  });
  
  indicator.addEventListener('click', async () => {
    indicator.innerHTML = '⏳ 수집 중...';
    indicator.style.background = '#666';

    try {
      // 직접 크롤링 실행
      const pageType = detectPageType();
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

      // Background에 결과 전달 (저장 및 번역)
      const response = await chrome.runtime.sendMessage({
        action: 'saveProductData',
        data: result,
        pageType: pageType
      });

      if (response && response.success) {
        indicator.innerHTML = '✅ 완료!';
        indicator.style.background = '#059669';
        setTimeout(() => {
          indicator.innerHTML = '🤖 TotalBot';
          indicator.style.background = '#2a4d8f';
        }, 2000);
      } else {
        indicator.innerHTML = '❌ 실패';
        indicator.style.background = '#dc2626';
        setTimeout(() => {
          indicator.innerHTML = '🤖 TotalBot';
          indicator.style.background = '#2a4d8f';
        }, 2000);
      }
    } catch (error) {
      console.error('크롤링 실패:', error);
      console.error('에러 상세:', error.message, error.stack);
      alert(`크롤링 실패: ${error.message}`);
      indicator.innerHTML = '❌ 오류';
      indicator.style.background = '#dc2626';
      setTimeout(() => {
        indicator.innerHTML = '🤖 TotalBot';
        indicator.style.background = '#2a4d8f';
      }, 2000);
    }
  });
  
  document.body.appendChild(indicator);
  console.log('[TotalBot] 표시기 생성됨');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showCrawlIndicator);
} else {
  showCrawlIndicator();
}

console.log('[TotalBot] Content Script 초기화 완료');
