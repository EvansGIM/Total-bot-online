/**
 * 크롤링 공통 유틸리티
 * - 이미지 URL 정리
 * - 데이터 추출 헬퍼
 */

// 이미지 URL 정리 (Python _clean_img 함수 포팅)
export function cleanImageUrl(url) {
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
export function isVideoOverlayOrIcon(url) {
  if (!url) return false;

  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes('video') ||
    lowerUrl.includes('play') ||
    /-tps-\d+\.(png|jpe?g|webp)$/i.test(url) ||
    /\/imgextra\/i\d\/.+-(?:1|2)-tps-\d+\.(png|jpe?g|webp)$/i.test(url)
  );
}

// 안전한 이미지 소스 추출 (img src 또는 background-image)
export function safeSrc(selector, root = document) {
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
export function waitForElement(selector, timeout = 5000) {
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
export function safeClick(element) {
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
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 텍스트 정리
export function cleanText(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

// 가격 정리 (¥, 元 제거)
export function cleanPrice(price) {
  if (!price) return '';
  return price.replace(/[¥元,\s]/g, '').trim();
}
