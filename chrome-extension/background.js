/**
 * TotalBot Chrome Extension - Background Script
 * 쿠팡 자동 업로드 백그라운드 관리
 */

// JSZip 및 SheetJS 라이브러리 로드
importScripts('lib/jszip.min.js');
importScripts('lib/xlsx.full.min.js');

// ===== 대용량 데이터 전송용 (메모리 저장) =====
let pendingUploadData = null;

function savePendingUploadData(data) {
  pendingUploadData = data;
  console.log('📦 대용량 데이터 메모리에 저장됨');
}

function getPendingUploadData() {
  return pendingUploadData;
}

function clearPendingUploadData() {
  pendingUploadData = null;
}

// 서버 URL 설정
const SERVER_URL = 'https://totalbot.cafe24.com/node-api';

// 전역 변수: 사이즈 차트 이미지 (랜덤 파일명)
let globalSizeChartImages = [];

// 인증 토큰 가져오기
async function getAuthToken() {
  const result = await chrome.storage.local.get(['authToken']);
  return result.authToken || null;
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

  // Content-Type이 없고 body가 JSON이면 추가
  if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    ...options,
    headers
  });
}

console.log('🚀 TotalBot Background Script loaded');
console.log('✅ JSZip loaded:', typeof JSZip);
console.log('✅ SheetJS loaded:', typeof XLSX);

// ===== 쿠팡 세션 Heartbeat 시스템 =====
let heartbeatIntervalId = null;           // setInterval ID
let heartbeatActive = false;              // Heartbeat 활성 상태
let lastHeartbeatTime = null;             // 마지막 성공 시간
let consecutiveHeartbeatFailures = 0;     // 연속 실패 횟수
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5분
const MAX_HEARTBEAT_FAILURES = 3;         // 연속 실패 허용 횟수

// ===== 쿠팡 API 직접 호출 함수 (캐시 문제 우회) =====

// API 전용 탭 ID 캐시 (메모리 + storage.session)
let apiTabId = null;

/**
 * 쿠팡 API 전용 깨끗한 탭 생성/재사용
 * 기존 쿠팡 탭의 캐시/에러 상태를 피하기 위해 별도 탭 사용
 */
async function getOrCreateApiTab() {
  // 메모리에 없으면 storage.session에서 복원 시도
  if (!apiTabId) {
    try {
      const stored = await chrome.storage.session.get('apiTabId');
      if (stored.apiTabId) {
        apiTabId = stored.apiTabId;
        console.log('📌 API 탭 ID 복원:', apiTabId);
      }
    } catch (e) {
      // storage.session 지원 안 할 수 있음
    }
  }

  // 기존 API 탭이 유효한지 확인
  if (apiTabId) {
    try {
      const tab = await chrome.tabs.get(apiTabId);
      if (tab && tab.url && tab.url.includes('supplier.coupang.com')) {
        console.log('📌 기존 API 탭 재사용:', apiTabId);
        return apiTabId;
      }
    } catch (e) {
      // 탭이 닫혔거나 유효하지 않음
      console.log('📌 기존 API 탭 무효, 새로 생성 필요');
      apiTabId = null;
      try {
        await chrome.storage.session.remove('apiTabId');
      } catch (e2) {}
    }
  }

  // 새 API 전용 탭 생성 - 실제 HTML 페이지 필요 (CORS)
  console.log('📌 API 전용 탭 생성 중...');
  const newTab = await chrome.tabs.create({
    url: 'https://supplier.coupang.com/qvt/wims', // 상품 등록 상태 확인 페이지 (가볍고 API와 같은 origin)
    active: false
  });
  apiTabId = newTab.id;

  // storage.session에 저장 (서비스 워커 재시작 시 복원용)
  try {
    await chrome.storage.session.set({ apiTabId: apiTabId });
  } catch (e) {}

  // 페이지 로드 대기
  await new Promise(resolve => {
    const listener = (tabId, info) => {
      if (tabId === apiTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // 타임아웃
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });

  // 페이지 완전 로드 대기
  await sleep(3000);
  console.log('✅ API 전용 탭 준비 완료:', apiTabId);
  return apiTabId;
}

/**
 * API 전용 탭 닫기
 */
async function closeApiTab() {
  if (apiTabId) {
    try {
      await chrome.tabs.remove(apiTabId);
      console.log('🗑️ API 전용 탭 닫기 완료:', apiTabId);
    } catch (e) {
      // 이미 닫혔거나 유효하지 않음
      console.log('⚠️ API 탭 닫기 실패 (이미 닫힌 듯):', e.message);
    }
    apiTabId = null;
    try {
      await chrome.storage.session.remove('apiTabId');
    } catch (e) {}
  }
}

/**
 * 쿠팡 API 호출 (깨끗한 탭에서 실행)
 * 기존 쿠팡 탭의 캐시/JavaScript 에러를 피함
 */
async function coupangApiFetch(url, options = {}) {
  // 먼저 캐시 쿠키 삭제
  await clearCoupangCacheCookies();

  const tabId = await getOrCreateApiTab();

  if (!tabId) {
    throw new Error('API 탭을 생성할 수 없습니다');
  }

  // API 탭 새로고침하여 캐시된 상태 초기화
  try {
    await chrome.tabs.reload(tabId, { bypassCache: true });
    await sleep(2000); // 새로고침 대기
  } catch (e) {
    console.log('⚠️ 탭 새로고침 실패, 계속 진행');
  }

  console.log(`📡 [API Tab ${tabId}] Fetching: ${url}`);

  // 깨끗한 탭에서 fetch 실행
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: async (fetchUrl, fetchOptions) => {
      try {
        const response = await fetch(fetchUrl, {
          method: fetchOptions.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...fetchOptions.headers
          },
          body: fetchOptions.body,
          credentials: 'include'
        });

        const text = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text: text
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message
        };
      }
    },
    args: [url, options]
    // ISOLATED world 사용 (기본값) - CSP 제한 없음
  });

  if (!results || results.length === 0) {
    throw new Error('스크립트 실행 결과가 없습니다');
  }

  const result = results[0].result;

  if (result.error) {
    console.error('❌ [API Tab] Fetch error:', result.error);
    throw new Error(result.error);
  }

  console.log(`✅ [API Tab] Response status: ${result.status}`);

  // Response-like 객체 반환
  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    text: async () => result.text,
    json: async () => JSON.parse(result.text)
  };
}

// ===== 쿠팡 세션 Heartbeat 함수들 =====

/**
 * 활성 쿠팡 탭 찾기 (Heartbeat용)
 */
async function findActiveCoupangTab() {
  try {
    const allTabs = await chrome.tabs.query({});
    const coupangTab = allTabs.find(tab =>
      tab.url && tab.url.includes('supplier.coupang.com')
    );
    return coupangTab ? coupangTab.id : null;
  } catch (error) {
    console.error('💔 쿠팡 탭 검색 오류:', error);
    return null;
  }
}

/**
 * 세션 만료 에러인지 확인
 */
function isSessionExpiredError(error) {
  const errorMsg = (error.message || error.toString()).toLowerCase();
  return (
    errorMsg.includes('401') ||
    errorMsg.includes('403') ||
    errorMsg.includes('unauthorized') ||
    errorMsg.includes('forbidden') ||
    errorMsg.includes('xauth.coupang.com')
  );
}

/**
 * Heartbeat 실행 (세션 유지 요청)
 */
async function performHeartbeat() {
  try {
    // 1. 쿠팡 탭이 여전히 열려있는지 확인
    const coupangTabId = await findActiveCoupangTab();
    if (!coupangTabId) {
      console.log('💔 쿠팡 탭이 닫혀 Heartbeat 중지');
      stopCoupangHeartbeat();
      return;
    }

    // 2. 쿠팡 탭에서 간단한 API 호출로 세션 유지
    console.log('💓 Heartbeat 전송 중...');

    const results = await chrome.scripting.executeScript({
      target: { tabId: coupangTabId },
      func: async () => {
        try {
          const response = await fetch('https://supplier.coupang.com/api/v1/me', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'include'
          });
          const text = await response.text();
          return {
            ok: response.ok,
            status: response.status,
            text: text.substring(0, 200) // 디버깅용 일부만
          };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    });

    if (!results || results.length === 0) {
      throw new Error('Heartbeat 스크립트 실행 실패');
    }

    const result = results[0].result;

    if (result.ok) {
      lastHeartbeatTime = new Date();
      consecutiveHeartbeatFailures = 0;
      console.log(`💓 Heartbeat 성공: ${lastHeartbeatTime.toLocaleTimeString()}`);
    } else if (result.status === 401 || result.status === 403) {
      throw new Error(`세션 만료 (HTTP ${result.status})`);
    } else {
      throw new Error(result.error || `HTTP ${result.status}`);
    }

  } catch (error) {
    consecutiveHeartbeatFailures++;
    console.error(`💔 Heartbeat 실패 (${consecutiveHeartbeatFailures}/${MAX_HEARTBEAT_FAILURES}):`, error.message);

    // 세션 만료 감지
    if (isSessionExpiredError(error)) {
      console.log('🔒 쿠팡 세션 만료 감지');
      stopCoupangHeartbeat();
      showNotification(
        '쿠팡 세션 만료',
        '쿠팡 로그인이 만료되었습니다. 다시 로그인해주세요.'
      );
    } else if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
      console.log('❌ Heartbeat 연속 실패');
      stopCoupangHeartbeat();
      showNotification(
        '쿠팡 연결 문제',
        '쿠팡 서버와의 연결이 불안정합니다. 네트워크를 확인해주세요.'
      );
    }
  }
}

/**
 * 쿠팡 세션 Heartbeat 시작
 */
async function startCoupangHeartbeat() {
  // 이미 실행 중이면 중복 시작 방지
  if (heartbeatActive) {
    console.log('💓 Heartbeat 이미 실행 중');
    return;
  }

  // 쿠팡 탭 존재 여부 확인
  const coupangTabId = await findActiveCoupangTab();
  if (!coupangTabId) {
    console.log('⚠️ 쿠팡 탭이 없어 Heartbeat 시작하지 않음');
    return;
  }

  console.log('💓 쿠팡 세션 Heartbeat 시작 (5분 간격)');
  heartbeatActive = true;
  consecutiveHeartbeatFailures = 0;

  // 즉시 한 번 실행
  await performHeartbeat();

  // 주기적 실행
  heartbeatIntervalId = setInterval(async () => {
    await performHeartbeat();
  }, HEARTBEAT_INTERVAL);
}

/**
 * 쿠팡 세션 Heartbeat 중지
 */
function stopCoupangHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  heartbeatActive = false;
  consecutiveHeartbeatFailures = 0;
  console.log('💔 쿠팡 세션 Heartbeat 중지됨');
}

/**
 * 견적서 승인 상태 확인 (background에서 직접 호출)
 */
async function checkQuotationStatusDirect(quotationId, vendorId) {
  try {
    console.log('🔍 [Direct API] Checking approval status for quotation:', quotationId);

    // quotationId에 CID- 접두사 추가 (없는 경우)
    const formattedQuotationId = quotationId.startsWith('CID-')
      ? quotationId
      : `CID-${quotationId}`;

    const url = 'https://supplier.coupang.com/qvt/v2/wims/vendorSearch';

    const requestBody = {
      startDate: '1577836800000', // 2020-01-01
      endDate: Date.now().toString(),
      conditions: {
        vendorId: vendorId,
        state: '',
        quotationId: formattedQuotationId,
        progress: '',
        productName: '',
        productId: '',
        startItemRegisteredDate: '',
        endItemRegisteredDate: '',
        startPriceRegisteredDate: '',
        endPriceRegisteredDate: '',
        vendorName: '',
        skuId: '',
        barcode: ''
      },
      page: 1,
      sizePerPage: 1000
    };

    console.log('📤 [Direct API] Request:', JSON.stringify(requestBody, null, 2));

    const response = await coupangApiFetch(url, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('❌ [Direct API] Response not ok:', response.status, errorText);
      throw new Error(`API 요청 실패: ${response.status}`);
    }

    const data = await response.json();
    console.log('📥 [Direct API] Response:', data);

    // 응답 분석
    const result = analyzeApprovalStatusBg(data, quotationId);
    console.log('📊 [Direct API] Analysis result:', result);

    return {
      success: true,
      ...result
    };

  } catch (error) {
    console.error('❌ [Direct API] Quotation status check error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 승인 상태 분석 (background용)
 */
function analyzeApprovalStatusBg(apiResponse, quotationId) {
  const items = apiResponse.data || apiResponse.items || [];

  if (items.length === 0) {
    return {
      quotationId: quotationId,
      totalProducts: 0,
      totalSku: 0,
      isApproved: false,
      isRejected: false,
      inProgress: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      message: '상품을 찾을 수 없습니다'
    };
  }

  let step1Completed = 0; // ONBOARDED
  let step2Completed = 0; // HOTW
  let step3Completed = 0; // R21 (최종 승인)
  let rejected = 0;
  let inProgress = 0;

  items.forEach(item => {
    const steps = item.steps || [];
    const state = item.state;
    const progress = item.progress;

    // 단계별 완료 카운트
    const stepDict = {};
    steps.forEach(step => {
      stepDict[step.step] = step.progress;
    });

    if (stepDict['ONBOARDED'] === 'COMPLETED') step1Completed++;
    if (stepDict['HOTW'] === 'COMPLETED') step2Completed++;
    if (stepDict['R21'] === 'COMPLETED') step3Completed++;

    // 반려 확인
    if (state === 'REJECTION') {
      rejected++;
    }

    // 진행 중 확인
    if (progress === 'IN_PROGRESS') {
      inProgress++;
    } else if (progress === null && state !== 'REJECTION' && stepDict['R21'] !== 'COMPLETED') {
      inProgress++;
    }
  });

  const totalProducts = items.length;
  const allApproved = step3Completed === totalProducts && totalProducts > 0;
  const allRejected = rejected === totalProducts && totalProducts > 0;

  // 현재 가장 진행된 단계 결정
  let currentStage = null;
  if (step3Completed > 0) {
    currentStage = 'R21';
  } else if (step2Completed > 0) {
    currentStage = 'HOTW';
  } else if (step1Completed > 0) {
    currentStage = 'ONBOARDED';
  }

  return {
    quotationId: quotationId,
    totalSku: totalProducts,
    totalProducts: totalProducts,
    step1Completed: step1Completed,
    step2Completed: step2Completed,
    step3Completed: step3Completed,
    rejected: rejected,
    inProgress: inProgress,
    pending: totalProducts - step3Completed - rejected,
    approved: step3Completed,
    isApproved: allApproved,
    isRejected: allRejected,
    currentStage: currentStage,
    message: allApproved
      ? '모든 상품 승인 완료'
      : allRejected
        ? '모든 상품 반려됨'
        : `진행 중: ${inProgress}개, 완료: ${step3Completed}/${totalProducts}개`
  };
}

/**
 * vendorId 직접 가져오기 (쿠키에서 또는 API로)
 * vendorId 형식: A01275313 (문자+숫자)
 */
async function getVendorIdDirect() {
  try {
    // 방법 1: 쿠팡 API로 현재 사용자 정보 가져오기
    const response = await coupangApiFetch('https://supplier.coupang.com/api/v1/me');

    if (response.ok) {
      const data = await response.json();
      console.log('📥 [Direct API] /me response:', data);
      if (data.vendorId) {
        console.log('✅ [Direct API] vendorId from /me:', data.vendorId);
        return { success: true, vendorId: data.vendorId };
      }
    }

    // 방법 2: 쿠팡 메인 페이지에서 vendorId 추출 시도
    const pageResponse = await coupangApiFetch('https://supplier.coupang.com/');
    if (pageResponse.ok) {
      const html = await pageResponse.text();
      console.log('📥 [Direct API] Page HTML length:', html.length);

      // vendorId 패턴 찾기 (A01275313 형식 - 문자+숫자)
      const patterns = [
        /"vendorId"\s*:\s*"([A-Z]\d+)"/i,           // "vendorId":"A01275313"
        /vendorId['":\s]+['"]?([A-Z]\d+)['"]?/i,   // vendorId: 'A01275313'
        /vendor_id['":\s]+['"]?([A-Z]\d+)['"]?/i,  // vendor_id: A01275313
        /"vendorId"\s*:\s*"?([A-Z0-9]+)"?/i,       // 더 넓은 패턴
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          console.log('✅ [Direct API] vendorId from page:', match[1]);
          return { success: true, vendorId: match[1] };
        }
      }

      // 디버깅: vendorId가 포함된 부분 출력
      const vendorIdIndex = html.indexOf('vendorId');
      if (vendorIdIndex !== -1) {
        console.log('🔍 [Direct API] vendorId context:', html.substring(vendorIdIndex, vendorIdIndex + 50));
      }
    }

    return { success: false, error: 'vendorId를 찾을 수 없습니다' };

  } catch (error) {
    console.error('❌ [Direct API] getVendorId error:', error);
    return { success: false, error: error.message };
  }
}

let coupangTab = null;
const injectedTabs = new Set(); // 이미 주입된 탭 추적
let excelDataStore = []; // Excel 파일 데이터를 메모리에 저장 (ArrayBuffer)

// 쿠팡 쿠키 자동 삭제 설정
let coupangOperationCount = 0;
const COOKIE_CLEAR_THRESHOLD = 10; // 10번 작업 후 쿠키 삭제

// 쿠팡 탭 자동 새로고침 설정 (세션 만료 방지)
let coupangTabRefreshTimers = new Map(); // tabId -> timerId
const COUPANG_REFRESH_INTERVAL = 20 * 60 * 1000; // 20분

// 업로드 작업 진행 중 플래그 (새로고침 방지용)
let isUploadInProgress = false;

/**
 * 쿠팡 탭 자동 새로고침 타이머 시작
 */
function startCoupangRefreshTimer(tabId) {
  // 기존 타이머 제거
  stopCoupangRefreshTimer(tabId);

  console.log(`⏰ 쿠팡 탭 새로고침 타이머 시작: ${tabId} (${COUPANG_REFRESH_INTERVAL / 60000}분 간격)`);

  const timerId = setInterval(() => {
    // 업로드 중이면 새로고침 건너뛰기
    if (isUploadInProgress) {
      console.log(`⏸️ 업로드 진행 중, 탭 ${tabId} 새로고침 건너뜀`);
      return;
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.log(`⚠️ 쿠팡 탭 ${tabId} 없음, 타이머 정리`);
        stopCoupangRefreshTimer(tabId);
        return;
      }
      // 쿠팡 도메인이면 새로고침
      if (tab.url && tab.url.includes('coupang.com')) {
        console.log(`🔄 쿠팡 탭 자동 새로고침: ${tabId}`);
        chrome.tabs.reload(tabId);
      } else {
        // 쿠팡이 아니면 타이머 정리
        stopCoupangRefreshTimer(tabId);
      }
    });
  }, COUPANG_REFRESH_INTERVAL);

  coupangTabRefreshTimers.set(tabId, timerId);
}

/**
 * 쿠팡 탭 자동 새로고침 타이머 중지
 */
function stopCoupangRefreshTimer(tabId) {
  if (coupangTabRefreshTimers.has(tabId)) {
    clearInterval(coupangTabRefreshTimers.get(tabId));
    coupangTabRefreshTimers.delete(tabId);
    console.log(`⏹️ 쿠팡 탭 새로고침 타이머 중지: ${tabId}`);
  }
}

/**
 * 캐시 관련 쿠키만 선택적 삭제 (로그인 유지)
 * 페이지 캐시 문제를 일으키는 쿠키들만 삭제
 */
async function clearCoupangCacheCookies() {
  console.log('🧹 쿠팡 캐시 쿠키 삭제 중...');

  // 삭제할 캐시 관련 쿠키 패턴 (로그인 쿠키는 제외)
  const cachePatterns = [
    /^_ga/,           // Google Analytics
    /^_gid/,
    /^_gat/,
    /^PCID/,          // 페이지 캐시 ID
    /^SEARCHPAGE/,    // 검색 페이지 캐시
    /^x-coupang-/,    // 쿠팡 캐시 관련
    /^wcs_/,          // 웹 캐시
    /^ab\./,          // A/B 테스트
    /^_fbp/,          // Facebook pixel
    /^_tt_/,          // TikTok
    /cache/i,         // 캐시 관련
    /^recent/i,       // 최근 항목
  ];

  // 유지해야 할 로그인 관련 쿠키
  const keepPatterns = [
    /^SUID/,          // 세션 ID
    /^SID/,
    /session/i,
    /^token/i,
    /^auth/i,
    /^login/i,
    /^JSESSIONID/,
  ];

  let deletedCount = 0;
  const cookies = await chrome.cookies.getAll({ domain: '.coupang.com' });

  for (const cookie of cookies) {
    const name = cookie.name;

    // 유지해야 할 쿠키인지 확인
    const shouldKeep = keepPatterns.some(pattern => pattern.test(name));
    if (shouldKeep) continue;

    // 삭제해야 할 캐시 쿠키인지 확인
    const shouldDelete = cachePatterns.some(pattern => pattern.test(name));
    if (shouldDelete) {
      try {
        const url = `https://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
        await chrome.cookies.remove({ url, name });
        deletedCount++;
      } catch (e) {
        // 무시
      }
    }
  }

  console.log(`🧹 캐시 쿠키 ${deletedCount}개 삭제 완료`);
  return deletedCount;
}

/**
 * QVT 페이지 쿠키 리셋 및 새로고침
 * QVT 등록 페이지에서 발생하는 쿠키/세션 문제 해결
 */
async function resetQvtCookiesAndReload() {
  console.log('🔄 QVT 페이지 쿠키 리셋 시작...');

  // QVT 관련 쿠키 패턴
  const qvtCookiePatterns = [
    /^WMONID/,
    /^JSESSIONID/,
    /^wcs_/,
    /^_WCS/,
    /qvt/i,
    /^PCID/,
    /^x-coupang-/,
    /^supplier/i,
  ];

  let deletedCount = 0;

  // supplier.coupang.com 쿠키 가져오기
  const cookies = await chrome.cookies.getAll({ domain: 'supplier.coupang.com' });

  for (const cookie of cookies) {
    const shouldDelete = qvtCookiePatterns.some(pattern => pattern.test(cookie.name));
    if (shouldDelete) {
      try {
        const url = `https://supplier.coupang.com${cookie.path}`;
        await chrome.cookies.remove({ url, name: cookie.name });
        deletedCount++;
        console.log(`🗑️ 삭제된 쿠키: ${cookie.name}`);
      } catch (e) {
        // 무시
      }
    }
  }

  // .coupang.com 도메인 쿠키도 일부 삭제
  const globalCookies = await chrome.cookies.getAll({ domain: '.coupang.com' });
  for (const cookie of globalCookies) {
    if (/^(WMONID|PCID|x-coupang-)/.test(cookie.name)) {
      try {
        const url = `https://coupang.com${cookie.path}`;
        await chrome.cookies.remove({ url, name: cookie.name });
        deletedCount++;
      } catch (e) {
        // 무시
      }
    }
  }

  console.log(`🧹 QVT 쿠키 ${deletedCount}개 삭제 완료`);

  // QVT 탭 찾아서 새로고침
  const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/qvt/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      console.log(`🔄 QVT 탭 새로고침: ${tab.id}`);
    } catch (e) {
      console.log('⚠️ QVT 탭 새로고침 실패:', e.message);
    }
  }

  return { deletedCount, reloadedTabs: tabs.length };
}

/**
 * 쿠팡 관련 쿠키 전체 삭제
 */
async function clearCoupangCookies() {
  console.log('🧹 쿠팡 쿠키 삭제 시작...');

  const coupangDomains = [
    '.coupang.com',
    'supplier.coupang.com',
    'xauth.coupang.com'
  ];

  let deletedCount = 0;

  for (const domain of coupangDomains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: domain });
      for (const cookie of cookies) {
        const url = `https://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
        await chrome.cookies.remove({
          url: url,
          name: cookie.name
        });
        deletedCount++;
      }
    } catch (error) {
      console.log(`⚠️ ${domain} 쿠키 삭제 중 오류:`, error);
    }
  }

  coupangOperationCount = 0;
  console.log(`🧹 쿠팡 쿠키 ${deletedCount}개 삭제 완료`);
  return deletedCount;
}

/**
 * 쿠팡 작업 카운터 증가 및 필요시 쿠키 삭제
 */
async function incrementCoupangOperation() {
  coupangOperationCount++;
  console.log(`📊 쿠팡 작업 카운트: ${coupangOperationCount}/${COOKIE_CLEAR_THRESHOLD}`);

  if (coupangOperationCount >= COOKIE_CLEAR_THRESHOLD) {
    await clearCoupangCookies();
  }
}

// ======================================
// 🔄 자동 승인 상태 확인 시스템
// ======================================
const APPROVAL_CHECK_INTERVAL = 10 * 60 * 1000; // 10분
let approvalCheckerStarted = false;
let approvalCheckerIntervalId = null;
let cachedVendorId = null;

/**
 * 자동 승인 확인 시작 (uploaded.html 페이지 진입 시에만)
 */
function startApprovalChecker() {
  if (approvalCheckerStarted) {
    console.log('⚠️ 승인 확인기가 이미 실행 중입니다.');
    return;
  }

  console.log('🔄 자동 승인 확인 시작 (10분 간격) - uploaded.html 활성화');
  approvalCheckerStarted = true;

  // 즉시 한 번 실행
  checkUploadedProductsApproval();

  // 10분마다 실행
  approvalCheckerIntervalId = setInterval(() => {
    checkUploadedProductsApproval();
  }, APPROVAL_CHECK_INTERVAL);
}

/**
 * 자동 승인 확인 중지 (uploaded.html 페이지에서 나갈 때)
 */
function stopApprovalChecker() {
  if (!approvalCheckerStarted) {
    return;
  }

  console.log('⏹️ 자동 승인 확인 중지 - uploaded.html 비활성화');

  if (approvalCheckerIntervalId) {
    clearInterval(approvalCheckerIntervalId);
    approvalCheckerIntervalId = null;
  }
  approvalCheckerStarted = false;
}

/**
 * 업로드된 상품들의 승인 상태 확인
 */
async function checkUploadedProductsApproval() {
  try {
    console.log('\n========================================');
    console.log('🔍 자동 승인 상태 확인 시작');
    console.log('========================================');

    // 1. 서버에서 uploaded 상태 상품 목록 가져오기
    const response = await authFetch(`${SERVER_URL}/api/products/list`);
    if (!response.ok) {
      console.log('⚠️ 서버 연결 실패, 다음 주기에 재시도');
      return;
    }

    const { products } = await response.json();
    const uploadedProducts = products.filter(p =>
      p.status === 'uploaded' && p.quoteId
    );

    if (uploadedProducts.length === 0) {
      console.log('ℹ️ 확인할 업로드 상품이 없습니다.');
      return;
    }

    // 심사중인 상품만 필터링 (반려 완료 또는 전체 승인된 상품 제외)
    const productsToCheck = uploadedProducts.filter(product => {
      const skuStatus = product.skuStatus;
      if (!skuStatus) return true; // 아직 확인 안 됨

      const totalSku = skuStatus.totalSku || 0;
      const approved = skuStatus.approved || 0;
      const rejected = skuStatus.rejected || 0;
      const pending = skuStatus.pending || 0;

      // 전체 반려 또는 전체 승인 또는 심사중 없음
      if ((rejected === totalSku || approved === totalSku || pending === 0) && totalSku > 0) {
        return false;
      }
      return true;
    });

    console.log(`📦 전체 업로드 상품: ${uploadedProducts.length}개`);
    console.log(`   - 확인 대상 (심사중): ${productsToCheck.length}개`);
    console.log(`   - 건너뜀 (반려/승인 완료): ${uploadedProducts.length - productsToCheck.length}개`);

    if (productsToCheck.length === 0) {
      console.log('ℹ️ 모든 상품이 심사 완료되었습니다.');
      return;
    }

    // 2. quoteId별로 그룹화 (확인 대상만)
    const quoteGroups = {};
    productsToCheck.forEach(product => {
      if (!quoteGroups[product.quoteId]) {
        quoteGroups[product.quoteId] = [];
      }
      quoteGroups[product.quoteId].push(product.id);
    });

    console.log(`📋 확인할 견적서: ${Object.keys(quoteGroups).length}개`);

    // 3. vendorId 가져오기 (Direct API 방식)
    if (!cachedVendorId) {
      console.log('🔍 vendorId 가져오는 중 (Direct API)...');
      const vendorResult = await getVendorIdDirect();

      if (!vendorResult || !vendorResult.success) {
        console.log('⚠️ vendorId를 가져올 수 없습니다. 쿠팡에 로그인해주세요.');
        return;
      }
      cachedVendorId = vendorResult.vendorId;
      console.log('✅ vendorId:', cachedVendorId);
    }

    // 4. 각 견적서 상태 확인 (Direct API 방식)
    for (const [quoteId, productIds] of Object.entries(quoteGroups)) {
      console.log(`\n🔍 견적서 ${quoteId} 확인 중... (Direct API)`);

      try {
        const statusResult = await checkQuotationStatusDirect(quoteId, cachedVendorId);

        if (statusResult && statusResult.success) {
          console.log(`   📊 결과: ${statusResult.message}`);
          console.log(`   📊 SKU: ${statusResult.totalSku}개, 심사중: ${statusResult.pending}개, 승인: ${statusResult.approved}개`);

          // SKU 상태 업데이트
          await updateProductsSkuStatus(productIds, statusResult);

          // 승인 완료 시 상태 변경
          if (statusResult.isApproved) {
            console.log(`   ✅ 승인 완료! 상태 업데이트 중...`);
            await updateProductsToApproved(productIds);
          }
        } else {
          console.log(`   ⚠️ 상태 확인 실패: ${statusResult?.error || '알 수 없는 오류'}`);
        }

        // Rate limiting: 1-2초 대기
        await sleep(1000 + Math.random() * 1000);

      } catch (error) {
        console.error(`   ❌ 견적서 ${quoteId} 확인 오류:`, error);
      }
    }

    console.log('\n✅ 자동 승인 상태 확인 완료');

    // 자동 확인 완료 후 API 탭 닫기
    await closeApiTab();

  } catch (error) {
    console.error('❌ 자동 승인 확인 오류:', error);
    // 오류 발생 시에도 API 탭 닫기
    await closeApiTab();
  }
}

/**
 * 쿠팡 탭 찾기 및 content script 준비
 */
async function findCoupangTab() {
  const allTabs = await chrome.tabs.query({});
  const coupangTab = allTabs.find(tab =>
    tab.url && tab.url.includes('supplier.coupang.com')
  );

  if (!coupangTab) {
    return null;
  }

  // Content script가 로드되어 있는지 확인
  try {
    const response = await chrome.tabs.sendMessage(coupangTab.id, { action: 'ping' });
    if (response && response.pong) {
      console.log('✅ 쿠팡 탭 content script 준비됨');
      return coupangTab.id;
    }
  } catch (error) {
    console.log('⚠️ Content script 미로드, 주입 시도 중...');

    // Content script 주입 시도
    try {
      await chrome.scripting.executeScript({
        target: { tabId: coupangTab.id },
        files: ['content/content-coupang.js']
      });
      console.log('✅ Content script 주입 완료');

      // 주입 후 잠시 대기
      await sleep(1000);
      return coupangTab.id;
    } catch (injectError) {
      console.error('❌ Content script 주입 실패:', injectError);
      return null;
    }
  }

  return coupangTab.id;
}

/**
 * 상품 상태를 approved로 변경
 */
async function updateProductsToApproved(productIds) {
  try {
    const response = await authFetch(`${SERVER_URL}/api/products/batch-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: productIds,
        status: 'approved'
      })
    });

    if (response.ok) {
      console.log(`   ✅ ${productIds.length}개 상품 승인 완료 처리`);

      // 각 상품에 approvedAt 추가
      for (const productId of productIds) {
        await authFetch(`${SERVER_URL}/api/products/${productId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvedAt: new Date().toISOString()
          })
        });
      }
    }
  } catch (error) {
    console.error('   ❌ 상태 업데이트 실패:', error);
  }
}

/**
 * Sleep 헬퍼 함수
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 수동 승인 확인 (웹 페이지에서 버튼 클릭 시 호출)
 * @param {Array} products - 업로드된 상품 목록
 * @returns {Object} - { checkedCount, approvedCount }
 */
async function handleManualApprovalCheck(products) {
  console.log('\n========================================');
  console.log('🔍 수동 승인 상태 확인 시작');
  console.log('========================================');

  const result = {
    checkedCount: 0,
    approvedCount: 0,
    skippedCount: 0
  };

  if (!products || products.length === 0) {
    console.log('⚠️ 확인할 상품이 없습니다.');
    return result;
  }

  // 심사중인 상품만 필터링 (반려 완료 또는 전체 승인된 상품 제외)
  const productsToCheck = products.filter(product => {
    const skuStatus = product.skuStatus;

    // skuStatus가 없으면 아직 확인 안 된 상품이므로 확인 필요
    if (!skuStatus) {
      return true;
    }

    const totalSku = skuStatus.totalSku || 0;
    const approved = skuStatus.approved || 0;
    const rejected = skuStatus.rejected || 0;
    const pending = skuStatus.pending || 0;

    // 전체 반려된 경우 (모든 SKU가 반려됨)
    if (rejected === totalSku && totalSku > 0) {
      console.log(`   ⏭️ 건너뜀 (전체 반려): ${product.title || product.id}`);
      return false;
    }

    // 전체 승인된 경우 (모든 SKU가 승인됨)
    if (approved === totalSku && totalSku > 0) {
      console.log(`   ⏭️ 건너뜀 (전체 승인): ${product.title || product.id}`);
      return false;
    }

    // 심사중인 항목이 없는 경우 (승인 + 반려 = 전체)
    if (pending === 0 && totalSku > 0) {
      console.log(`   ⏭️ 건너뜀 (심사 완료): ${product.title || product.id}`);
      return false;
    }

    return true;
  });

  const skippedProducts = products.length - productsToCheck.length;
  result.skippedCount = skippedProducts;

  console.log(`📦 전체 상품: ${products.length}개`);
  console.log(`   - 확인 대상: ${productsToCheck.length}개`);
  console.log(`   - 건너뜀 (반려/승인 완료): ${skippedProducts}개`);

  if (productsToCheck.length === 0) {
    console.log('ℹ️ 모든 상품이 심사 완료되었습니다 (승인 또는 반려).');
    return result;
  }

  // quoteId별로 그룹화 (확인 대상 상품만)
  const quoteGroups = {};
  productsToCheck.forEach(product => {
    if (product.quoteId) {
      if (!quoteGroups[product.quoteId]) {
        quoteGroups[product.quoteId] = [];
      }
      quoteGroups[product.quoteId].push(product.id);
    }
  });

  const quoteIds = Object.keys(quoteGroups);
  console.log(`📋 확인할 견적서: ${quoteIds.length}개`);

  if (quoteIds.length === 0) {
    console.log('⚠️ 견적서 ID가 있는 상품이 없습니다.');
    return result;
  }

  // vendorId 가져오기 (Direct API 방식 - 쿠팡 탭 불필요)
  if (!cachedVendorId) {
    console.log('🔍 vendorId 가져오는 중 (Direct API)...');
    const vendorResult = await getVendorIdDirect();

    if (!vendorResult || !vendorResult.success) {
      // fallback: 기존 방식 (content script)
      console.log('⚠️ Direct API 실패, content script 방식으로 시도...');
      const coupangTabId = await findCoupangTab();
      if (coupangTabId) {
        const vendorResultFallback = await chrome.tabs.sendMessage(coupangTabId, {
          action: 'getVendorId'
        });
        if (vendorResultFallback && vendorResultFallback.success) {
          cachedVendorId = vendorResultFallback.vendorId;
        }
      }

      if (!cachedVendorId) {
        throw new Error('vendorId를 가져올 수 없습니다. 쿠팡에 로그인해주세요.');
      }
    } else {
      cachedVendorId = vendorResult.vendorId;
    }
    console.log('✅ vendorId:', cachedVendorId);
  }

  // 각 견적서 상태 확인 (Direct API 방식)
  for (const [quoteId, productIds] of Object.entries(quoteGroups)) {
    console.log(`\n🔍 견적서 ${quoteId} 확인 중... (Direct API)`);
    result.checkedCount++;

    try {
      // Direct API로 승인 상태 확인 (페이지 캐시 문제 우회)
      const statusResult = await checkQuotationStatusDirect(quoteId, cachedVendorId);

      if (statusResult && statusResult.success) {
        console.log(`   📊 결과: ${statusResult.message}`);
        console.log(`   📊 SKU: ${statusResult.totalSku}개, 심사중: ${statusResult.pending}개, 승인: ${statusResult.approved}개`);

        // SKU 상태 데이터를 각 상품에 저장 (항상 업데이트)
        await updateProductsSkuStatus(productIds, statusResult);

        // 승인 완료 시 상태 변경
        if (statusResult.isApproved) {
          console.log(`   ✅ 승인 완료! 상태 업데이트 중...`);
          await updateProductsToApproved(productIds);
          result.approvedCount += productIds.length;
        }
      } else {
        console.log(`   ⚠️ 상태 확인 실패: ${statusResult?.error || '알 수 없는 오류'}`);
      }

      // Rate limiting: 1-2초 대기 (Direct API는 더 빠르게 가능)
      if (Object.keys(quoteGroups).indexOf(quoteId) < quoteIds.length - 1) {
        await sleep(1000 + Math.random() * 1000);
      }

    } catch (error) {
      console.error(`   ❌ 견적서 ${quoteId} 확인 오류:`, error);
    }
  }

  console.log('\n✅ 수동 승인 상태 확인 완료');
  console.log(`   확인된 견적서: ${result.checkedCount}개`);
  console.log(`   승인된 상품: ${result.approvedCount}개`);

  // 확인 완료 후 API 탭 닫기
  await closeApiTab();

  return result;
}

/**
 * 상품에 SKU 상태 데이터 저장
 */
async function updateProductsSkuStatus(productIds, statusResult) {
  try {
    const skuStatusData = {
      totalSku: statusResult.totalSku || 0,
      pending: statusResult.pending || 0,
      approved: statusResult.approved || 0,
      rejected: statusResult.rejected || 0,
      inProgress: statusResult.inProgress || 0,
      currentStage: statusResult.currentStage,
      stageDetails: statusResult.stageDetails,
      step1Completed: statusResult.step1Completed || 0,
      step2Completed: statusResult.step2Completed || 0,
      step3Completed: statusResult.step3Completed || 0,
      lastCheckedAt: new Date().toISOString()
    };

    // 각 상품에 SKU 상태 업데이트
    for (const productId of productIds) {
      await authFetch(`${SERVER_URL}/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuStatus: skuStatusData,
          approvalStage: statusResult.currentStage,
          isRejected: statusResult.isRejected
        })
      });
    }

    console.log(`   ✅ ${productIds.length}개 상품에 SKU 상태 저장 완료`);
  } catch (error) {
    console.error('   ❌ SKU 상태 저장 실패:', error);
  }
}

// 확장 프로그램 시작 시 쿠팡 탭 있으면 Heartbeat 시작
chrome.runtime.onStartup.addListener(async () => {
  console.log('🚀 확장 프로그램 시작됨');
  // 승인 확인은 uploaded.html 진입 시에만 시작됨

  // 브라우저 시작 시 쿠팡 탭이 이미 열려 있으면 Heartbeat 시작
  const coupangTab = await findActiveCoupangTab();
  if (coupangTab) {
    console.log('🔔 브라우저 시작 시 쿠팡 탭 발견, Heartbeat 시작');
    startCoupangHeartbeat();
  }
});

// 확장 프로그램 설치/업데이트 시
chrome.runtime.onInstalled.addListener(async () => {
  console.log('📦 확장 프로그램 설치/업데이트됨');
  // 승인 확인은 uploaded.html 진입 시에만 시작됨

  // 설치/업데이트 시에도 쿠팡 탭 있으면 Heartbeat 시작
  const coupangTab = await findActiveCoupangTab();
  if (coupangTab) {
    console.log('🔔 설치/업데이트 시 쿠팡 탭 발견, Heartbeat 시작');
    startCoupangHeartbeat();
  }
});

// 서비스 워커 활성화 시 (승인 확인은 uploaded.html 진입 시에만)
// startApprovalChecker(); // 제거됨 - uploaded.html 진입 시에만 시작

// localhost 탭에 자동으로 content script 주입 + 쿠팡 탭 Heartbeat 시작
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 쿠팡 탭 로드 완료 시 Heartbeat 시작 + 자동 새로고침 타이머 시작
  if (changeInfo.status === 'complete' &&
      tab.url &&
      tab.url.includes('supplier.coupang.com')) {
    console.log('🔔 쿠팡 탭 로드 완료, Heartbeat 시작');
    startCoupangHeartbeat();
    // 세션 만료 방지를 위한 자동 새로고침 타이머 시작
    startCoupangRefreshTimer(tabId);
  }

  // uploaded.html 진입 시 자동 승인 확인 시작
  if (changeInfo.status === 'complete' &&
      tab.url &&
      tab.url.includes('totalbot.cafe24.com/uploaded.html')) {
    console.log('📋 업로드 완료 페이지 진입, 자동 승인 확인 시작');
    startApprovalChecker();
  }

  // uploaded.html에서 다른 페이지로 이동 시 승인 확인 중지
  if (changeInfo.url &&
      !changeInfo.url.includes('uploaded.html') &&
      approvalCheckerStarted) {
    // URL이 변경되었고, uploaded.html이 아니면 중지
    stopApprovalChecker();
  }

  // 탭이 완전히 로드되고, totalbot.cafe24.com/node-api이며, 아직 주입하지 않았을 때
  if (changeInfo.status === 'complete' &&
      tab.url &&
      tab.url.startsWith('https://totalbot.cafe24.com/') &&
      !injectedTabs.has(tabId)) {

    console.log('🔧 Injecting content script to localhost tab:', tabId);

    // MAIN world에 주입하여 페이지의 localStorage와 window에 직접 접근
    const extensionId = chrome.runtime.id;

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',  // 페이지의 메인 컨텍스트에서 실행
      func: (extId) => {
        console.log('🚀 TotalBot Extension Script loaded in MAIN world');

        try {
          // localStorage에 Extension ID 저장
          localStorage.setItem('totalbotExtensionId', extId);
          console.log('✅ Extension ID saved to localStorage:', extId);

          // CustomEvent로 페이지에 알림
          window.dispatchEvent(new CustomEvent('TotalbotExtensionReady', {
            detail: { extensionId: extId }
          }));
          console.log('✅ Extension ready event dispatched');
        } catch (e) {
          console.error('❌ Failed to initialize extension:', e);
        }
      },
      args: [extensionId]
    }).then((results) => {
      injectedTabs.add(tabId);
      console.log('✅ Content script injected successfully to MAIN world');
      console.log('📊 Injection results:', results);
    }).catch(err => {
      console.error('❌ Failed to inject content script:', err);
      console.error('❌ Error details:', { tabId, url: tab.url, error: err.message });
    });
  }
});

// 탭이 닫히면 추적에서 제거 + 마지막 쿠팡 탭 닫힘 시 Heartbeat 중지
chrome.tabs.onRemoved.addListener(async (tabId) => {
  injectedTabs.delete(tabId);

  // API 전용 탭이 닫혔으면 캐시 정리
  if (tabId === apiTabId) {
    console.log('📌 API 전용 탭이 닫힘, 캐시 정리');
    apiTabId = null;
    try {
      await chrome.storage.session.remove('apiTabId');
    } catch (e) {}
  }

  // 쿠팡 탭 자동 새로고침 타이머 정리
  stopCoupangRefreshTimer(tabId);

  // 쿠팡 탭이 남아있는지 확인
  if (heartbeatActive) {
    const remainingCoupangTab = await findActiveCoupangTab();
    if (!remainingCoupangTab) {
      console.log('🔔 마지막 쿠팡 탭 닫힘, Heartbeat 중지');
      stopCoupangHeartbeat();
    }
  }

  // uploaded.html 탭이 남아있는지 확인
  if (approvalCheckerStarted) {
    const tabs = await chrome.tabs.query({ url: '*://totalbot.cafe24.com/uploaded.html*' });
    if (tabs.length === 0) {
      console.log('📋 마지막 업로드 완료 페이지 닫힘, 승인 확인 중지');
      stopApprovalChecker();
    }
  }
});

// 메시지 리스너 (Extension 내부에서 오는 메시지 - content scripts, popup 등)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received internal message:', message.action);

  // TotalBot 로그인
  if (message.action === 'login') {
    (async () => {
      try {
        const { username, password } = message.data;
        const response = await fetch(`${SERVER_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success && data.token) {
          // 토큰 저장
          await chrome.storage.local.set({
            authToken: data.token,
            userInfo: data.user
          });
          sendResponse({ success: true, user: data.user });
        } else {
          sendResponse({ success: false, error: data.message || '로그인 실패' });
        }
      } catch (error) {
        console.error('로그인 오류:', error);
        sendResponse({ success: false, error: '서버 연결 실패' });
      }
    })();
    return true;
  }

  // TotalBot 로그아웃
  if (message.action === 'logout') {
    chrome.storage.local.remove(['authToken', 'userInfo'], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // QVT 쿠키 리셋 및 새로고침
  if (message.action === 'resetQvtCookies') {
    (async () => {
      try {
        const result = await resetQvtCookiesAndReload();
        sendResponse({ success: true, ...result });
      } catch (error) {
        console.error('QVT 쿠키 리셋 오류:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // 현재 탭 닫기 (수집 완료 후)
  if (message.action === 'closeCurrentTab') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
    return false;
  }

  // 대용량 데이터 청크 요청 (content script에서 호출)
  if (message.action === 'getUploadDataChunk') {
    const { type, index } = message;
    const data = getPendingUploadData();

    if (!data) {
      sendResponse({ success: false, error: '업로드 데이터가 없습니다' });
      return true;
    }

    try {
      let chunk;
      if (type === 'excelFiles') {
        chunk = data.excelFiles;
      } else if (type === 'productImage') {
        chunk = data.productImages[index];
      } else if (type === 'labelImage') {
        chunk = data.labelImages[index];
      } else if (type === 'products') {
        chunk = data.products;
      } else {
        sendResponse({ success: false, error: '알 수 없는 데이터 타입' });
        return true;
      }

      sendResponse({ success: true, data: chunk });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (message.action === 'uploadToCoupang') {
    incrementCoupangOperation();
    handleCoupangUpload(message.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 비동기 응답을 위해 true 반환
  }

  if (message.action === 'getCoupangSettings') {
    // 로컬 스토리지에서 쿠팡 설정 가져오기
    chrome.storage.local.get(['totalbotSettings'], (result) => {
      const settings = result.totalbotSettings || {};
      sendResponse({
        coupangId: settings.coupangId || '',
        coupangPassword: settings.coupangPassword || '',
        address: settings.address || ''
      });
    });
    return true;
  }

  if (message.action === 'checkCoupangLogin') {
    // 쿠팡 로그인 시도
    handleCoupangLogin(message.credentials)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getCoupangLoginStatus') {
    // 현재 로그인 상태 확인
    checkCoupangLoginStatus()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ loggedIn: false }));
    return true;
  }

  if (message.action === 'fillQuotationExcels') {
    // 견적서 Excel 파일 자동 작성
    incrementCoupangOperation();
    console.log('🎯 INTERNAL fillQuotationExcels 핸들러 실행됨!');
    console.log('📦 INTERNAL message.downloadOnly:', message.downloadOnly);
    handleFillQuotationExcels(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 수동 승인 상태 확인 요청 (웹 페이지에서 버튼 클릭)
  if (message.action === 'checkApprovalNow') {
    console.log('🔍 수동 승인 확인 요청 받음');
    handleManualApprovalCheck(message.products)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 새 탭 열기
  if (message.action === 'openTab') {
    console.log('🔗 새 탭 열기 요청:', message.url);
    chrome.tabs.create({ url: message.url }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  // 쿠팡 탭에 메시지 전달
  if (message.action === 'sendToCoupangTab') {
    console.log('📤 쿠팡 탭에 메시지 전달:', message.targetAction);

    // 업로드 작업은 별도 핸들러로 처리 (페이지 이동 필요)
    if (message.targetAction === 'uploadOrderConfirmation') {
      handleOrderConfirmationUpload(message.orderData)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.targetAction === 'uploadShipment') {
      handleShipmentUpload(message.shipmentData)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쉽먼트 번호 검색 (발주번호로 조회)
    if (message.targetAction === 'searchShipmentNumber') {
      handleSearchShipmentNumber(message.poNumber)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쉽먼트 목록 조회
    if (message.targetAction === 'getShipmentList') {
      handleGetShipmentList(message.filters || {})
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쉽먼트 라벨 PDF 다운로드
    if (message.targetAction === 'downloadShipmentLabel') {
      handleShipmentAction('downloadShipmentLabel', { parcelShipmentSeq: message.parcelShipmentSeq })
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쉽먼트 내역서 PDF 다운로드
    if (message.targetAction === 'downloadShipmentManifest') {
      handleShipmentAction('downloadShipmentManifest', { parcelShipmentSeq: message.parcelShipmentSeq })
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쉽먼트 문서 일괄 다운로드
    if (message.targetAction === 'downloadShipmentDocuments') {
      handleShipmentAction('downloadShipmentDocuments', { parcelShipmentSeq: message.parcelShipmentSeq })
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쉽먼트 업로드 후 전체 처리 (검색 + 다운로드)
    if (message.targetAction === 'processShipmentAfterUpload') {
      handleShipmentAction('processShipmentAfterUpload', { poNumbers: message.poNumbers })
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // 쿠팡 탭 찾기
    chrome.tabs.query({ url: '*://supplier.coupang.com/*' }, (tabs) => {
      if (tabs.length === 0) {
        console.log('⚠️ 쿠팡 탭이 없습니다. 새 탭 열기...');
        // 쿠팡 탭이 없으면 새로 열기
        chrome.tabs.create({
          url: 'https://supplier.coupang.com/scm/purchase/order/list'
        }, (newTab) => {
          sendResponse({
            success: false,
            error: '쿠팡 페이지를 새 탭에서 열었습니다. 로그인 후 다시 시도해주세요.',
            tabOpened: true,
            tabId: newTab.id
          });
        });
        return;
      }

      const coupangTab = tabs[0];
      console.log('✅ 쿠팡 탭 발견:', coupangTab.id, coupangTab.url);

      // 쿠팡 탭에 메시지 전달
      chrome.tabs.sendMessage(coupangTab.id, {
        action: message.targetAction,
        settings: message.settings,
        orderData: message.orderData,       // 발주 확정 업로드용
        shipmentData: message.shipmentData  // 쉽먼트 업로드용
      }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || '알 수 없는 오류';
          console.error('❌ 쿠팡 탭 메시지 전달 실패:', errorMsg);

          // Content script가 로드되지 않은 경우 자동 주입 시도
          if (errorMsg.includes('Receiving end does not exist')) {
            console.log('🔄 Content script 자동 주입 시도...');
            chrome.scripting.executeScript({
              target: { tabId: coupangTab.id },
              files: ['content/content-coupang.js']
            }).then(() => {
              console.log('✅ Content script 주입 완료, 메시지 재전송...');
              // 잠시 대기 후 메시지 재전송
              setTimeout(() => {
                chrome.tabs.sendMessage(coupangTab.id, {
                  action: message.targetAction,
                  settings: message.settings,
                  orderData: message.orderData,
                  shipmentData: message.shipmentData
                }, (retryResponse) => {
                  if (chrome.runtime.lastError) {
                    sendResponse({
                      success: false,
                      error: '재시도 실패: ' + chrome.runtime.lastError.message
                    });
                  } else {
                    sendResponse(retryResponse);
                  }
                });
              }, 1000);
            }).catch(err => {
              console.error('❌ Content script 주입 실패:', err);
              sendResponse({
                success: false,
                error: `Content script 주입 실패: ${err.message}`
              });
            });
            return; // 비동기 처리 중이므로 여기서 리턴
          }

          sendResponse({
            success: false,
            error: `쿠팡 페이지와 통신할 수 없습니다: ${errorMsg}`
          });
        } else {
          console.log('✅ 쿠팡 탭 응답:', response);
          sendResponse(response);
        }
      });
    });
    return true;
  }

  // ping 요청 처리
  if (message.action === 'ping') {
    sendResponse({ pong: true });
    return true;
  }

  // 쿠팡 가격 수집 (content script에서 호출)
  if (message.action === 'collectCoupangPrices') {
    console.log('💰 [내부] 쿠팡 가격 수집 요청:', message.keyword);
    handleCollectCoupangPrices(message.keyword, message.options || {})
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// 외부 메시지 리스너 (externally_connectable로 허용된 웹페이지에서 오는 메시지)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received EXTERNAL message:', message.action, 'from:', sender.url);

  if (message.action === 'uploadToCoupang') {
    incrementCoupangOperation();
    handleCoupangUpload(message.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getCoupangSettings') {
    chrome.storage.local.get(['totalbotSettings'], (result) => {
      const settings = result.totalbotSettings || {};
      sendResponse({
        coupangId: settings.coupangId || '',
        coupangPassword: settings.coupangPassword || '',
        address: settings.address || ''
      });
    });
    return true;
  }

  if (message.action === 'checkCoupangLogin') {
    console.log('🔐 External login request with credentials:', message.credentials);
    handleCoupangLogin(message.credentials)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getCoupangLoginStatus') {
    checkCoupangLoginStatus()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ loggedIn: false }));
    return true;
  }

  // QVT 쿠키 리셋 및 새로고침
  if (message.action === 'resetQvtCookies') {
    resetQvtCookiesAndReload()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'fillQuotationExcels') {
    // 견적서 Excel 파일 자동 작성
    incrementCoupangOperation();
    console.log('🎯 EXTERNAL fillQuotationExcels 핸들러 실행됨!');
    console.log('📦 받은 message 객체:', message);
    console.log('📦 message.downloadOnly:', message.downloadOnly);  // 🔥 downloadOnly 확인
    console.log('📦 message.products 타입:', typeof message.products);
    console.log('📦 message.products 배열 여부:', Array.isArray(message.products));
    console.log('📦 message.products 값:', message.products);
    if (Array.isArray(message.products)) {
      console.log('✅ products는 배열입니다. 길이:', message.products.length);
    } else {
      console.error('❌ 경고: products가 배열이 아닙니다! 실제 타입:', typeof message.products, '값:', message.products);
    }

    handleFillQuotationExcels(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 카테고리 검색 (쿠팡 탭으로 전달)
  if (message.action === 'searchCategories') {
    incrementCoupangOperation();
    handleCategorySearch(message.keyword)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 견적서 다운로드 (쿠팡 탭으로 전달)
  if (message.action === 'downloadQuotation') {
    incrementCoupangOperation();
    handleQuotationDownload(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 반려 견적서 상세 내역 다운로드 (쿠팡 탭에서 직접 실행)
  if (message.action === 'downloadQuotationResult') {
    handleDownloadQuotationResult(message.quoteId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 1688 일괄 수집
  if (message.action === 'batch1688Collect') {
    console.log('📦 batch1688Collect 요청 받음:', message.categories?.length, '개 카테고리');
    handleBatch1688Collect(message.categories, sender)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 견적서 자동 작성 (확장 프로그램에서 직접 처리)
  if (message.action === 'fillQuotations') {
    handleFillQuotations(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 쿠팡 가격 수집 (브라우저 탭에서 직접 처리)
  if (message.action === 'collectCoupangPrices') {
    handleCollectCoupangPrices(message.keyword, message.options || {})
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 다운로드 경로 초기화
  if (message.action === 'resetDownloadPath') {
    chrome.storage.local.remove('downloadPath', () => {
      console.log('✅ Download path reset');
      sendResponse({ success: true });
    });
    return true;
  }
});

/**
 * 쿠팡 자동 업로드 처리
 */
async function handleCoupangUpload(data) {
  try {
    console.log('🔄 Starting Coupang upload process...');
    console.log('📦 Product data:', data);

    // 쿠팡 로그인 URL (Python 코드와 동일)
    const oauthUrl = 'https://xauth.coupang.com/auth/realms/seller/protocol/openid-connect/auth?' +
      'response_type=code&client_id=supplier-hub&scope=openid&state=abc' +
      '&redirect_uri=https://supplier.coupang.com/login/oauth2/code/keycloak';

    let needsNewTab = true;
    let existingCoupangTab = null;

    // 1. 먼저 저장된 coupangTab 확인
    if (coupangTab) {
      try {
        const tab = await chrome.tabs.get(coupangTab);
        if (tab.url && (tab.url.includes('supplier.coupang.com') || tab.url.includes('xauth.coupang.com'))) {
          console.log('✅ Saved Coupang tab found:', tab.id, 'URL:', tab.url);
          existingCoupangTab = tab;
        }
      } catch (e) {
        console.log('⚠️ Saved tab closed');
        coupangTab = null;
      }
    }

    // 2. 저장된 탭이 없으면 모든 탭 검색
    if (!existingCoupangTab) {
      console.log('🔍 Searching all tabs for Coupang...');
      const allTabs = await chrome.tabs.query({});

      for (const tab of allTabs) {
        if (tab.url && (tab.url.includes('supplier.coupang.com') || tab.url.includes('xauth.coupang.com'))) {
          console.log('✅ Found existing Coupang tab:', tab.id, 'URL:', tab.url);
          existingCoupangTab = tab;
          coupangTab = tab.id; // 저장
          break;
        }
      }
    }

    // 3. 기존 탭이 있으면 재사용
    if (existingCoupangTab) {
      console.log('✅ Reusing existing Coupang tab');
      needsNewTab = false;
      // 탭 활성화
      await chrome.tabs.update(existingCoupangTab.id, { active: true });
      coupangTab = existingCoupangTab.id;
    }

    // 새 탭 생성 (필요한 경우에만)
    if (needsNewTab && !coupangTab) {
      console.log('🌐 Opening Coupang OAuth login page...');

      // 쿠팡 관련 캐시 및 쿠키 클리어
      try {
        console.log('🗑️ Clearing Coupang cache and cookies...');

        // 쿠팡 쿠키 삭제
        const cookies = await chrome.cookies.getAll({ domain: 'coupang.com' });
        for (const cookie of cookies) {
          await chrome.cookies.remove({
            url: `https://${cookie.domain}${cookie.path}`,
            name: cookie.name
          });
        }
        console.log(`✅ Cleared ${cookies.length} cookies`);

        // 캐시 삭제
        await chrome.browsingData.remove({
          origins: ['https://supplier.coupang.com', 'https://xauth.coupang.com']
        }, {
          cache: true,
          cacheStorage: true
        });
        console.log('✅ Cache cleared');
      } catch (e) {
        console.log('⚠️ Cache clear failed (non-critical):', e.message);
      }

      const tab = await chrome.tabs.create({
        url: oauthUrl,
        active: true // 사용자가 로그인할 수 있도록 활성화
      });
      coupangTab = tab.id;
      console.log('✅ Coupang tab created:', coupangTab);

      // 탭 로딩 완료 대기
      await waitForTabLoad(coupangTab);
    }

    // Content script로 상품 데이터 전송
    console.log('📤 Sending data to content script...');
    const response = await chrome.tabs.sendMessage(coupangTab, {
      action: 'startUpload',
      productData: data
    });

    console.log('✅ Upload process initiated:', response);
    return { success: true, tabId: coupangTab };

  } catch (error) {
    console.error('❌ Upload error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 이미지 파일명 생성 헬퍼 함수들 (Python json_to_excel.py 로직 기반)
 */

/**
 * 옵션 이미지 파일명 가져오기 (대표이미지 파일명)
 * Python의 get_option_image_filename() 함수와 동일한 로직
 */
function getOptionImageFilename(option, product, productIndex) {
  // URL에서 파일명과 확장자 추출하는 헬퍼 함수
  function extractFilenameFromUrl(imageUrl) {
    try {
      const url = new URL(imageUrl);
      const pathname = url.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);

      // 확장자 추출 (원본 확장자 유지)
      const extMatch = filename.match(/\.([a-zA-Z]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;

      // option_ 또는 set_ 접두사가 없으면 추가
      if (!nameWithoutExt.startsWith('option_') && !nameWithoutExt.startsWith('set_')) {
        return `option_${nameWithoutExt}.${ext}`;
      }
      return `${nameWithoutExt}.${ext}`;
    } catch (e) {
      return null;
    }
  }

  // 1. option의 thumbnail 필드 우선 사용
  if (option && option.thumbnail) {
    const result = extractFilenameFromUrl(option.thumbnail);
    if (result) return result;
    return option.thumbnail;
  }

  // 2. option의 imageLink 필드 사용 (fallback)
  if (option && option.imageLink) {
    const result = extractFilenameFromUrl(option.imageLink);
    if (result) return result;
    return option.imageLink;
  }

  // 3. product의 mainImage 사용 (fallback)
  if (product && product.mainImage) {
    const result = extractFilenameFromUrl(product.mainImage);
    if (result) return result;
    return product.mainImage;
  }

  return '';
}

/**
 * 상세 이미지 파일명 가져오기
 * Python의 get_detail_image_filename() 함수와 동일한 로직
 */
function getDetailImageFilename(product, productIndex) {
  // 상품 순서 기반 파일명 (detail_1.png, detail_2.png, ...)
  return `detail_${productIndex + 1}.png`;
}

/**
 * 라벨 이미지 파일명 가져오기 (제품 필수 표시사항)
 * Python의 get_label_image_filename() 함수와 동일한 로직
 */
function getLabelImageFilename(product, productIndex) {
  // 상품 순서 기반 파일명 (1.jpg, 2.jpg, ...)
  return `${productIndex + 1}.jpg`;
}

/**
 * 이미지 대체 텍스트 생성
 * Python의 tmpl: 로직과 동일
 */
function getImageAltText(productTitle) {
  // 템플릿: "{product_name} 입니다 브랜드명은 %Brand_Name 입니다."
  return `${productTitle} 입니다 브랜드명은 %Brand_Name 입니다.`;
}

/**
 * 견적서 Excel 파일 자동 작성
 */
async function handleFillQuotationExcels(data) {
  try {
    console.log('\n========================================');
    console.log('📝 견적서 자동 작성 시작');
    console.log('========================================');
    console.log('📦 받은 데이터:');
    console.log('   - filesData:', data.filesData ? `${data.filesData.length}개` : 'undefined');
    console.log('   - products:', data.products ? `${data.products.length}개` : 'undefined');
    console.log('   - searchTags:', data.searchTags);
    console.log('   - size:', data.size);
    console.log('   - weight:', data.weight);
    console.log('   - downloadOnly:', data.downloadOnly);  // 🔥 다운로드만 모드 확인

    if (data.products && data.products.length > 0) {
      console.log('\n📦 첫 번째 상품 정보 샘플:');
      const firstProduct = data.products[0];
      console.log('   - title:', firstProduct.title);
      console.log('   - titleCn:', firstProduct.titleCn);
      console.log('   - results (옵션):', firstProduct.results ? `${firstProduct.results.length}개` : 'undefined');
      console.log('   - salePrice:', firstProduct.salePrice);
      console.log('   - basePrice:', firstProduct.basePrice);
      console.log('   - detailPageItems:', firstProduct.detailPageItems ? `${firstProduct.detailPageItems.length}개` : 'undefined');
    }
    console.log('========================================\n');

    // 진행 상황 업데이트 헬퍼 함수
    async function updateProgress(stepId, status) {
      try {
        const allTabs = await chrome.tabs.query({});
        const localhostTab = allTabs.find(tab =>
          tab.url && tab.url.includes('totalbot.cafe24.com')
        );

        if (localhostTab) {
          await chrome.tabs.sendMessage(localhostTab.id, {
            action: 'updateProgress',
            stepId: stepId,
            status: status
          });
        }
      } catch (error) {
        console.log('⚠️ 진행 상황 업데이트 실패:', error);
      }
    }

    // 1. 데이터 준비 단계 시작
    await updateProgress('prepare', 'in_progress');

    const { filesData, products, searchTags, size, weight, handlingCare, season, priceSettings, brandName, quotationMappings } = data;

    if (!filesData || filesData.length === 0) {
      throw new Error('Excel 파일 정보가 없습니다.');
    }

    if (!products || products.length === 0) {
      throw new Error('선택한 상품이 없습니다.');
    }

    // ⚠️ 편집되지 않은 제품 체크 (이미지 생성 전)
    console.log('🔍 상품 편집 상태 확인 중...');
    const uneditedProducts = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      // detailPageItems가 없거나 비어있으면 편집되지 않은 것
      if (!product.detailPageItems || product.detailPageItems.length === 0) {
        const productName = product.title || product.titleCn || `상품 ${i + 1}`;
        uneditedProducts.push(productName);
        console.log(`   ❌ 편집 안 됨: ${productName}`);
      } else {
        console.log(`   ✅ 편집 완료: ${(product.title || product.titleCn || `상품 ${i + 1}`).substring(0, 30)}...`);
      }
    }

    // 편집되지 않은 제품이 있으면 바로 에러 반환
    if (uneditedProducts.length > 0) {
      const errorMessage = `다음 상품들이 편집되지 않았습니다:\n\n${uneditedProducts.map((name, idx) => `${idx + 1}. ${name}`).join('\n')}\n\n먼저 "편집" 버튼을 눌러 각 상품의 상세페이지를 편집하고 저장해주세요.`;
      console.error('⚠️  편집되지 않은 제품 발견:', uneditedProducts);

      throw new Error(errorMessage);
    }

    console.log('✅ 모든 상품 편집 완료 확인');

    // 메시지에서 받은 값 또는 기본값 사용
    const finalQuotationMappings = quotationMappings && quotationMappings.length > 0
      ? quotationMappings
      : [
        { header: '색상/디자인', type: 'option1', value: '' },
        { header: '색상', type: 'option1', value: '' },
        { header: '사이즈', type: 'option2', value: '' },
        { header: '패션의류/잡화 사이즈', type: 'option2', value: '' },
        { header: '모델명/품번', type: 'modelName', value: '' },
        { header: '모델명', type: 'modelName', value: '' },
        { header: '제조국', type: 'fixed', value: '중국 OEM' }
      ];

    // 브랜드명 - 메시지에서 받은 값 사용
    const finalBrandName = brandName || '';
    console.log(`📌 브랜드명: ${finalBrandName || '(설정 안됨)'}`);

    console.log(`📊 Excel 파일 ${filesData.length}개, 상품 ${products.length}개`);
    console.log(`📋 매핑 설정 ${finalQuotationMappings.length}개 로드됨`);
    console.log('📋 매핑 상세:', JSON.stringify(finalQuotationMappings, null, 2));

    // 첫번째 상품의 옵션 구조 확인
    if (products.length > 0 && products[0].results && products[0].results.length > 0) {
      const firstOption = products[0].results[0];
      console.log('📦 첫번째 옵션 구조:', JSON.stringify(Object.keys(firstOption), null, 2));
      console.log('📦 첫번째 옵션 값:', JSON.stringify(firstOption, null, 2));
    }

    // 데이터 준비 완료
    await updateProgress('prepare', 'completed');

    // Excel 헤더 스캔하여 사이즈차트 이미지 필요 여부 확인
    let needsSizeChart = false;
    console.log('   🔍 Excel 헤더 스캔 중...');

    for (const fileInfo of filesData) {
      const excelData = excelDataStore[fileInfo.dataIndex];
      if (!excelData) continue;

      const workbook = XLSX.read(excelData.arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[1]; // 2번째 시트
      if (!sheetName) continue;

      const worksheet = workbook.Sheets[sheetName];

      // 5행 헤더만 빠르게 스캔
      for (let col = 0; col < 100; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 4, c: col }); // 5행 = index 4
        const cell = worksheet[cellAddress];
        if (cell && cell.v) {
          const headerName = String(cell.v).trim();
          if (headerName === '사이즈차트 이미지 파일명') {
            needsSizeChart = true;
            console.log(`   ✅ 사이즈차트 헤더 발견: ${fileInfo.filename}`);
            break;
          }
        }
      }
      if (needsSizeChart) break;
    }

    // 사이즈 차트 이미지 생성 (헤더에 있을 때만)
    globalSizeChartImages = []; // 초기화

    if (needsSizeChart) {
      console.log('   📐 사이즈 차트 이미지 생성 중...');

      try {
        const sizeChartResponse = await authFetch(`${SERVER_URL}/api/size-chart/generate-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: products.length })
        });

        const sizeChartResult = await sizeChartResponse.json();

        if (sizeChartResult.success && sizeChartResult.images) {
          for (let i = 0; i < sizeChartResult.images.length; i++) {
            const imgData = sizeChartResult.images[i];
            // Base64를 Blob으로 변환
            const binaryString = atob(imgData.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            const blob = new Blob([bytes], { type: 'image/png' });

            globalSizeChartImages.push({
              filename: imgData.filename,
              blob: blob,
              productIndex: i
            });

            console.log(`   ✅ 사이즈 차트: ${imgData.filename} (상품 ${i + 1})`);
          }
          console.log(`   📐 사이즈 차트 이미지 ${globalSizeChartImages.length}개 준비 완료`);
        } else {
          console.warn('   ⚠️ 사이즈 차트 생성 실패, 기본 파일명(A1.png) 사용');
        }
      } catch (sizeChartError) {
        console.error('   ❌ 사이즈 차트 생성 오류:', sizeChartError);
      }
    } else {
      console.log('   📐 사이즈차트 헤더 없음 - 이미지 생성 스킵');
    }

    // Excel 파일 작성 시작
    await updateProgress('fill', 'in_progress');

    // 각 Excel 파일 처리
    for (let i = 0; i < filesData.length; i++) {
      const fileInfo = filesData[i];
      const { dataIndex, filename, category } = fileInfo;

      const excelData = excelDataStore[dataIndex];

      if (!excelData) {
        console.error(`❌ Excel data not found for index ${dataIndex}`);
        continue;
      }

      const { arrayBuffer } = excelData;
      console.log(`\n📄 Processing: ${filename} (카테고리: ${category})`);

      // SheetJS로 Excel 읽기
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[1]; // 2번째 시트
      const worksheet = workbook.Sheets[sheetName];

      console.log(`   📊 Sheet: ${sheetName}`);

      // 5행에서 헤더 읽기 (중복 헤더도 모두 저장)
      const headers = {};  // 첫 번째 열만 저장 (기존 호환용)
      const headerAllColumns = {};  // 모든 열 저장 (중복 포함)
      const headerRequiredStatus = {};  // 임시로 필수 여부 저장
      for (let col = 1; col <= 100; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 4, c: col - 1 }); // 5행 = index 4
        const requiredCellAddress = XLSX.utils.encode_cell({ r: 5, c: col - 1 }); // 6행
        const cell = worksheet[cellAddress];
        const requiredCell = worksheet[requiredCellAddress];
        if (cell && cell.v) {
          const headerName = String(cell.v).trim().replace(/\n/g, ' ');
          const isRequired = requiredCell && String(requiredCell.v).trim() === '필수';

          // 모든 열 저장 (중복 포함)
          if (!headerAllColumns[headerName]) {
            headerAllColumns[headerName] = [];
          }
          headerAllColumns[headerName].push(col);

          // 같은 헤더가 이미 있는 경우
          if (headers[headerName]) {
            // 새로 발견한 열이 "필수"이고, 기존 열이 "필수"가 아니면 교체
            if (isRequired && !headerRequiredStatus[headerName]) {
              headers[headerName] = col;
              headerRequiredStatus[headerName] = true;
              console.log(`   🔄 중복 헤더 "${headerName}": 열 ${col}로 교체 (필수 우선)`);
            }
          } else {
            // 처음 발견한 헤더
            headers[headerName] = col;
            headerRequiredStatus[headerName] = isRequired;
          }
        }
      }

      console.log(`   📋 헤더 ${Object.keys(headers).length}개 발견`);
      console.log(`   주요 헤더:`, Object.keys(headers).slice(0, 10));

      // 중복 헤더 로깅
      const duplicateHeaders = Object.entries(headerAllColumns).filter(([name, cols]) => cols.length > 1);
      if (duplicateHeaders.length > 0) {
        console.log(`   ⚠️ 중복 헤더 ${duplicateHeaders.length}개:`);
        duplicateHeaders.forEach(([name, cols]) => {
          console.log(`      "${name}": 열 ${cols.join(', ')}`);
        });
      }

      // 디버그: 색상 헤더 매핑 확인
      if (headers['색상']) {
        console.log(`   🎨 색상 헤더 -> 열 ${headers['색상']}, 필수: ${headerRequiredStatus['색상']}, 전체열: ${headerAllColumns['색상'].join(', ')}`);
      }

      // 6행에서 필수/선택 읽기, 7행/8행에서 예시 값 읽기
      const requiredFields = {};  // 헤더명 기준 (기존 호환용)
      const requiredByColumn = {};  // 열 번호 기준 (정확한 체크용)
      const exampleValues = {};
      const exampleValuesRow7 = {};  // 7행 예시
      const exampleValuesRow8 = {};  // 8행 예시
      for (let col = 1; col <= 100; col++) {
        const headerCellAddress = XLSX.utils.encode_cell({ r: 4, c: col - 1 }); // 5행
        const requiredCellAddress = XLSX.utils.encode_cell({ r: 5, c: col - 1 }); // 6행
        const exampleCellAddress7 = XLSX.utils.encode_cell({ r: 6, c: col - 1 }); // 7행
        const exampleCellAddress8 = XLSX.utils.encode_cell({ r: 7, c: col - 1 }); // 8행

        const headerCell = worksheet[headerCellAddress];
        const requiredCell = worksheet[requiredCellAddress];
        const exampleCell7 = worksheet[exampleCellAddress7];
        const exampleCell8 = worksheet[exampleCellAddress8];

        if (headerCell && headerCell.v) {
          const headerName = String(headerCell.v).trim().replace(/\n/g, ' ');
          const requiredValue = requiredCell && requiredCell.v ? String(requiredCell.v).trim() : '';
          const exampleValue7 = exampleCell7 && exampleCell7.v ? String(exampleCell7.v).trim() : '';
          const exampleValue8 = exampleCell8 && exampleCell8.v ? String(exampleCell8.v).trim() : '';

          requiredFields[headerName] = requiredValue === '필수';
          // 열 번호로 실제 값 저장 ('필수', '조건부 필수', '선택' 등)
          requiredByColumn[col] = requiredValue;
          exampleValues[headerName] = exampleValue7;
          exampleValuesRow7[headerName] = exampleValue7;
          exampleValuesRow8[headerName] = exampleValue8;
        }
      }

      console.log(`   ⚠️  필수 칸 ${Object.values(requiredFields).filter(v => v).length}개 발견`);

      // 헤더명으로 열 찾기 - 정확히 일치하는 것을 우선
      function findColumnByHeader(headerName) {
        // 먼저 정확히 일치하는 것 찾기
        if (headers[headerName]) {
          return headers[headerName];
        }
        // 포함하는 것 찾기
        for (const [existingHeader, col] of Object.entries(headers)) {
          if (existingHeader.includes(headerName) || headerName.includes(existingHeader)) {
            return col;
          }
        }
        return null;
      }

      // 사용자 설정 매핑 + 자동 처리 특수 항목 (json_to_excel.py HEADER_RULES 전체 포팅)
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;
      const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
      const releaseYear = currentYear;
      const manufacturedStr = `${lastYear}년 ${currentMonth}월`;

      const autoMappings = [
        // 기본 매핑
        { header: '순번', type: 'calc:product_sequence', value: '' },
        { header: '상품순번', type: 'calc:product_sequence', value: '' },
        { header: '카테고리', type: 'fixed', value: '(선택한 카테고리)' },
        { header: '상품명', type: 'productName', value: '' },
        { header: '상품 바코드', type: 'fixed', value: '바코드 없음(쿠팡 바코드 생성 요청)' },
        { header: '모델명/품번', type: 'modelName', value: '' },
        { header: '모델명', type: 'modelName', value: '' },
        { header: '추가이미지 파일명', type: 'calc:additional_image', value: '' },
        { header: '과세여부', type: 'fixed', value: '과세' },
        { header: '거래타입', type: 'fixed', value: '기타 도소매업자' },
        { header: '수입여부', type: 'fixed', value: '수입상품' },
        { header: '박스 내 SKU 수량', type: 'fixed', value: '50' },
        { header: '유통기간 *식품의 경우 소비기간 (일수기재)', type: 'fixed', value: '0' },
        { header: '출시 연도', type: 'fixed', value: String(releaseYear) },
        { header: '계절', type: 'fixed', value: '@계절' },
        { header: '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입', type: 'fixed', value: '해당사항없음' },
        { header: '전기용품 및 생활용품, 어린이 (KC) 인증번호', type: 'fixed', value: '해당사항없음' },
        { header: '방송통신 기자재 (EMC) 인증 번호', type: 'fixed', value: '해당사항없음' },
        { header: '안전기준적합확인 신고번호', type: 'fixed', value: '해당사항없음' },
        { header: '이용조건, 이용기간', type: 'fixed', value: '해당사항 없음' },
        { header: '상품 제공 방식', type: 'fixed', value: '해당사항 없음' },
        { header: '최소 시스템 사양, 필수 소프트웨어', type: 'fixed', value: '해당사항 없음' },
        { header: '청약철회 또는 계약의 해제·해지에 따른 효과', type: 'fixed', value: '해당사항 없음' },
        { header: '소비자상담 관련 전화번호', type: 'fixed', value: '1577-7011' },
        { header: '소비자상담관련 전화번호', type: 'fixed', value: '1577-7011' },

        // 마커 포함 항목
        { header: '검색태그', type: 'fixed', value: '@Search_Tag' },
        { header: '브랜드', type: 'fixed', value: '%Brand_Name' },
        { header: '제조사', type: 'fixed', value: '%Brand_Name 협력사' },
        { header: '공급가', type: 'fixed', value: '(계산된 공급가)' },
        { header: '쿠팡 판매가', type: 'fixed', value: '(계산된 판매가)' },
        { header: '권장소비자가격', type: 'fixed', value: '(계산된 소비자가)' },
        { header: '취급주의 사유', type: 'fixed', value: '@유리OR해당사항없음' },
        { header: '한 개 단품 포장 무게', type: 'fixed', value: '@포장 무게' },
        { header: '한 개 단품 포장 사이즈', type: 'fixed', value: '@포장 사이즈' },
        { header: '제작자 또는 공급자', type: 'fixed', value: '%Brand_name 협력사' },
        { header: '치수', type: 'fixed', value: 'One Size' },
        { header: '냄비/프라이팬 사이즈', type: 'fixed', value: 'Free' },
        { header: 'KCS 인증번호', type: 'fixed', value: '해당사항없음' },

        // 추가 요청분
        { header: '구성품', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '재공급(리퍼브) 가구의 경우 재공급 사유 및 하자 부위의 관한 정보', type: 'fixed', value: '해당사항없음' },
        { header: '수입신고 문구 여부', type: 'fixed', value: '수입식품 안전관리 특별법에 따른 수입신고를 필함' },
        { header: '단 수', type: 'fixed', value: '3단' },
        { header: '동일모델 출시년월', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '적용차종', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: 'KC 인증정보(자동차관리법에 따른 자기인증 대상 자동차부품에 한함)', type: 'fixed', value: '해당사항 없음' },
        { header: '제품사용으로 인한 위험 및 유의사항(연료절감장치에 한함)', type: 'fixed', value: '해당사항 없음' },
        { header: '검사합격증 번호 (대기환경보전법에 따른 첨가제·촉매제에 한함)', type: 'fixed', value: '해당사항 없음' },
        { header: '종류', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '품명 및 모델명', type: 'productName', value: '' },
        { header: '품명', type: 'productName', value: '' },
        { header: '제품 소재', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '주요소재', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '주요 소재', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '주얼리 사이즈', type: 'fixed', value: 'onesize' },
        { header: '재공급(리퍼브) 가구의 경우 재공급 사유 및 하자 부위에 관한 정보', type: 'fixed', value: '해당사항 없음' },
        { header: '재질', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '테이블보 사이즈', type: 'fixed', value: 'M' },
        { header: '용량', type: 'fixed', value: '1L' },
        { header: '제품 구성', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '물질안전보건자료 (MSDS)', type: 'fixed', value: 'N (해당사항없음)' },
        { header: '배송/설치비용', type: 'fixed', value: '해당사항없음' },
        { header: '상품별 세부 사양', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: 'KC 인증정보', type: 'fixed', value: '해당사항없음' },
        { header: '소재', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '제품의 주소재(운동화인 경우에는 겉감,안감을 구분하여 표시)', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '크기, 중량', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '정격전압, 소비전력', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '에너지소비효율등급', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '크기,용량,형태', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '추가설치비용', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '행어 입고', type: 'fixed', value: 'N' },
        { header: '크기', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '제품구성', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '색상', type: 'option1', value: '' },
        { header: '세탁방법 및 취급시 주의사항', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '제조국', type: 'fixed', value: '중국 OEM' },
        { header: '제조국(원산지)', type: 'fixed', value: '중국 OEM' },
        { header: '제조연월', type: 'fixed', value: manufacturedStr },
        { header: '품질보증기준', type: 'fixed', value: '본 제품은 공정거래위원회 고시 분쟁 해결기준에 의거 교환 또는 보상 받으실 수 있습니다.' },
        { header: 'A/S 책임자와 전화번호', type: 'fixed', value: '1577-7011' },
        { header: '색상/디자인', type: 'option1', value: '' },
        { header: '취급시 주의사항', type: 'fixed', value: '14세 미만 어린이 사용 금지' },
        { header: '사용연령 또는 권장사용연령', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '크기∙체중의 한계', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '동일모델의 출시년월', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '취급방법 및 취급시 주의사항, 안전표시', type: 'fixed', value: '상세페이지 설명 참조' },
        { header: '사이즈', type: 'option2', value: '' },
        { header: '패션의류/잡화 사이즈', type: 'option2', value: '' },
        { header: '중량', type: 'fixed', value: '상세페이지 설명 참조' },

        // 신규 추가 항목
        { header: '모델명', type: 'modelName', value: '' },
        { header: '수량', type: 'fixed', value: '1개' },
        { header: '제조자(수입자)', type: 'fixed', value: '%Brand_Name' },
        { header: '내지매수', type: 'fixed', value: '1매' },
        { header: '사이즈차트 이미지 파일명', type: 'calc:size_chart_image', value: '' },
        { header: '인증/허가 사항', type: 'fixed', value: '해당사항없음' },
        { header: '개당 수량', type: 'fixed', value: '1개입' },
        { header: '출시년월', type: 'calc:release_month_last_year', value: '' },
        { header: '유통기간', type: 'fixed', value: '0' },

        // 패션 의류/잡화 관련 필드
        { header: '패션 의류/잡화 안감 종류', type: 'fixed', value: '기본' },
        { header: '의류/잡화 안감 종류', type: 'fixed', value: '기본' },
        { header: '상하의류 소재', type: 'fixed', value: '기타 합성 섬유' },
        { header: '세탁방법', type: 'fixed', value: '손세탁권장' },

        // 쿠팡 필수 필드
        { header: '고시명', type: 'fixed', value: '전자상거래 등에서의 상품 등의 정보제공에 관한 고시' }
      ];

      // 이미지 관련 필수 자동 처리 필드 (무조건 강제 적용)
      const forcedImageMappings = [
        { header: '대표이미지 파일명', type: 'calc:option_image', value: '' },
        { header: '상세이미지 파일명', type: 'calc:detail_image', value: '' },
        { header: '이미지 대체 텍스트', type: 'tmpl:image_alt', value: '' },
        { header: '제품 필수 표시사항 (라벨 또는 도안 이미지)', type: 'calc:label_image', value: '' },
        { header: '제품 한글 표시사항 실사컷', type: 'calc:label_image', value: '' }
      ];

      // 사용자 설정 + 자동 매핑 합치기
      const allMappings = [...finalQuotationMappings];

      // 일반 autoMappings 추가 (중복 제거)
      for (const autoMapping of autoMappings) {
        // 이미지 관련 필드는 제외 (나중에 강제로 추가)
        const isImageField = forcedImageMappings.some(f => f.header === autoMapping.header);
        if (isImageField) continue;

        // 같은 헤더가 사용자 설정에 없으면 추가
        if (!allMappings.find(m => m.header === autoMapping.header)) {
          allMappings.push(autoMapping);
        }
      }

      // 이미지 관련 필드는 무조건 강제로 추가/덮어쓰기
      for (const forcedMapping of forcedImageMappings) {
        // 기존에 같은 헤더가 있으면 제거
        const existingIndex = allMappings.findIndex(m => m.header === forcedMapping.header);
        if (existingIndex >= 0) {
          allMappings.splice(existingIndex, 1);
        }
        // 강제 매핑 추가
        allMappings.push(forcedMapping);
      }

      // 각 매핑에 대한 열 찾기
      const columnMappings = allMappings.map(mapping => ({
        ...mapping,
        column: findColumnByHeader(mapping.header)
      })).filter(m => m.column !== null);

      console.log(`   📍 매핑된 열 ${columnMappings.length}개:`,
        columnMappings.map(m => `${m.header}(${m.column})`).join(', '));

      // 색상 매핑 상세 디버그
      const colorMapping = columnMappings.find(m => m.header === '색상' || m.header.includes('색상'));
      if (colorMapping) {
        console.log(`   🎨 색상 매핑 상세: header="${colorMapping.header}", column=${colorMapping.column}, type=${colorMapping.type}`);
        console.log(`   🎨 색상 열 필수여부: requiredByColumn[${colorMapping.column}] = ${requiredByColumn[colorMapping.column]}`);
        // 모든 색상 열의 필수 여부 확인
        const allColorCols = headerAllColumns['색상'];
        if (allColorCols) {
          console.log(`   🎨 색상 전체 열 필수여부:`, allColorCols.map(c => `열${c}=${requiredByColumn[c]}`).join(', '));
        }
      } else {
        console.log(`   ⚠️ 색상 매핑이 columnMappings에 없음!`);
      }

      // 필수 칸 체크: 매핑되지 않은 필수 칸 찾기
      const missingRequiredFields = [];
      for (const [headerName, isRequired] of Object.entries(requiredFields)) {
        if (isRequired) {
          // 이 헤더가 allMappings에 있는지 확인
          const hasMapping = allMappings.some(m => {
            return m.header === headerName ||
                   headerName.includes(m.header) ||
                   m.header.includes(headerName);
          });

          if (!hasMapping) {
            missingRequiredFields.push({
              header: headerName,
              row7Value: exampleValuesRow7[headerName] || '',
              row8Value: exampleValuesRow8[headerName] || '',
              column: headers[headerName]
            });
          }
        }
      }

      // 필수 칸이 누락된 경우 모달로 사용자에게 입력받기
      if (missingRequiredFields.length > 0) {
        console.log(`   ⚠️ 매핑되지 않은 필수 칸 ${missingRequiredFields.length}개:`,
          missingRequiredFields.map(f => f.header).join(', '));

        // totalbot.cafe24.com 탭 찾기
        const allTabs = await chrome.tabs.query({});
        const totalbotTab = allTabs.find(tab => tab.url && tab.url.includes('totalbot.cafe24.com'));

        if (totalbotTab) {
          console.log('   📋 필수 칸 입력 모달 요청 중...');

          try {
            // Content script로 모달 표시 요청
            const userResponse = await chrome.tabs.sendMessage(totalbotTab.id, {
              action: 'showRequiredFieldModal',
              fields: missingRequiredFields
            });

            if (userResponse && userResponse.cancelled) {
              console.log('   ❌ 사용자가 취소함');
              return { success: false, error: '사용자가 견적서 작성을 취소했습니다.' };
            }

            if (userResponse && userResponse.mappings) {
              console.log('   ✅ 사용자 입력 수신:', userResponse.mappings.length, '개');

              // 사용자가 입력한 매핑을 allMappings에 추가
              for (const newMapping of userResponse.mappings) {
                allMappings.push(newMapping);

                // 서버 API로 설정 저장 (유저별 분리)
                try {
                  const response = await authFetch(`${SERVER_URL}/api/settings/quotation-mappings`, {
                    method: 'POST',
                    body: JSON.stringify({ mapping: newMapping })
                  });
                  const result = await response.json();
                  if (result.success) {
                    console.log(`      💾 서버에 저장됨: ${newMapping.header} = ${newMapping.type === 'fixed' ? newMapping.value : newMapping.type}`);
                  } else {
                    console.error(`      ❌ 서버 저장 실패:`, result.message);
                  }
                } catch (saveError) {
                  console.error(`      ❌ 서버 저장 오류:`, saveError);
                }
              }

              // columnMappings 다시 계산
              const newColumnMappings = userResponse.mappings.map(mapping => ({
                ...mapping,
                column: findColumnByHeader(mapping.header)
              })).filter(m => m.column !== null);

              // 기존 columnMappings에 추가
              columnMappings.push(...newColumnMappings);
            }
          } catch (modalError) {
            console.error('   ❌ 모달 표시 오류:', modalError);
            // 오류가 나도 계속 진행 (기본값 사용)
          }
        } else {
          console.log('   ⚠️ TotalBot 탭을 찾을 수 없어 모달 표시 불가');
        }
      }

      // 9행부터 데이터 작성
      let currentRow = 9;
      let totalCellsWritten = 0;

      // 셀 업데이트 수집 (서버로 전송할 데이터)
      const cellUpdates = [];

      // ⚠️ 디버깅: 컨텍스트 데이터 확인
      console.log('🔍 컨텍스트 데이터 확인:');
      console.log(`   - searchTags: ${searchTags} (타입: ${typeof searchTags}, 배열: ${Array.isArray(searchTags)})`);
      console.log(`   - weight: ${weight} (타입: ${typeof weight})`);
      console.log(`   - size: ${JSON.stringify(size)} (타입: ${typeof size})`);
      console.log(`   - category: ${category}`);
      console.log(`   - products.length: ${products.length}`);

      for (let productIndex = 0; productIndex < products.length; productIndex++) {
        const product = products[productIndex];
        const productTitle = product.title || product.titleCn || '제목 없음';
        const options = product.results || [];

        console.log(`\n📦 상품 ${productIndex + 1}: ${productTitle.substring(0, 50)}...`);
        console.log(`   옵션 개수: ${options.length}`);

        if (options.length === 0) {
          // 옵션이 없는 경우
          const price = product.salePrice || product.basePrice || 0;
          let cellsWrittenThisRow = 0;

          // 각 매핑에 대해 값 작성
          for (const mapping of columnMappings) {
            const value = getValueForMapping(mapping, {
              category,
              productTitle,
              option1: '',
              option2: '',
              searchTags: searchTags ? (Array.isArray(searchTags) ? searchTags.join(', ') : String(searchTags)) : '',
              weight: weight || '',
              size: size ? `${size.width}*${size.height}*${size.depth}` : '',
              price,
              product,
              option: null,
              productIndex,
              totalProducts: products.length,
              brandName: finalBrandName,
              handlingCare: handlingCare || '해당사항없음',
              season: season || '사계절',
              requiredFields,
              priceSettings
            });

            // "필수"와 "조건부 필수"만 채우기, 나머지는 스킵
            const fieldType = requiredByColumn[mapping.column] || '';
            const shouldFill = fieldType === '필수' || fieldType.includes('조건부');
            if (!shouldFill) {
              continue;
            }

            if (value !== null && value !== undefined) {
              // 셀 업데이트 수집 (서버로 전송)
              cellUpdates.push({
                sheet: 1, // 2번째 시트 (0-indexed)
                row: currentRow,
                col: mapping.column,
                value: value
              });
              cellsWrittenThisRow++;
              totalCellsWritten++;

              // 중복 헤더가 있으면 다른 열에도 같은 값 작성 (필수/조건부 필수만)
              const allCols = headerAllColumns[mapping.header];
              if (allCols && allCols.length > 1) {
                for (const extraCol of allCols) {
                  // 중복 열도 필수/조건부 필수만 채우기
                  const extraFieldType = requiredByColumn[extraCol] || '';
                  const extraShouldFill = extraFieldType === '필수' || extraFieldType.includes('조건부');
                  if (extraCol !== mapping.column && extraShouldFill) {
                    cellUpdates.push({
                      sheet: 1,
                      row: currentRow,
                      col: extraCol,
                      value: value
                    });
                    cellsWrittenThisRow++;
                    totalCellsWritten++;
                    console.log(`      📝 중복 열 작성: ${mapping.header} -> 열 ${extraCol}`);
                  }
                }
              }

              // 처음 5개 값만 로깅 (너무 많은 로그 방지)
              if (cellsWrittenThisRow <= 5) {
                console.log(`      ✏️ ${mapping.header} (열 ${mapping.column}): "${value}" (타입: ${mapping.type})`);
              }
            } else {
              // 값이 null/undefined인 경우 로깅
              if (columnMappings.indexOf(mapping) < 5) {
                console.log(`      ⚠️ ${mapping.header} (열 ${mapping.column}): null/undefined (타입: ${mapping.type})`);
              }
            }
          }

          console.log(`   ✅ Row ${currentRow}: ${cellsWrittenThisRow}개 셀 수집됨 (${productTitle})`);
          currentRow++;
        } else {
          // 각 옵션마다 한 줄씩
          for (let optIdx = 0; optIdx < options.length; optIdx++) {
            const option = options[optIdx];
            const opt1 = option.optionName1 || option.optionName1Cn || '';
            const opt2 = option.optionName2 || option.optionName2Cn || '';
            const price = option.price || 0;
            let cellsWrittenThisRow = 0;

            // 첫 번째 옵션만 디버그 로그
            if (optIdx === 0) {
              console.log(`   🔍 옵션 디버그: opt1="${opt1}", opt2="${opt2}"`);
              console.log(`   🔍 옵션 필드들:`, Object.keys(option).join(', '));
            }

            // 각 매핑에 대해 값 작성
            for (const mapping of columnMappings) {
              const value = getValueForMapping(mapping, {
                category,
                productTitle,
                option1: opt1,
                option2: opt2,
                searchTags: searchTags ? (Array.isArray(searchTags) ? searchTags.join(', ') : String(searchTags)) : '',
                weight: weight || '',
                size: size ? `${size.width}*${size.height}*${size.depth}` : '',
                price,
                product,
                option,
                productIndex,
                totalProducts: products.length,
                brandName: finalBrandName,
                handlingCare: handlingCare || '해당사항없음',
                season: season || '사계절',
                requiredFields,
                priceSettings
              });

              // 색상 매핑 디버그 (첫 옵션만)
              if (optIdx === 0 && (mapping.header === '색상' || mapping.header.includes('색상'))) {
                console.log(`   🎨 색상 처리: header="${mapping.header}", column=${mapping.column}, value="${value}", isRequired=${requiredByColumn[mapping.column]}`);
              }

              // "필수"와 "조건부 필수"만 채우기, 나머지는 스킵
              const fieldType = requiredByColumn[mapping.column] || '';
              const shouldFill = fieldType === '필수' || fieldType.includes('조건부');
              if (!shouldFill) {
                continue;
              }

              if (value !== null && value !== undefined) {
                // 셀 업데이트 수집 (서버로 전송)
                cellUpdates.push({
                  sheet: 1, // 2번째 시트 (0-indexed)
                  row: currentRow,
                  col: mapping.column,
                  value: value
                });
                cellsWrittenThisRow++;
                totalCellsWritten++;

                // 중복 헤더가 있으면 다른 열에도 같은 값 작성 (필수/조건부 필수만)
                const allCols = headerAllColumns[mapping.header];
                if (optIdx === 0 && mapping.header.includes('색상')) {
                  console.log(`      🔍 색상 중복 체크: header="${mapping.header}", allCols=${JSON.stringify(allCols)}`);
                }
                if (allCols && allCols.length > 1) {
                  for (const extraCol of allCols) {
                    // 중복 열도 필수/조건부 필수만 채우기
                    const extraFieldType = requiredByColumn[extraCol] || '';
                    const extraShouldFill = extraFieldType === '필수' || extraFieldType.includes('조건부');
                    if (extraCol !== mapping.column && extraShouldFill) {
                      cellUpdates.push({
                        sheet: 1,
                        row: currentRow,
                        col: extraCol,
                        value: value
                      });
                      cellsWrittenThisRow++;
                      totalCellsWritten++;
                      if (optIdx === 0) {
                        console.log(`      📝 중복 열 작성: ${mapping.header} -> 열 ${extraCol}`);
                      }
                    }
                  }
                }
              }
            }

            console.log(`   ✅ Row ${currentRow}: ${cellsWrittenThisRow}개 셀 수집됨 (${opt1} | ${opt2} | ${price}원)`);
            currentRow++;
          }
        }
      }

      console.log(`\n   📊 총 ${currentRow - 9}개 행 추가됨`);
      console.log(`   📊 총 ${totalCellsWritten}개 셀 수집됨`);
      console.log(`   📊 cellUpdates 배열: ${cellUpdates.length}개`);

      // 서버 API로 Excel 파일 편집 요청 (서식 보존)
      console.log(`\n📝 서버 API로 Excel 편집 요청...`);

      // FormData 생성
      const formData = new FormData();
      const blob = new Blob([arrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      formData.append('file', blob, filename);
      formData.append('cellUpdates', JSON.stringify(cellUpdates));

      console.log(`   📤 파일 업로드: ${filename} (${arrayBuffer.byteLength} bytes)`);
      console.log(`   📤 셀 업데이트: ${cellUpdates.length}개`);

      // 서버 API 호출
      const response = await authFetch(`${SERVER_URL}/api/quote/edit-excel`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`서버 오류: ${response.status} - ${errorText}`);
      }

      // 수정된 파일 받기
      const editedArrayBuffer = await response.arrayBuffer();
      console.log(`   ✅ 서버에서 수정된 파일 수신: ${editedArrayBuffer.byteLength} bytes`);

      // ⚠️ 파일 크기 검증
      if (editedArrayBuffer.byteLength < 5000) {
        console.warn(`   ⚠️ 경고: Excel 파일이 너무 작습니다 (${editedArrayBuffer.byteLength} bytes). 데이터가 제대로 작성되지 않았을 수 있습니다!`);
      }

      // Base64 Data URL로 변환
      let binaryString = '';
      const bytes = new Uint8Array(editedArrayBuffer);
      for (let j = 0; j < bytes.length; j++) {
        binaryString += String.fromCharCode(bytes[j]);
      }
      const base64 = btoa(binaryString);
      const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
      console.log(`   ✅ Base64 변환 완료: ${base64.length} characters`);

      // 원본 파일명으로 덮어쓰기
      const downloadFilename = filename;

      console.log(`   💾 다운로드 시작: TotalBot/${downloadFilename}`);
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: `TotalBot/${downloadFilename}`,
        saveAs: false,
        conflictAction: 'overwrite'  // 기존 파일 덮어쓰기
      });

      // downloadId를 fileInfo에 저장 (나중에 쿠팡 업로드에서 사용)
      fileInfo.downloadId = downloadId;

      console.log(`   ✅ 파일 덮어쓰기 완료: ${downloadFilename} (Download ID: ${downloadId})`);
      console.log(`   📌 fileInfo.downloadId 저장됨:`, fileInfo.downloadId);

      // ⚠️ CRITICAL: excelDataStore 업데이트 (쿠팡 업로드시 사용)
      excelDataStore[dataIndex].arrayBuffer = editedArrayBuffer;
      console.log(`   ✅ excelDataStore[${dataIndex}] 업데이트됨 (${editedArrayBuffer.byteLength} bytes)`);

      // ⚠️ 다운로드 완료 대기 및 검증
      await new Promise((resolve) => setTimeout(resolve, 500));
      const downloadItem = await chrome.downloads.search({ id: downloadId });
      if (downloadItem && downloadItem[0]) {
        console.log(`   📊 다운로드 상태: ${downloadItem[0].state}`);
        console.log(`   📊 파일 크기: ${downloadItem[0].fileSize || 'unknown'} bytes`);
        if (downloadItem[0].fileSize && downloadItem[0].fileSize < 5000) {
          console.error(`   ❌ 치명적 오류: 다운로드된 파일이 너무 작습니다! 데이터가 작성되지 않았습니다.`);
        }
      }
    }

    // Excel 파일 작성 완료
    await updateProgress('fill', 'completed');

    // 이미지 생성 단계 시작
    await updateProgress('images', 'in_progress');

    // 이미지 파일 수집 (개별 파일로 분류)
    console.log('\n📸 이미지 파일 수집 시작 (개별 파일)...');

    // 첫 번째 파일명에서 견적서 이름 추출 (확장자 제거)
    const quotationName = filesData[0].filename.replace(/\.xlsx?$/i, '');

    console.log(`   📦 견적서 이름: ${quotationName}`);

    // 이미지 수집을 위한 배열 (ZIP 없이 개별 파일로 처리)
    const productImageBlobs = []; // Input #2: 상품 이미지 (detail, additional, option)
    const labelImageBlobs = [];   // Input #3: 라벨컷 이미지만

    // 상세페이지 & 라벨컷 이미지 생성 (서버 API 호출)
    console.log('   🖼️  상세페이지 & 라벨컷 이미지 생성 중...');

    // 상품 데이터를 명시적으로 복사 (detailHtml 포함)
    const cleanProducts = products.map(p => ({
      id: p.id,
      title: p.title,
      titleCn: p.titleCn,
      description: p.description,
      mainImage: p.mainImage,
      images: p.images,
      results: p.results,
      detailHtml: p.detailHtml  // 명시적으로 포함
    }));

    // 디버깅: 복사된 데이터 확인
    console.log('   📦 전송할 Products 데이터 확인:');
    for (let i = 0; i < cleanProducts.length; i++) {
      const p = cleanProducts[i];
      console.log(`      [${i + 1}] ${(p.title || p.titleCn || '').substring(0, 30)}`);
      console.log(`          - Has detailHtml: ${!!p.detailHtml}`);
      console.log(`          - detailHtml length: ${p.detailHtml?.length || 0}`);
      console.log(`          - results: ${p.results?.length || 0}, images: ${p.images?.length || 0}`);
    }

    try {
      const response = await authFetch(`${SERVER_URL}/api/products/generate-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ products: cleanProducts })
      });

      const result = await response.json();

      if (result.success && result.images) {
        // 상세페이지 & 라벨컷 이미지를 각각 배열에 추가
        for (const imgData of result.images) {
          const productIndex = imgData.productIndex;

          // 상세페이지 이미지 (detail_1.png, detail_2.png, ...) -> 상품 이미지
          const detailBlob = await fetch(imgData.detailImage).then(r => r.blob());
          productImageBlobs.push({
            filename: `detail_${productIndex + 1}.png`,
            blob: detailBlob
          });

          // 라벨컷 이미지 (1.jpg, 2.jpg, ...) -> 라벨컷 이미지
          const labelBlob = await fetch(imgData.labelImage).then(r => r.blob());
          labelImageBlobs.push({
            filename: getLabelImageFilename(products[productIndex], productIndex),
            blob: labelBlob
          });

          console.log(`   ✅ 상세페이지 & 라벨컷 생성: ${productIndex + 1}/${products.length}`);
        }
      } else {
        // 서버에서 에러 반환 (예: 편집되지 않은 제품이 있는 경우)
        console.error('   ⚠️  상세페이지/라벨컷 생성 실패:', result.message || 'Unknown error');

        // 에러 메시지 구성
        let errorMessage = result.message || '상세페이지 생성에 실패했습니다.';
        if (result.uneditedProducts && result.uneditedProducts.length > 0) {
          errorMessage = `다음 상품들이 편집되지 않았습니다:\n\n${result.uneditedProducts.map((name, idx) => `${idx + 1}. ${name}`).join('\n')}\n\n먼저 "편집" 버튼을 눌러 각 상품의 상세페이지를 편집하고 저장해주세요.`;
        }

        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('   ⚠️  상세페이지/라벨컷 생성 실패:', error.message);
      await updateProgress('images', 'error');
      throw error; // 에러를 다시 던져서 상위에서 처리할 수 있도록
    }

    // 이미지 생성 완료
    await updateProgress('images', 'completed');

    // 다운로드할 이미지 목록 수집 (모두 상품 이미지)
    const imagesToDownload = [];

    for (let productIndex = 0; productIndex < products.length; productIndex++) {
      const product = products[productIndex];
      const options = product.results || [];

      // 1. 추가 이미지들 (images 배열) - 선택된 추가 이미지만
      if (product.images && Array.isArray(product.images)) {
        // 선택된 이미지 인덱스 Set (없으면 전체 선택)
        const selectedSet = product.selectedAdditionalImages
          ? new Set(product.selectedAdditionalImages)
          : new Set(product.images.map((_, idx) => idx));

        product.images.forEach((imgUrl, imgIndex) => {
          // 선택된 이미지만 업로드
          if (imgUrl && selectedSet.has(imgIndex)) {
            // 확장자 추출 (기본은 png)
            let ext = 'png';
            if (imgUrl) {
              const urlMatch = imgUrl.match(/\.([a-zA-Z]+)(?:\?|$)/);
              if (urlMatch) {
                ext = urlMatch[1].toLowerCase();
                if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                  ext = 'png';
                }
              }
            }
            imagesToDownload.push({
              url: imgUrl,
              filename: `additional_${productIndex + 1}_${imgIndex + 1}.${ext}`,
              type: 'additional',
              productIndex
            });
          }
        });
      }

      // 2. 옵션 이미지들 (대표이미지 파일명으로 사용됨)
      console.log(`   🔍 제품 ${productIndex + 1}: 옵션 이미지 수집 시작 (${options.length}개 옵션)`);
      options.forEach((option, optIndex) => {
        // 옵션 이미지 URL 찾기 (fallback: 메인이미지, 첫 추가이미지)
        let optionImageUrl = option.thumbnail || option.imageLink || option.option1Img;

        // fallback: 옵션 이미지가 없으면 메인이미지 또는 첫 추가이미지 사용
        if (!optionImageUrl) {
          optionImageUrl = product.mainImage || (product.images && product.images[0]);
          if (optionImageUrl) {
            console.log(`      ℹ️ 옵션 ${optIndex + 1}: 옵션 이미지 없음, 메인/추가 이미지로 대체`);
          }
        }

        // 디버그: 첫 옵션이거나 제품3인 경우 상세 로그
        if (optIndex === 0 || productIndex === 2) {
          console.log(`      옵션 ${optIndex + 1}: thumbnail=${option.thumbnail ? 'Y' : 'N'}, imageLink=${option.imageLink ? 'Y' : 'N'}, option1Img=${option.option1Img ? 'Y' : 'N'}`);
          console.log(`      -> optionImageUrl: ${optionImageUrl ? optionImageUrl.substring(0, 60) + '...' : 'NULL'}`);
        }

        if (optionImageUrl) {
          // fallback URL인 경우 직접 파일명 추출, 아니면 기존 함수 사용
          let optionFilename;
          const isFallbackUrl = optionImageUrl === product.mainImage ||
                                (product.images && optionImageUrl === product.images[0]);

          if (isFallbackUrl) {
            // mainImage나 images[0]에서 직접 파일명 추출
            try {
              const url = new URL(optionImageUrl);
              const pathname = url.pathname;
              const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
              const extMatch = filename.match(/\.([a-zA-Z]+)$/);
              const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
              const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
              optionFilename = `option_${nameWithoutExt}.${ext}`;
            } catch (e) {
              optionFilename = `option_fallback_p${productIndex + 1}.png`;
            }
          } else {
            optionFilename = getOptionImageFilename(option, product, productIndex);
          }

          if (optionFilename) {
            // 여러 상품이 있을 때 파일명 충돌 방지를 위해 productIndex 추가
            if (products.length > 1) {
              // 파일명에서 확장자 분리
              const extMatch = optionFilename.match(/\.([a-zA-Z]+)$/);
              const ext = extMatch ? extMatch[1] : 'png';
              const nameWithoutExt = optionFilename.replace(/\.[a-zA-Z]+$/, '');
              optionFilename = `${nameWithoutExt}_p${productIndex + 1}.${ext}`;
            }
            console.log(`      ✅ 다운로드 목록에 추가: ${optionFilename}${isFallbackUrl ? ' (메인이미지 대체)' : ''}`);
            imagesToDownload.push({
              url: optionImageUrl,
              filename: optionFilename,
              type: 'option',
              productIndex,
              optionIndex: optIndex
            });
          } else {
            console.warn(`      ⚠️ 파일명 생성 실패: 옵션 ${optIndex + 1}`);
          }
        } else {
          console.warn(`      ⚠️ 이미지 URL 없음: 옵션 ${optIndex + 1}`);
        }
      });
    }

    // URL 기반 중복 제거 (같은 URL은 한 번만 다운로드)
    const urlToFilename = new Map();
    const deduplicatedImages = [];

    for (const imgInfo of imagesToDownload) {
      if (!urlToFilename.has(imgInfo.url)) {
        urlToFilename.set(imgInfo.url, imgInfo.filename);
        deduplicatedImages.push(imgInfo);
      } else {
        // 이미 다운로드할 URL이면 건너뛰기 (파일명만 기록)
        console.log(`   🔄 중복 URL 건너뜀: ${imgInfo.filename} (원본: ${urlToFilename.get(imgInfo.url)})`);
      }
    }

    console.log(`   📥 총 ${deduplicatedImages.length}개 상품 이미지 수집 중... (중복 제거: ${imagesToDownload.length - deduplicatedImages.length}개)`);

    // 이미지 다운로드 및 productImageBlobs에 추가 (병렬 처리, 최대 5개씩)
    const imagesToDownload2 = deduplicatedImages; // 중복 제거된 목록 사용
    let successCount = 0;
    let failCount = 0;
    const batchSize = 5;

    for (let i = 0; i < imagesToDownload2.length; i += batchSize) {
      const batch = imagesToDownload2.slice(i, i + batchSize);
      const batchPromises = batch.map(async (imgInfo) => {
        try {
          // 이미지 fetch
          console.log(`   📥 다운로드 시도: ${imgInfo.filename} <- ${imgInfo.url.substring(0, 80)}...`);
          const response = await fetch(imgInfo.url);
          if (!response.ok) {
            console.warn(`   ⚠️  Failed to fetch (${response.status}): ${imgInfo.filename}`);
            console.warn(`      URL: ${imgInfo.url}`);
            return { success: false, filename: imgInfo.filename, url: imgInfo.url, status: response.status };
          }

          const blob = await response.blob();

          // productImageBlobs 배열에 추가
          productImageBlobs.push({
            filename: imgInfo.filename,
            blob: blob
          });

          console.log(`   ✅ 상품 이미지 추가: ${imgInfo.filename}`);
          return { success: true, filename: imgInfo.filename };
        } catch (error) {
          console.error(`   ❌ Download error for ${imgInfo.filename}:`, error.message);
          return { success: false, filename: imgInfo.filename, error: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      successCount += batchResults.filter(r => r.success).length;
      failCount += batchResults.filter(r => !r.success).length;

      // 진행 상황 표시
      console.log(`   📊 진행: ${Math.min(i + batchSize, imagesToDownload.length)}/${imagesToDownload.length}`);
    }

    console.log(`\n✅ 상품 이미지 수집 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
    console.log(`📊 상품 이미지: ${productImageBlobs.length}개, 라벨컷 이미지: ${labelImageBlobs.length}개`);

    // 사이즈 차트 이미지를 productImageBlobs에도 추가 (ZIP에 포함되도록)
    if (globalSizeChartImages && globalSizeChartImages.length > 0) {
      for (const sizeChart of globalSizeChartImages) {
        productImageBlobs.push({
          filename: sizeChart.filename,
          blob: sizeChart.blob
        });
      }
      console.log(`📊 사이즈 차트 이미지 ${globalSizeChartImages.length}개 ZIP에 추가됨`);
    }

    console.log('\n✅ 견적서 자동 작성 완료');

    // Excel Blob 데이터 수집 (서버에서 편집된 파일 그대로 사용 - 서식 보존)
    console.log('📋 Excel 파일 Blob 수집 중...');

    const excelBlobs = [];
    for (const fileInfo of filesData) {
      const { dataIndex, filename } = fileInfo;
      const excelData = excelDataStore[dataIndex];

      if (excelData) {
        // ✅ SheetJS 없이 arrayBuffer를 직접 Blob으로 변환 (서식 보존)
        const blob = new Blob([excelData.arrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        excelBlobs.push({
          blob: blob,
          filename: filename
        });
        console.log(`   ✅ Excel Blob 준비: ${filename} (${excelData.arrayBuffer.byteLength} bytes, 서식 보존)`);
      }
    }

    console.log(`📋 Excel 파일 ${excelBlobs.length}개 준비됨`);
    console.log(`📊 상품 이미지: ${productImageBlobs.length}개, 라벨컷 이미지: ${labelImageBlobs.length}개`);

    // ⚡ downloadOnly 모드인 경우 쿠팡 업로드 건너뛰고 ZIP으로 다운로드
    console.log('🔍 downloadOnly 체크:', data.downloadOnly, '타입:', typeof data.downloadOnly);
    if (data.downloadOnly === true) {
      console.log('📥 downloadOnly 모드: 쿠팡 탭 열지 않고 ZIP 파일로 다운로드');

      // ZIP 파일 생성
      const zip = new JSZip();

      // 카테고리명 추출 (파일명에서 날짜 부분 제거)
      const firstFilename = filesData[0]?.filename || 'quotation';
      const categoryName = firstFilename.replace(/_\d{8}_\d{4}\.xlsx?$/i, '').replace(/\.xlsx?$/i, '');

      // 현재 날짜시간 (년월일시분)
      const now = new Date();
      const dateStr = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0');

      const zipFilename = `${categoryName} ${dateStr}.zip`;
      console.log(`   📦 ZIP 파일명: ${zipFilename}`);

      let fileCount = 0;

      // Excel 파일 추가
      for (const item of excelBlobs) {
        zip.file(item.filename, item.blob);
        fileCount++;
        console.log(`   📄 Excel 추가: ${item.filename}`);
      }

      // 상품 이미지 추가 (images 폴더에)
      for (const item of productImageBlobs) {
        zip.file(`images/${item.filename}`, item.blob);
        fileCount++;
      }
      console.log(`   🖼️ 상품 이미지 ${productImageBlobs.length}개 추가`);

      // 라벨 이미지 추가 (labels 폴더에)
      for (const item of labelImageBlobs) {
        zip.file(`labels/${item.filename}`, item.blob);
        fileCount++;
      }
      console.log(`   🏷️ 라벨 이미지 ${labelImageBlobs.length}개 추가`);

      // ZIP 생성 및 다운로드
      console.log(`   🔧 ZIP 파일 생성 중... (총 ${fileCount}개 파일)`);
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Blob을 Data URL로 변환
      const zipDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(zipBlob);
      });

      // ZIP 파일 다운로드
      await chrome.downloads.download({
        url: zipDataUrl,
        filename: `TotalBot/${zipFilename}`,
        saveAs: false
      });

      console.log(`\n✅ ZIP 파일 다운로드 완료: ${zipFilename} (${fileCount}개 파일 포함)`);

      return {
        success: true,
        downloadOnly: true,
        count: excelBlobs.length,
        imageCount: productImageBlobs.length + labelImageBlobs.length
      };
    }

    // ======================================
    // 🚀 쿠팡 자동 업로드 시작
    // ======================================
    console.log('\n🚀 쿠팡 자동 업로드 시작...');

    try {
      // 1. 쿠팡 등록 페이지 열기 (또는 기존 탭 재사용)
      await updateProgress('open', 'in_progress');

      const coupangRegistrationUrl = 'https://supplier.coupang.com/qvt/registration';

      let coupangTabId = null;

      // 기존 쿠팡 탭 검색
      const allTabs = await chrome.tabs.query({});
      const existingCoupangTab = allTabs.find(tab =>
        tab.url && tab.url.includes('supplier.coupang.com')
      );

      if (existingCoupangTab) {
        console.log('✅ 기존 쿠팡 탭 재사용:', existingCoupangTab.id);
        coupangTabId = existingCoupangTab.id;

        // 탭을 등록 페이지로 이동
        await chrome.tabs.update(coupangTabId, {
          url: coupangRegistrationUrl,
          active: true
        });
      } else {
        console.log('🌐 새 쿠팡 탭 생성');
        const newTab = await chrome.tabs.create({
          url: coupangRegistrationUrl,
          active: true
        });
        coupangTabId = newTab.id;
      }

      // 2. 탭 로딩 완료 대기
      console.log('⏳ 쿠팡 페이지 로딩 대기 중...');
      await waitForTabLoad(coupangTabId);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 추가 2초 대기

      await updateProgress('open', 'completed');

      // 4. 상품 이미지 Blob을 Base64로 변환
      console.log('🖼️ 상품 이미지 Base64 변환 중...');
      const productImagesData = await Promise.all(
        productImageBlobs.map(async (item) => ({
          filename: item.filename,
          base64: await blobToBase64(item.blob)
        }))
      );
      console.log(`   ✅ 상품 이미지 ${productImagesData.length}개 변환 완료`);

      // 5. 라벨컷 이미지 Blob을 Base64로 변환
      console.log('🖼️ 라벨컷 이미지 Base64 변환 중...');
      const labelImagesData = await Promise.all(
        labelImageBlobs.map(async (item) => ({
          filename: item.filename,
          base64: await blobToBase64(item.blob)
        }))
      );
      console.log(`   ✅ 라벨컷 이미지 ${labelImagesData.length}개 변환 완료`);

      // 6. Excel Blob들을 Base64로 변환
      console.log('📋 Excel 파일 Base64 변환 중...');
      const excelFilesData = await Promise.all(
        excelBlobs.map(async (item) => ({
          filename: item.filename,
          base64: await blobToBase64(item.blob)
        }))
      );

      // 7. Content script 강제 inject (확실한 로딩을 위해)
      console.log('💉 Content script 강제 inject 중...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: coupangTabId },
          files: ['content/coupang-uploader.js']
        });
        console.log('✅ Content script inject 완료');
        console.log('⏳ Content script 초기화 대기 중 (3초)...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // 초기화 대기 (1초 → 3초로 증가)
        console.log('✅ 대기 완료');
      } catch (injectError) {
        console.log('⚠️ Content script inject 실패 (이미 로드되어 있을 수 있음):', injectError.message);
      }

      // 8. Content script로 업로드 데이터 전송
      await updateProgress('upload', 'in_progress');
      isUploadInProgress = true;  // 업로드 중 탭 새로고침 방지
      console.log('🚫 업로드 시작 - 탭 새로고침 비활성화');
      console.log('📤 Content script로 업로드 요청 전송...');

      // products에서 base64 이미지 데이터 제거 (메시지 크기 제한 회피)
      const productsLite = products.map(p => {
        const lite = { ...p };
        // base64 데이터가 포함된 필드 제거 (이미지는 productImagesData로 별도 전송됨)
        if (lite.mainImage && lite.mainImage.startsWith('data:')) {
          lite.mainImage = '[base64-removed]';
        }
        if (lite.images) {
          lite.images = lite.images.map(img =>
            img && img.startsWith('data:') ? '[base64-removed]' : img
          );
        }
        if (lite.results) {
          lite.results = lite.results.map(r => {
            const rLite = { ...r };
            if (rLite.imageLink && rLite.imageLink.startsWith('data:')) {
              rLite.imageLink = '[base64-removed]';
            }
            if (rLite.titleImage) {
              rLite.titleImage = rLite.titleImage.map(img =>
                img && img.startsWith('data:') ? '[base64-removed]' : img
              );
            }
            return rLite;
          });
        }
        // detailPageHtml도 매우 클 수 있으므로 제거
        if (lite.detailPageHtml && lite.detailPageHtml.length > 100000) {
          lite.detailPageHtml = '[large-html-removed]';
        }
        return lite;
      });

      const uploadData = {
        excelFiles: excelFilesData,
        productImages: productImagesData,  // Input #2: 상품 이미지
        labelImages: labelImagesData,      // Input #3: 라벨컷 이미지
        products: productsLite
      };

      const dataSize = JSON.stringify(uploadData).length;
      console.log('📦 uploadData 크기:', dataSize, 'bytes', `(${(dataSize / 1024 / 1024).toFixed(2)} MB)`);

      let uploadResponse;

      // 64MB 이상이면 청크 방식 사용
      if (dataSize > 60 * 1024 * 1024) {
        console.log('📦 데이터가 너무 큼, 청크 방식 사용...');
        savePendingUploadData(uploadData);

        uploadResponse = await chrome.tabs.sendMessage(coupangTabId, {
          action: 'uploadToCoupang',
          useChunkedTransfer: true,  // 청크 방식으로 데이터 요청하라고 알림
          dataInfo: {
            excelCount: uploadData.excelFiles.length,
            productImageCount: uploadData.productImages.length,
            labelImageCount: uploadData.labelImages.length,
            productCount: uploadData.products.length
          }
        });

        // 전송 완료 후 메모리 정리
        clearPendingUploadData();
      } else {
        uploadResponse = await chrome.tabs.sendMessage(coupangTabId, {
          action: 'uploadToCoupang',
          data: uploadData
        });
      }

      console.log('📥 쿠팡 업로드 응답 수신:', uploadResponse);

      if (uploadResponse && uploadResponse.success) {
        console.log(`🎉 쿠팡 업로드 성공! 견적서 ID: ${uploadResponse.quoteId}`);
        isUploadInProgress = false;  // 업로드 완료 - 탭 새로고침 재활성화
        console.log('✅ 업로드 완료 - 탭 새로고침 재활성화');

        // 업로드 완료
        await updateProgress('upload', 'completed');

        // 상품 상태를 'uploaded'로 변경하고 quoteId 저장
        try {
          const productIds = data.products
            .filter(p => p.id)
            .map(p => p.id);

          if (productIds.length > 0) {
            console.log('📊 상품 상태 업데이트 중...', productIds.length, '개');

            // 일괄 상태 변경 API 호출
            const statusResponse = await authFetch(`${SERVER_URL}/api/products/batch-status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ids: productIds,
                status: 'uploaded'
              })
            });

            if (statusResponse.ok) {
              console.log('✅ 상품 상태 -> uploaded 변경 완료');
            }

            // 각 상품에 quoteId 저장
            for (const productId of productIds) {
              await authFetch(`${SERVER_URL}/api/products/${productId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  quoteId: uploadResponse.quoteId,
                  quotationName: uploadResponse.quotationName,
                  uploadedAt: new Date().toISOString()
                })
              });
            }
            console.log('✅ 견적서 ID 저장 완료:', uploadResponse.quoteId);
          }
        } catch (statusError) {
          console.error('⚠️ 상품 상태 업데이트 실패:', statusError);
        }

        // 검증 시작
        await updateProgress('validate', 'in_progress');
        await new Promise(resolve => setTimeout(resolve, 1500)); // 검증 시각적 표시

        // 검증 완료
        await updateProgress('validate', 'completed');

        // 전체 완료
        await updateProgress('complete', 'completed');

        // 3초 후 모달 닫기
        await new Promise(resolve => setTimeout(resolve, 3000));
        const allTabs = await chrome.tabs.query({});
        const localhostTab = allTabs.find(tab => tab.url && tab.url.includes('totalbot.cafe24.com'));
        if (localhostTab) {
          await chrome.tabs.sendMessage(localhostTab.id, {
            action: 'closeProgressModal'
          });
        }
      } else if (uploadResponse && uploadResponse.rejected) {
        // 견적서 반려됨
        console.log('❌ 견적서 반려됨:', uploadResponse);
        isUploadInProgress = false;  // 업로드 완료 - 탭 새로고침 재활성화
        await updateProgress('upload', 'completed');
        await updateProgress('validate', 'error');

        // 반려 정보를 localhost 탭에 전송
        const allTabs = await chrome.tabs.query({});
        const localhostTab = allTabs.find(tab => tab.url && tab.url.includes('totalbot.cafe24.com'));
        if (localhostTab) {
          await chrome.tabs.sendMessage(localhostTab.id, {
            action: 'showRejectedModal',
            quoteId: uploadResponse.quoteId,
            quotationName: uploadResponse.quotationName,
            downloadUrl: uploadResponse.downloadUrl,
            error: uploadResponse.error
          });
        }
      } else if (uploadResponse && uploadResponse.pending) {
        // 검증 진행 중 (시간 초과)
        console.log('⏳ 검증 진행 중:', uploadResponse);
        isUploadInProgress = false;  // 업로드 완료 - 탭 새로고침 재활성화
        await updateProgress('upload', 'completed');
        await updateProgress('validate', 'pending');

        // 상품 상태를 'uploaded'로 변경하고 quoteId 저장 (pending도 업로드는 완료된 상태)
        try {
          const productIds = data.products
            .filter(p => p.id)
            .map(p => p.id);

          if (productIds.length > 0) {
            console.log('📊 상품 상태 업데이트 중 (pending)...', productIds.length, '개');

            await authFetch(`${SERVER_URL}/api/products/batch-status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ids: productIds,
                status: 'uploaded'
              })
            });

            for (const productId of productIds) {
              await authFetch(`${SERVER_URL}/api/products/${productId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  quoteId: uploadResponse.quoteId,
                  quotationName: uploadResponse.quotationName,
                  uploadedAt: new Date().toISOString(),
                  verificationStatus: 'pending'
                })
              });
            }
            console.log('✅ 상품 상태 및 견적서 ID 저장 완료 (검증 진행 중)');
          }
        } catch (statusError) {
          console.error('⚠️ 상품 상태 업데이트 실패:', statusError);
        }

        // 검증 진행 중 정보를 localhost 탭에 전송
        const allTabs = await chrome.tabs.query({});
        const localhostTab = allTabs.find(tab => tab.url && tab.url.includes('totalbot.cafe24.com'));
        if (localhostTab) {
          await chrome.tabs.sendMessage(localhostTab.id, {
            action: 'showPendingModal',
            quoteId: uploadResponse.quoteId,
            quotationName: uploadResponse.quotationName,
            error: uploadResponse.error
          });
        }
      } else {
        console.log('⚠️ 쿠팡 업로드 실패:', uploadResponse?.error || '알 수 없는 오류');
        isUploadInProgress = false;  // 업로드 실패 - 탭 새로고침 재활성화
        await updateProgress('upload', 'error');

        // 실패 정보를 localhost 탭에 전송 (수동 업로드 옵션 제공)
        const allTabs = await chrome.tabs.query({});
        const localhostTab = allTabs.find(tab => tab.url && tab.url.includes('totalbot.cafe24.com'));
        if (localhostTab) {
          await chrome.tabs.sendMessage(localhostTab.id, {
            action: 'showUploadFailedModal',
            error: uploadResponse?.error || '알 수 없는 오류'
          });
        }
      }

    } catch (uploadError) {
      console.error('❌ 쿠팡 업로드 오류:', uploadError);
      console.log('⚠️ 견적서는 생성되었으나 자동 업로드에 실패했습니다.');
      isUploadInProgress = false;  // 업로드 오류 - 탭 새로고침 재활성화
      // 업로드 실패해도 견적서 생성은 성공이므로 계속 진행
    }

    // 다운로드된 파일 정보 출력
    console.log('\n✅ 작성된 견적서 파일 정보:');
    for (const fileInfo of filesData) {
      const { filename, downloadId } = fileInfo;
      console.log(`   📄 ${filename} (Download ID: ${downloadId})`);
    }
    console.log('   💡 파일은 TotalBot 폴더에 저장되었습니다.');

    return {
      success: true,
      count: filesData.length,
      imagesDownloaded: successCount,
      imagesFailed: failCount
    };

  } catch (error) {
    console.error('❌ 견적서 작성 오류:', error);
    isUploadInProgress = false;  // 오류 발생 - 탭 새로고침 재활성화
    return { success: false, error: error.message };
  }
}

/**
 * 반려 견적서 상세 내역 다운로드 (쿠팡 탭에서 실행)
 */
async function handleDownloadQuotationResult(quoteId) {
  try {
    console.log('📥 반려 견적서 상세 내역 다운로드:', quoteId);

    // 쿠팡 탭 찾기 또는 생성
    const allTabs = await chrome.tabs.query({});
    let coupangTab = allTabs.find(tab =>
      tab.url && tab.url.includes('supplier.coupang.com')
    );

    if (!coupangTab) {
      // 쿠팡 탭이 없으면 견적서 목록 페이지 열기
      coupangTab = await chrome.tabs.create({
        url: 'https://supplier.coupang.com/qvt/quotation',
        active: true
      });
      // 페이지 로드 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 쿠팡 탭에서 다운로드 실행
    const downloadUrl = `https://supplier.coupang.com/qvt/quotation/${quoteId}/inspection/result/file`;

    // content script를 통해 다운로드 시도
    await chrome.scripting.executeScript({
      target: { tabId: coupangTab.id },
      func: (url) => {
        // 쿠팡 탭의 세션으로 다운로드
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
      },
      args: [downloadUrl]
    });

    console.log('✅ 다운로드 요청 전송됨');
    return { success: true };

  } catch (error) {
    console.error('❌ 다운로드 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Blob을 Base64 문자열로 변환
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1]; // data:... 제거
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 가격 계산 함수 (CNY -> KRW 변환 및 마진 적용)
 */
function calculatePrices(priceCNY, priceSettings) {
  if (!priceSettings || !priceCNY) {
    return { supplyPrice: 0, sellPrice: 0 };
  }

  const exchangeRate = priceSettings.exchangeRate || 190;
  const packagingCost = priceSettings.packagingCost || 500;
  const minMargin = priceSettings.minMargin || 1000;
  const supplyMargins = priceSettings.supplyMargins || [{ amount: Infinity, percent: 30 }];
  const saleMargins = priceSettings.saleMargins || [{ amount: Infinity, percent: 15 }];

  // 1. 원화 원가
  const costKRW = priceCNY * exchangeRate;

  // 2. 공급 마진% 선택
  let supplyMarginPercent = 30;
  for (const rule of supplyMargins) {
    if (costKRW < rule.amount) {
      supplyMarginPercent = rule.percent;
      break;
    }
  }

  // 3. 공급가 = (원화 원가 / (1 - 공급마진%)) + 포장비
  const supplyPrice = (costKRW / (1 - supplyMarginPercent / 100)) + packagingCost;

  // 4. 판매 마진% 선택
  let saleMarginPercent = 15;
  for (const rule of saleMargins) {
    if (supplyPrice < rule.amount) {
      saleMarginPercent = rule.percent;
      break;
    }
  }

  // 5. 판매가 = 공급가 / (1 - 판매마진%)
  let sellPrice = supplyPrice / (1 - saleMarginPercent / 100);

  // 6. 최소 마진 보장
  const margin = sellPrice - supplyPrice;
  if (margin < minMargin) {
    sellPrice = supplyPrice + minMargin;
  }

  return {
    supplyPrice: Math.round(supplyPrice),
    sellPrice: Math.round(sellPrice)
  };
}

/**
 * 매핑에 따라 적절한 값 반환
 */
function getValueForMapping(mapping, context) {
  const { type, value: fixedValue, header } = mapping;
  const { category, productTitle, option1, option2, searchTags, weight, size, price, product, option, productIndex, brandName, handlingCare, season, requiredFields, priceSettings } = context;

  switch (type) {
    case 'productName':
      // 제품명 옵션1 옵션2 조합 (쿠팡 견적서는 상품명이 겹치면 안됨)
      // 최대 59글자로 제한 - 옵션 공간 확보 후 제목 자르기
      const maxLength = 59;
      const opt1Str = option1 ? ' ' + option1 : '';
      const opt2Str = option2 ? ' ' + option2 : '';
      const optionsLength = opt1Str.length + opt2Str.length;

      // 제목을 옵션 공간 확보 후 자름
      const maxTitleLength = maxLength - optionsLength;
      let truncatedTitle = productTitle;
      if (truncatedTitle.length > maxTitleLength) {
        truncatedTitle = truncatedTitle.substring(0, maxTitleLength);
      }

      let combinedName = truncatedTitle + opt1Str + opt2Str;
      console.log(`🔧 productName 처리: 제목=${truncatedTitle.length}자, 옵션=${optionsLength}자, 결과=${combinedName.length}자`);
      return combinedName;

    case 'modelName':
      // 모델명 = 제품명만 (59글자 제한)
      const modelMaxLength = 59;
      let modelName = productTitle || '';
      if (modelName.length > modelMaxLength) {
        modelName = modelName.substring(0, modelMaxLength);
      }
      console.log(`🔧 modelName 처리: ${modelName.length}자`);
      return modelName;

    case 'option1':
      return option1 || '';

    case 'option2':
      return option2 || 'One size';

    case 'fixed':
      // 고정값 또는 특수 값 처리
      if (fixedValue === '(선택한 카테고리)') return category;
      if (fixedValue === '@Search_Tag') return searchTags;
      if (fixedValue === '@포장 무게') return weight;
      if (fixedValue === '@포장 사이즈') return size;
      if (fixedValue === '(계산된 공급가)') {
        if (option?.supplyPrice) return option.supplyPrice;
        const calculated = calculatePrices(price, priceSettings);
        return calculated.supplyPrice || price;
      }
      if (fixedValue === '(계산된 판매가)') {
        if (option?.sellPrice) return option.sellPrice;
        const calculated = calculatePrices(price, priceSettings);
        return calculated.sellPrice || Math.round(price * 1.15);
      }
      if (fixedValue === '(계산된 소비자가)') {
        // 판매가의 1.3배
        let sellPriceForCalc = option?.sellPrice;
        if (!sellPriceForCalc && priceSettings) {
          const calculated = calculatePrices(price, priceSettings);
          sellPriceForCalc = calculated.sellPrice;
        }
        return Math.round((sellPriceForCalc || price) * 1.3);
      }

      // 브랜드명 처리
      if (fixedValue === '%Brand_Name') return brandName || '';
      if (fixedValue === '%Brand_Name 협력사') return brandName ? `${brandName} 협력사` : '';
      if (fixedValue === '%Brand_name 협력사') return brandName ? `${brandName} 협력사` : '';

      // 취급주의 사유 처리
      if (fixedValue === '@유리OR해당사항없음') return handlingCare || '해당사항없음';

      // 계절 처리
      if (fixedValue === '@계절') return season || '사계절';

      // @ 또는 % 포함 변수 중 처리되지 않은 것은 그대로 반환
      if (fixedValue.includes('@') || fixedValue.includes('%')) {
        return fixedValue;
      }

      return fixedValue || '';

    // 이미지 관련 계산 필드
    case 'calc:option_image':
      // 대표이미지 파일명
      let optionFilename = getOptionImageFilename(option, product, productIndex);
      // 여러 상품이 있을 때 파일명 충돌 방지를 위해 productIndex 추가
      if (context.totalProducts && context.totalProducts > 1 && optionFilename) {
        const extMatch = optionFilename.match(/\.([a-zA-Z]+)$/);
        const ext = extMatch ? extMatch[1] : 'png';
        const nameWithoutExt = optionFilename.replace(/\.[a-zA-Z]+$/, '');
        optionFilename = `${nameWithoutExt}_p${productIndex + 1}.${ext}`;
      }
      return optionFilename;

    case 'calc:detail_image':
      // 상세이미지 파일명
      return getDetailImageFilename(product, productIndex);

    case 'calc:label_image':
      // 제품 필수 표시사항 (라벨 이미지)
      return getLabelImageFilename(product, productIndex);

    case 'tmpl:image_alt':
      // 이미지 대체 텍스트 템플릿
      return getImageAltText(productTitle);

    // 기타 계산 필드
    case 'calc:product_sequence':
      // 상품 순차 번호 (1, 2, 3...)
      return productIndex + 1;

    case 'calc:additional_image':
      // 선택된 추가 이미지 파일명 (쉼표로 구분, 확장명 포함)
      if (product && product.images && Array.isArray(product.images)) {
        const selectedSet = product.selectedAdditionalImages
          ? new Set(product.selectedAdditionalImages)
          : new Set(product.images.map((_, idx) => idx)); // 선택 정보 없으면 전체 선택

        const filenames = [];
        product.images.forEach((imgUrl, imgIndex) => {
          if (imgUrl && selectedSet.has(imgIndex)) {
            // 확장자 추출 (기본은 png)
            let ext = 'png';
            if (imgUrl) {
              const urlMatch = imgUrl.match(/\.([a-zA-Z]+)(?:\?|$)/);
              if (urlMatch) {
                ext = urlMatch[1].toLowerCase();
                if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                  ext = 'png';
                }
              }
            }
            filenames.push(`additional_${productIndex + 1}_${imgIndex + 1}.${ext}`);
          }
        });
        return filenames.join(',');
      }
      return '';

    case 'calc:size_chart_image':
      // 사이즈 차트 이미지 - 선택 사항이면 공란 처리
      // 헤더명: '사이즈차트 이미지 파일명'
      if (requiredFields && requiredFields['사이즈차트 이미지 파일명'] === false) {
        return ''; // 선택이면 공란
      }
      // 랜덤 파일명 사용 (globalSizeChartImages에서 가져오기)
      console.log(`   📐 사이즈차트 파일명 조회: productIndex=${productIndex}, globalSizeChartImages.length=${globalSizeChartImages ? globalSizeChartImages.length : 0}`);
      if (globalSizeChartImages && globalSizeChartImages.length > 0 && globalSizeChartImages[productIndex]) {
        const filename = globalSizeChartImages[productIndex].filename;
        console.log(`   📐 사이즈차트 파일명: ${filename}`);
        return filename;
      }
      // fallback: 기존 방식
      console.log(`   ⚠️ 사이즈차트 fallback: A${productIndex + 1}.png`);
      return `A${productIndex + 1}.png`;

    case 'calc:release_month_last_year':
      // 작년 동월 (예: 202506)
      const lastYear = new Date().getFullYear() - 1;
      const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
      return `${lastYear}${currentMonth}`;

    default:
      return '';
  }
}

/**
 * 탭 로딩 완료 대기
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo, tab) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        console.log('✅ Tab loaded:', tabId);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // 타임아웃 (10초)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });
}

/**
 * 탭 포그라운드로 전환
 */
async function bringTabToFront(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    console.log('✅ Tab brought to front:', tabId);
  } catch (error) {
    console.error('❌ Failed to bring tab to front:', error);
  }
}

// 알림 표시
function showNotification(title, message) {
  // 알림은 선택적으로 사용
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: title || 'TotalBot',
      message: message || ''
    });
  } catch (e) {
    console.log('⚠️ Notification skipped:', e.message);
  }
}

/**
 * 쿠팡 로그인 시도
 */
async function handleCoupangLogin(credentials) {
  try {
    console.log('🔐 Starting Coupang login...');

    // 쿠키 삭제 비활성화 - 전체 쿠키 삭제가 봇 탐지에 걸릴 수 있음
    // 대신 기존 세션을 유지하고 로그인 시도
    // console.log('🧹 로그인 전 쿠팡 쿠키 정리...');
    // await clearCoupangCookies();

    // 메인 페이지로 이동 (자연스럽게 OAuth 로그인 페이지로 리다이렉트됨)
    // 직접 OAuth URL 접근 시 Akamai 보안 차단 우회
    const supplierUrl = 'https://supplier.coupang.com/';

    // 이미 열린 쿠팡 탭이 있는지 확인
    if (coupangTab) {
      try {
        await chrome.tabs.get(coupangTab);
        console.log('✅ Existing tab found, reusing:', coupangTab);
        // 기존 탭을 메인 페이지로 이동
        await chrome.tabs.update(coupangTab, { url: supplierUrl });
      } catch (e) {
        console.log('⚠️ Previous tab closed');
        coupangTab = null;
      }
    }

    // 새 탭 생성
    if (!coupangTab) {
      console.log('🌐 Creating new tab for Coupang login...');
      const tab = await chrome.tabs.create({
        url: supplierUrl,
        active: true // 사용자가 볼 수 있도록 활성화
      });
      coupangTab = tab.id;
      console.log('✅ Tab created:', coupangTab);
    }

    // 탭 로딩 완료 대기 (로그인 페이지로 리다이렉트될 때까지)
    await waitForTabLoad(coupangTab);

    // 로그인 페이지로 리다이렉트 대기 (최대 10초)
    console.log('⏳ Waiting for redirect to login page...');
    for (let i = 0; i < 20; i++) {
      const tabInfo = await chrome.tabs.get(coupangTab);
      if (tabInfo.url && tabInfo.url.includes('xauth.coupang.com')) {
        console.log('✅ Redirected to login page');
        await waitForTabLoad(coupangTab);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Content script가 로드될 때까지 추가 대기 (최대 5초)
    console.log('⏳ Waiting for content script to load...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Content script로 로그인 요청 (재시도 로직 포함)
    console.log('📤 Sending login request to content script...');
    let response = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`   시도 ${attempt}/3...`);
        response = await chrome.tabs.sendMessage(coupangTab, {
          action: 'performLogin',
          credentials: credentials
        });
        console.log('✅ Login response received:', response);
        break; // 성공하면 루프 종료
      } catch (error) {
        lastError = error;
        console.log(`   ⚠️ 시도 ${attempt} 실패:`, error.message);
        if (attempt < 3) {
          console.log('   재시도 중...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // 모든 시도 실패
    if (!response && lastError) {
      console.error('❌ Content script 통신 실패:', lastError);
      return {
        success: false,
        error: 'Content script가 응답하지 않습니다. 페이지를 새로고침하고 다시 시도해주세요.'
      };
    }

    if (response && response.success) {
      // 로그인 성공 후 /qvt/registration으로 이동 (QVT API 세션 확보)
      console.log('🔄 로그인 성공, /qvt/registration으로 이동하여 QVT 세션 확보...');
      try {
        await chrome.tabs.update(coupangTab, { url: 'https://supplier.coupang.com/qvt/registration' });
        await waitForTabLoad(coupangTab);
        await ensureContentScript(coupangTab);
        console.log('✅ QVT 페이지 로드 완료');
      } catch (e) {
        console.warn('⚠️ QVT 페이지 이동 실패:', e.message);
      }

      showNotification('쿠팡 로그인 성공', '로그인이 완료되었습니다.');
      return { success: true };
    } else {
      return { success: false, error: response?.error || '로그인 실패' };
    }

  } catch (error) {
    console.error('❌ Login error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 쿠팡 로그인 상태 확인 (탭 + 쿠키 기반)
 * 쿠팡 서플라이어 허브 탭이 열려있고 로그인 쿠키가 있을 때만 로그인 상태로 판단
 */
async function checkCoupangLoginStatus() {
  try {
    // 1. 먼저 쿠팡 서플라이어 허브 탭이 열려있는지 확인
    const allTabs = await chrome.tabs.query({});
    const coupangTab = allTabs.find(tab =>
      tab.url && tab.url.includes('supplier.coupang.com')
    );

    if (!coupangTab) {
      console.log('🔍 쿠팡 서플라이어 허브 탭이 열려있지 않음');
      return { loggedIn: false, tabOpen: false };
    }

    console.log('✅ 쿠팡 탭 발견:', coupangTab.id, coupangTab.url);

    // 2. xauth.coupang.com 도메인의 Keycloak 쿠키 확인
    const xauthCookies = await chrome.cookies.getAll({
      domain: 'xauth.coupang.com'
    });

    // Keycloak 인증 쿠키 확인
    const keycloakCookies = xauthCookies.filter(c =>
      c.name.includes('KEYCLOAK') ||
      c.name.includes('AUTH_SESSION') ||
      c.name === 'KC_RESTART'
    );

    if (keycloakCookies.length > 0) {
      console.log('🍪 Keycloak cookies found:', keycloakCookies.map(c => c.name));
      return { loggedIn: true, tabOpen: true, method: 'cookie' };
    }

    // 3. supplier.coupang.com 도메인의 세션 쿠키도 확인
    const supplierCookies = await chrome.cookies.getAll({
      domain: 'supplier.coupang.com'
    });

    const sessionCookies = supplierCookies.filter(c =>
      c.name.includes('SESSION') ||
      c.name.includes('JSESSIONID') ||
      c.name === 'sid'
    );

    if (sessionCookies.length > 0) {
      console.log('🍪 Supplier session cookies found:', sessionCookies.map(c => c.name));
      return { loggedIn: true, tabOpen: true, method: 'cookie' };
    }

    console.log('🍪 쿠팡 탭은 열려있지만 로그인 쿠키 없음');
    return { loggedIn: false, tabOpen: true };

  } catch (error) {
    console.error('❌ Cookie check error:', error);
    return { loggedIn: false, error: error.message };
  }
}

/**
 * 카테고리 검색 처리 (쿠팡 탭으로 전달)
 * 세션 만료로 실패 시 자동으로 QVT 쿠키 리셋 후 재시도
 */
async function handleCategorySearch(keyword, retryCount = 0) {
  const MAX_RETRIES = 1;  // 최대 1회 자동 재시도

  try {
    console.log('🔍 Handling category search:', keyword, retryCount > 0 ? `(재시도 ${retryCount}회차)` : '');

    // 쿠팡 탭 확인 및 생성
    await ensureCoupangTab();

    // 탭 상태 확인
    let tabInfo = await chrome.tabs.get(coupangTab);
    console.log('📍 Tab info before sendMessage:', {
      id: coupangTab,
      url: tabInfo.url,
      status: tabInfo.status
    });

    // /qvt/ 페이지가 아니면 이동 (QVT API 세션 필요)
    if (tabInfo.url && !tabInfo.url.includes('/qvt/')) {
      console.log('⚠️ Not on QVT page, navigating to /qvt/registration...');
      await chrome.tabs.update(coupangTab, { url: 'https://supplier.coupang.com/qvt/registration' });
      await waitForTabLoad(coupangTab);

      // Content script 재주입
      await ensureContentScript(coupangTab);

      tabInfo = await chrome.tabs.get(coupangTab);
      console.log('📍 Tab info after QVT navigation:', tabInfo.url);
    }

    // Content script 로드 대기
    console.log('⏳ Waiting for content script...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 쿠팡 탭으로 메시지 전송
    console.log('📤 Sending searchCategories message...');
    const response = await chrome.tabs.sendMessage(coupangTab, {
      action: 'searchCategories',
      keyword: keyword
    });

    console.log('✅ Search response:', response);

    // 세션 문제로 실패했는지 확인 (Failed to fetch, 로그인 필요 등)
    if (!response.success && retryCount < MAX_RETRIES) {
      const errorMsg = response.error || '';
      const isSessionError =
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('세션') ||
        errorMsg.includes('로그인') ||
        errorMsg.includes('네트워크 오류');

      if (isSessionError) {
        console.log('🔄 세션 문제 감지, QVT 쿠키 리셋 후 재시도...');

        // QVT 쿠키 리셋
        await resetQvtCookiesAndReload();

        // 잠시 대기 후 재시도
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 재귀 호출로 재시도
        return handleCategorySearch(keyword, retryCount + 1);
      }
    }

    return response;

  } catch (error) {
    console.error('❌ Category search error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      coupangTab: coupangTab
    });

    // 세션 문제로 예외 발생 시 자동 재시도
    if (retryCount < MAX_RETRIES) {
      const errorMsg = error.message || '';
      const isSessionError =
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('세션') ||
        errorMsg.includes('로그인') ||
        errorMsg.includes('Could not establish connection');

      if (isSessionError) {
        console.log('🔄 세션 문제 감지 (예외), QVT 쿠키 리셋 후 재시도...');

        // QVT 쿠키 리셋
        await resetQvtCookiesAndReload();

        // 잠시 대기 후 재시도
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 재귀 호출로 재시도
        return handleCategorySearch(keyword, retryCount + 1);
      }
    }

    return { success: false, error: error.message, categories: [], total: 0 };
  }
}

/**
 * 견적서 다운로드 처리 (쿠팡 탭으로 전달)
 */
async function handleQuotationDownload(data) {
  try {
    const { categoryIds, categories } = data;
    console.log('📥 Handling quotation download:', categoryIds);
    console.log('📋 Categories:', categories);

    // 쿠팡 탭 확인 및 생성
    await ensureCoupangTab();

    // 쿠팡 탭으로 메시지 전송 (ZIP 데이터를 ArrayBuffer로 받기)
    const response = await chrome.tabs.sendMessage(coupangTab, {
      action: 'downloadQuotation',
      categoryIds: categoryIds,
      returnArrayBuffer: true  // ArrayBuffer로 반환 요청
    });

    console.log('✅ Download response:', response);

    if (response.success && response.zipData) {
      // 저장된 다운로드 경로 확인
      const { downloadPath } = await chrome.storage.local.get('downloadPath');

      console.log('📦 Processing ZIP data...');
      console.log('📦 Base64 data length:', response.zipData.length);

      try {
        // Base64를 Uint8Array로 디코딩
        const binaryString = atob(response.zipData);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
        console.log('✅ Decoded Base64 to Uint8Array, length:', uint8Array.length);

        // JSZip으로 압축 해제
        const zip = await JSZip.loadAsync(uint8Array);
        console.log('✅ ZIP loaded, files:', Object.keys(zip.files).length);

        // 엑셀 파일만 필터링
        const excelFiles = Object.keys(zip.files).filter(filename =>
          filename.toLowerCase().endsWith('.xlsx') && !zip.files[filename].dir
        );

        console.log('📊 Excel files found:', excelFiles.length);

        // 엑셀 파일 정보 저장 (상세 카테고리 설정용)
        const excelDataArray = [];

        // Chrome Downloads API는 Downloads 폴더 기준 상대 경로만 허용하므로
        // 항상 Downloads/TotalBot 폴더에 저장
        let folderPath = null;
        let needsPathSelection = false;

        // 각 엑셀 파일을 카테고리명으로 다운로드
        for (let i = 0; i < excelFiles.length; i++) {
          const originalFilename = excelFiles[i];

          // ArrayBuffer로 읽어서 SheetJS로 파싱
          const fileArrayBuffer = await zip.files[originalFilename].async('arraybuffer');

          // 카테고리명 + 타임스탬프로 새 파일명 생성 (중복 방지)
          const now = new Date();
          const timestamp = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0');

          let newFilename = `쿠팡_견적서_${timestamp}.xlsx`;
          if (categories && categories[i]) {
            const cat = categories[i];
            // 전체 경로에서 마지막 카테고리 이름만 추출
            const parts = cat.path.split('>').map(p => p.trim());
            const categoryName = parts[parts.length - 1] || cat.name;
            newFilename = categoryName.replace(/[<>:"/\\|?*]/g, '_') + `_${timestamp}.xlsx`;
          }

          try {
            // SheetJS로 엑셀 파일 파싱
            const workbook = XLSX.read(fileArrayBuffer, { type: 'array' });

            console.log(`📖 Reading Excel: ${originalFilename}`);
            console.log(`   Available sheets: ${workbook.SheetNames.join(', ')}`);

            // 모든 시트의 보호 해제 (비밀번호: cbqf2020)
            workbook.SheetNames.forEach(sheetName => {
              const sheet = workbook.Sheets[sheetName];
              if (sheet['!protect']) {
                console.log(`   🔓 시트 보호 해제: ${sheetName}`);
                delete sheet['!protect'];
              }
            });

            // 두 번째 시트 읽기 (상품 데이터)
            const sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            console.log(`   Data sheet (Sheet 1): ${sheetName}`);

            // 세 번째 시트 읽기 (드롭다운 목록)
            const dropdownSheetName = workbook.SheetNames[2];
            let dropdownOptions = [];

            if (dropdownSheetName) {
              console.log(`   Dropdown sheet (Sheet 2): ${dropdownSheetName}`);
              const dropdownSheet = workbook.Sheets[dropdownSheetName];

              // 시트 범위 확인
              console.log(`   Sheet range:`, dropdownSheet['!ref']);

              // B열의 모든 값 읽기
              const dropdownData = XLSX.utils.sheet_to_json(dropdownSheet, { header: 1 });
              console.log(`   Dropdown sheet rows: ${dropdownData.length}`);
              console.log(`   First 5 rows of dropdown sheet:`, dropdownData.slice(0, 5));

              // A열, B열, C열 모두 확인
              console.log(`   Column A (first 10):`, dropdownData.slice(0, 10).map(row => row[0]));
              console.log(`   Column B (first 10):`, dropdownData.slice(0, 10).map(row => row[1]));
              console.log(`   Column C (first 10):`, dropdownData.slice(0, 10).map(row => row[2]));

              // A열 값들 추출 (엑셀 B열이 배열 인덱스 0에 해당)
              dropdownOptions = dropdownData
                .slice(1)  // 첫 행(헤더) 제외
                .map(row => row[0])  // A열 (인덱스 0)
                .filter(val => val && val.toString().trim() !== '');  // 빈 값 제거

              console.log(`   📋 Dropdown options (B column): ${dropdownOptions.length} items`);
              console.log(`   First 10 options:`, dropdownOptions.slice(0, 10));
            } else {
              console.log(`   ⚠️ No 3rd sheet found for dropdown options`);
            }

            // B9 셀과 주변 셀들 읽기
            const cellB9 = worksheet['B9'];
            const cellA9 = worksheet['A9'];
            const cellC9 = worksheet['C9'];

            console.log(`   A9: ${cellA9 ? cellA9.v : 'empty'}`);
            console.log(`   B9: ${cellB9 ? cellB9.v : 'empty'}`);
            console.log(`   C9: ${cellC9 ? cellC9.v : 'empty'}`);

            // Data Validation 정보 확인
            console.log(`   Worksheet keys:`, Object.keys(worksheet).filter(k => k.startsWith('!')));
            if (worksheet['!datavalidation']) {
              console.log(`   Data Validation:`, worksheet['!datavalidation']);
            }

            // B9 셀의 모든 속성 확인
            if (cellB9) {
              console.log(`   B9 cell properties:`, Object.keys(cellB9));
              console.log(`   B9 full cell:`, cellB9);
            }

            // 전체 시트 데이터를 JSON으로 변환
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            console.log('   Total rows:', jsonData.length);
            console.log('   First 10 rows:', jsonData.slice(0, 10));

            // 9행 데이터 확인 (0-based이므로 index 8)
            if (jsonData.length > 8) {
              console.log('   Row 9 (index 8):', jsonData[8]);
            }

            // 5행 헤더 확인 (index 4)
            if (jsonData.length > 4) {
              console.log('   Row 5 (header, index 4):', jsonData[4]);
            }

            // 카테고리 정보와 함께 저장
            const categoryInfo = categories && categories[i] ? categories[i] : null;

            // Excel ArrayBuffer를 메모리에 저장
            const dataIndex = excelDataStore.length;
            excelDataStore.push({
              arrayBuffer: fileArrayBuffer,
              filename: originalFilename,
              downloadedFilename: newFilename  // 실제 다운로드된 파일명 추가
            });

            excelDataArray.push({
              filename: originalFilename,
              downloadedFilename: newFilename,  // 실제 다운로드된 파일명
              category: categoryInfo,
              cellB9: cellB9 ? cellB9.v : null,
              sheetData: jsonData,
              dropdownOptions: dropdownOptions,  // 드롭다운 옵션 추가
              dataIndex: dataIndex  // excelDataStore의 인덱스
            });

          } catch (parseError) {
            console.error(`❌ Failed to parse Excel ${originalFilename}:`, parseError);
          }

          // ArrayBuffer를 Base64 Data URL로 변환
          let binaryString = '';
          const bytes = new Uint8Array(fileArrayBuffer);
          for (let j = 0; j < bytes.length; j++) {
            binaryString += String.fromCharCode(bytes[j]);
          }
          const base64 = btoa(binaryString);
          const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;

          console.log(`📝 Download info for file ${i}:`);
          console.log(`   folderPath: ${folderPath}`);
          console.log(`   newFilename: ${newFilename}`);
          console.log(`   needsPathSelection: ${needsPathSelection}`);

          // 엑셀 파일 다운로드
          // Chrome Downloads API는 Downloads 폴더 기준 상대 경로만 허용
          // 따라서 항상 TotalBot 폴더에 저장
          const excelFilename = `TotalBot/${newFilename}`;

          console.log(`   excelFilename: ${excelFilename}`);
          console.log(`   saveAs: ${needsPathSelection && i === 0}`);

          const excelDownloadId = await chrome.downloads.download({
            url: dataUrl,
            filename: excelFilename,
            saveAs: needsPathSelection && i === 0,  // 첫 파일만 경로 선택
            conflictAction: 'uniquify'
          });

          console.log(`✅ Excel download started: ${newFilename} (ID: ${excelDownloadId})`);

          // 첫 다운로드 완료 후 경로 저장
          if (needsPathSelection && i === 0) {
            // 첫 파일 다운로드 완료 대기
            await new Promise((resolve) => {
              const listener = (delta) => {
                if (delta.id === excelDownloadId && delta.state?.current === 'complete') {
                  chrome.downloads.onChanged.removeListener(listener);
                  chrome.downloads.search({ id: excelDownloadId }).then((items) => {
                    if (items && items.length > 0) {
                      const downloadedPath = items[0].filename;
                      // URL 디코딩
                      const decodedPath = decodeURIComponent(downloadedPath);
                      folderPath = decodedPath.substring(0, decodedPath.lastIndexOf('/'));
                      chrome.storage.local.set({ downloadPath: folderPath });
                      console.log('✅ Saved download path:', folderPath);
                      needsPathSelection = false;
                    }
                    resolve();
                  });
                }
              };
              chrome.downloads.onChanged.addListener(listener);
            });
          }
        }

        console.log('📋 Excel data array:', excelDataArray);

        return {
          success: true,
          message: '엑셀 파일이 성공적으로 저장되었습니다.',
          excelCount: excelFiles.length,
          excelData: excelDataArray  // 엑셀 데이터 전달
        };

      } catch (error) {
        console.error('❌ ZIP processing error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }

    return response;

  } catch (error) {
    console.error('❌ Quotation download error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 견적서 자동 작성 (확장 프로그램에서 직접 처리)
 */
async function handleFillQuotations(data) {
  try {
    console.log('📝 견적서 자동 작성 시작');
    console.log('📋 입력 데이터:', data);

    const { searchTags, size, weight, selections } = data;

    // 검색태그 문자열
    const searchTagStr = searchTags.join(', ');

    // 사이즈 문자열 (가로x세로x높이)
    const sizeStr = `${size.width}x${size.height}x${size.depth}`;

    // 무게 문자열
    const weightStr = `${weight}g`;

    console.log('📊 처리할 데이터:', {
      searchTag: searchTagStr,
      size: sizeStr,
      weight: weightStr,
      selections: selections
    });

    // 각 Excel 파일 처리
    for (const [indexStr, selection] of Object.entries(selections)) {
      const index = parseInt(indexStr);

      if (!excelDataStore[index]) {
        console.warn(`⚠️ Excel 데이터 ${index}를 찾을 수 없습니다`);
        continue;
      }

      const excelData = excelDataStore[index];
      console.log(`\n📄 Excel ${index + 1} 처리 중: ${excelData.filename}`);
      console.log(`   선택된 카테고리: ${selection.optionValue}`);

      // XLSX로 워크북 읽기
      const workbook = XLSX.read(excelData.arrayBuffer, { type: 'array' });

      // 2번째 시트 (index 1)에서 작업
      const sheetName = workbook.SheetNames[1];
      if (!sheetName) {
        console.error(`❌ 2번째 시트를 찾을 수 없습니다: ${excelData.filename}`);
        continue;
      }

      const worksheet = workbook.Sheets[sheetName];
      console.log(`   📊 시트명: ${sheetName}`);

      // 5행 (index 4)에서 헤더 읽기
      const headers = [];
      const headerRow = 5;
      let emptyCount = 0;
      const maxEmptyCells = 5;  // 연속 5개 빈 셀이면 종료

      for (let col = 1; col <= 100; col++) {  // 최대 100개 컬럼까지
        const cellAddress = XLSX.utils.encode_cell({ r: headerRow - 1, c: col - 1 });
        const cell = worksheet[cellAddress];

        if (!cell || !cell.v) {
          emptyCount++;
          if (emptyCount >= maxEmptyCells) {
            break;  // 연속 5개 빈 셀이면 종료
          }
          continue;
        }

        emptyCount = 0;  // 빈 셀 카운터 리셋
        headers.push({
          col: col,
          name: cell.v.toString().trim()
        });
      }

      console.log(`   📋 헤더 ${headers.length}개 발견`);

      // 필요한 컬럼 찾기
      const searchTagCol = headers.find(h => h.name === '검색태그');
      const sizeCol = headers.find(h => h.name === '한 개 단품 포장 사이즈');
      const weightCol = headers.find(h => h.name === '한 개 단품 포장 무게');

      console.log(`   🔍 검색태그 컬럼: ${searchTagCol ? 'col ' + searchTagCol.col : '없음'}`);
      console.log(`   🔍 사이즈 컬럼: ${sizeCol ? 'col ' + sizeCol.col : '없음'}`);
      console.log(`   🔍 무게 컬럼: ${weightCol ? 'col ' + weightCol.col : '없음'}`);

      // 9행에 데이터 작성
      const dataRow = 9;

      // B9에 선택한 카테고리 입력
      const b9Address = 'B9';
      if (!worksheet[b9Address]) {
        worksheet[b9Address] = {};
      }
      worksheet[b9Address].v = selection.optionValue;
      worksheet[b9Address].t = 's';
      console.log(`   ✅ B9 셀에 카테고리 입력: ${selection.optionValue}`);

      // 검색태그 입력
      if (searchTagCol) {
        const tagAddress = XLSX.utils.encode_cell({ r: dataRow - 1, c: searchTagCol.col - 1 });
        if (!worksheet[tagAddress]) {
          worksheet[tagAddress] = {};
        }
        worksheet[tagAddress].v = searchTagStr;
        worksheet[tagAddress].t = 's';
        console.log(`   ✅ ${tagAddress} 셀에 검색태그 입력: ${searchTagStr}`);
      }

      // 사이즈 입력
      if (sizeCol) {
        const sizeAddress = XLSX.utils.encode_cell({ r: dataRow - 1, c: sizeCol.col - 1 });
        if (!worksheet[sizeAddress]) {
          worksheet[sizeAddress] = {};
        }
        worksheet[sizeAddress].v = sizeStr;
        worksheet[sizeAddress].t = 's';
        console.log(`   ✅ ${sizeAddress} 셀에 사이즈 입력: ${sizeStr}`);
      }

      // 무게 입력
      if (weightCol) {
        const weightAddress = XLSX.utils.encode_cell({ r: dataRow - 1, c: weightCol.col - 1 });
        if (!worksheet[weightAddress]) {
          worksheet[weightAddress] = {};
        }
        worksheet[weightAddress].v = weightStr;
        worksheet[weightAddress].t = 's';
        console.log(`   ✅ ${weightAddress} 셀에 무게 입력: ${weightStr}`);
      }

      // 수정된 워크북을 ArrayBuffer로 변환
      const modifiedWorkbook = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

      // ArrayBuffer를 Base64 Data URL로 변환
      let binaryString = '';
      const bytes = new Uint8Array(modifiedWorkbook);
      for (let j = 0; j < bytes.length; j++) {
        binaryString += String.fromCharCode(bytes[j]);
      }
      const base64 = btoa(binaryString);
      const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;

      // 파일명
      const excelFilename = `TotalBot/${excelData.filename}`;

      console.log(`   📤 파일 다운로드 중: ${excelFilename}`);

      // Excel 파일 다운로드
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: excelFilename,
        saveAs: false,
        conflictAction: 'overwrite'
      });

      console.log(`   ✅ 다운로드 시작 (ID: ${downloadId})`);

      // 다운로드 완료 대기
      await new Promise((resolve, reject) => {
        const listener = (delta) => {
          if (delta.id === downloadId) {
            if (delta.state?.current === 'complete') {
              chrome.downloads.onChanged.removeListener(listener);
              console.log(`   ✅ 다운로드 완료: ${excelData.filename}`);
              resolve();
            } else if (delta.error) {
              chrome.downloads.onChanged.removeListener(listener);
              console.error(`   ❌ 다운로드 실패:`, delta.error);
              reject(new Error(delta.error.current));
            }
          }
        };
        chrome.downloads.onChanged.addListener(listener);

        setTimeout(() => {
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error('다운로드 타임아웃'));
        }, 30000);
      });
    }

    console.log('\n✅ 모든 견적서 자동 작성 완료!');

    return {
      success: true,
      message: '견적서 자동 작성이 완료되었습니다.',
      count: Object.keys(selections).length
    };

  } catch (error) {
    console.error('❌ 견적서 자동 작성 오류:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 쿠팡 탭 확인 및 생성
 */
async function ensureCoupangTab() {
  // 쿠팡 메인 페이지 URL (로그인 필요시 쿠팡이 자동으로 OAuth로 리다이렉트함)
  const supplierUrl = 'https://supplier.coupang.com/';

  // 1. 메모리에 저장된 탭 확인
  if (coupangTab) {
    try {
      const tab = await chrome.tabs.get(coupangTab);
      console.log('✅ Existing Coupang tab found (memory):', coupangTab, 'URL:', tab.url);

      if (tab.url && tab.url.includes('supplier.coupang.com')) {
        console.log('✅ Tab is already on supplier.coupang.com');
        return;
      } else if (tab.url && tab.url.includes('xauth.coupang.com')) {
        console.log('⏳ Tab is on login page, waiting for redirect...');
        await waitForSupplierPage(coupangTab, 60000);
        return;
      } else {
        console.log('⚠️ Tab is on unexpected URL, recreating...');
        coupangTab = null;
      }
    } catch (e) {
      console.log('⚠️ Previous tab closed');
      coupangTab = null;
    }
  }

  // 2. 기존에 열린 supplier.coupang.com 탭 찾기 (새 탭 열기 전에!)
  if (!coupangTab) {
    const existingTabs = await chrome.tabs.query({ url: 'https://supplier.coupang.com/*' });
    if (existingTabs.length > 0) {
      coupangTab = existingTabs[0].id;
      console.log('✅ Found existing supplier tab:', coupangTab, 'URL:', existingTabs[0].url);

      // Content script가 로드되어 있는지 확인하고, 없으면 주입
      await ensureContentScript(coupangTab);
      return;
    }
    console.log('📭 No existing supplier.coupang.com tab found');
  }

  // 새 탭 생성 - 메인 페이지로 이동 (로그인 필요시 쿠팡이 자동 리다이렉트)
  console.log('🌐 Creating new Coupang tab (main page)...');
  const tab = await chrome.tabs.create({
    url: supplierUrl,
    active: true // 사용자가 로그인해야 할 수 있으므로 활성화
  });
  coupangTab = tab.id;
  console.log('✅ Coupang tab created:', coupangTab);

  // 탭 로딩 완료 대기
  await waitForTabLoad(coupangTab);

  // 현재 URL 확인
  const currentTab = await chrome.tabs.get(coupangTab);
  console.log('📍 Current URL after load:', currentTab.url);

  // 로그인 페이지로 리다이렉트됐으면 로그인 완료 대기
  if (currentTab.url && currentTab.url.includes('xauth.coupang.com')) {
    console.log('🔐 Login required, waiting for user to login...');
    await waitForSupplierPage(coupangTab, 60000);
  }
}

/**
 * supplier.coupang.com으로 리다이렉트될 때까지 대기
 */
function waitForSupplierPage(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkUrl = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);

        if (tab.url && tab.url.includes('supplier.coupang.com')) {
          console.log('✅ Redirected to supplier.coupang.com');
          // 페이지가 완전히 로드될 때까지 조금 더 대기
          await waitForTabLoad(tabId);
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          console.error('❌ Timeout waiting for supplier.coupang.com');
          reject(new Error('Timeout waiting for login redirect'));
          return;
        }

        // 1초 후 재시도
        setTimeout(checkUrl, 1000);
      } catch (error) {
        reject(error);
      }
    };

    checkUrl();
  });
}

/**
 * 탭에 content script가 로드되어 있는지 확인하고, 없으면 주입
 */
async function ensureContentScript(tabId) {
  try {
    // ping을 보내서 content script가 응답하는지 확인
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.pong) {
      console.log('✅ Content script already loaded in tab:', tabId);
      return true;
    }
  } catch (e) {
    console.log('⚠️ Content script not loaded, injecting...', e.message);
  }

  // Content script 주입
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content-coupang.js']
    });
    console.log('✅ Content script injected successfully');

    // 주입 후 잠시 대기 (초기화 시간)
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  } catch (error) {
    console.error('❌ Failed to inject content script:', error);
    return false;
  }
}

/**
 * 발주 확정 업로드 핸들러
 * 페이지 이동을 background에서 관리하고 content script는 폼 작성만 담당
 */
async function handleOrderConfirmationUpload(orderData) {
  console.log('📤 발주 확정 업로드 시작 (Background 오케스트레이션)');

  try {
    // 1. 쿠팡 탭 찾기 또는 생성
    const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/*' });
    let targetTab;

    if (tabs.length === 0) {
      console.log('⚠️ 쿠팡 탭이 없습니다. 새 탭 생성...');
      targetTab = await chrome.tabs.create({
        url: 'https://supplier.coupang.com/scm/purchase/upload/form'
      });
      // 페이지 로드 대기
      await waitForTabLoad(targetTab.id);
    } else {
      targetTab = tabs[0];
      console.log('✅ 쿠팡 탭 발견:', targetTab.id);

      // 2. 올바른 페이지로 이동
      if (!targetTab.url.includes('/scm/purchase/upload/form')) {
        console.log('🔗 발주 확정 업로드 페이지로 이동 중...');
        await chrome.tabs.update(targetTab.id, {
          url: 'https://supplier.coupang.com/scm/purchase/upload/form'
        });
        // 페이지 로드 대기
        await waitForTabLoad(targetTab.id);
      }
    }

    // 3. Content script 주입 확인
    console.log('🔧 Content script 확인 중...');
    await ensureContentScript(targetTab.id);

    // 추가 대기 (DOM 렌더링 및 content script 초기화 완료)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. 폼 작성 메시지 전송 (페이지 이동 없이)
    console.log('📝 발주 확정 폼 작성 요청 중...');
    const response = await sendMessageWithTimeout(targetTab.id, {
      action: 'fillOrderConfirmationForm',
      orderData: orderData
    }, 60000); // 60초 타임아웃

    console.log('✅ 발주 확정 업로드 응답:', response);
    return response || { success: true, message: '발주 확정 업로드 완료' };

  } catch (error) {
    console.error('❌ 발주 확정 업로드 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 쉽먼트 업로드 핸들러
 * 페이지 이동을 background에서 관리하고 content script는 폼 작성만 담당
 */
async function handleShipmentUpload(shipmentData) {
  console.log('🚚 쉽먼트 업로드 시작 (Background 오케스트레이션)');

  try {
    // 1. 쿠팡 탭 찾기 또는 생성
    const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/*' });
    let targetTab;

    if (tabs.length === 0) {
      console.log('⚠️ 쿠팡 탭이 없습니다. 새 탭 생성...');
      targetTab = await chrome.tabs.create({
        url: 'https://supplier.coupang.com/ibs/shipment/parcel/bulk-creation/upload'
      });
      // 페이지 로드 대기
      await waitForTabLoad(targetTab.id);
    } else {
      targetTab = tabs[0];
      console.log('✅ 쿠팡 탭 발견:', targetTab.id);

      // 2. 올바른 페이지로 이동
      if (!targetTab.url.includes('/ibs/shipment/parcel/bulk-creation/upload')) {
        console.log('🔗 쉽먼트 업로드 페이지로 이동 중...');
        await chrome.tabs.update(targetTab.id, {
          url: 'https://supplier.coupang.com/ibs/shipment/parcel/bulk-creation/upload'
        });
        // 페이지 로드 대기
        await waitForTabLoad(targetTab.id);
      }
    }

    // 3. Content script 주입 확인
    console.log('🔧 Content script 확인 중...');
    await ensureContentScript(targetTab.id);

    // 추가 대기 (DOM 렌더링 완료)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. 폼 작성 메시지 전송
    console.log('📝 쉽먼트 폼 작성 요청 중...');
    const response = await sendMessageWithTimeout(targetTab.id, {
      action: 'fillShipmentForm',
      shipmentData: shipmentData
    }, 120000); // 2분 타임아웃 (업로드 처리 시간 고려)

    console.log('✅ 쉽먼트 업로드 응답:', response);
    return response || { success: true, message: '쉽먼트 업로드 완료' };

  } catch (error) {
    console.error('❌ 쉽먼트 업로드 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 타임아웃이 적용된 메시지 전송
 */
function sendMessageWithTimeout(tabId, message, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('메시지 응답 타임아웃'));
    }, timeout);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * 쉽먼트 번호 검색 핸들러
 * 발주번호로 쉽먼트 번호 조회
 */
async function handleSearchShipmentNumber(poNumber) {
  console.log('🔍 쉽먼트 번호 검색 시작:', poNumber);

  try {
    // 1. 쿠팡 탭 찾기 또는 생성
    const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/*' });
    let targetTab;

    if (tabs.length === 0) {
      console.log('⚠️ 쿠팡 탭이 없습니다. 새 탭 생성...');
      targetTab = await chrome.tabs.create({
        url: 'https://supplier.coupang.com/ibs/shipment/parcel/search'
      });
      await waitForTabLoad(targetTab.id);
    } else {
      targetTab = tabs[0];
      console.log('✅ 쿠팡 탭 발견:', targetTab.id);
    }

    // 2. Content script 주입 확인
    await ensureContentScript(targetTab.id);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. 쉽먼트 번호 검색 메시지 전송
    const response = await sendMessageWithTimeout(targetTab.id, {
      action: 'searchShipmentNumber',
      poNumber: poNumber
    }, 30000);

    console.log('✅ 쉽먼트 번호 검색 응답:', response);
    return response || { success: false, error: '응답 없음' };

  } catch (error) {
    console.error('❌ 쉽먼트 번호 검색 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 쉽먼트 목록 조회 핸들러
 */
async function handleGetShipmentList(filters = {}) {
  console.log('📋 쉽먼트 목록 조회 시작:', filters);

  try {
    // 1. 쿠팡 탭 찾기 또는 생성
    const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/*' });
    let targetTab;

    if (tabs.length === 0) {
      console.log('⚠️ 쿠팡 탭이 없습니다. 새 탭 생성...');
      targetTab = await chrome.tabs.create({
        url: 'https://supplier.coupang.com/ibs/shipment/parcel/search'
      });
      await waitForTabLoad(targetTab.id);
    } else {
      targetTab = tabs[0];
      console.log('✅ 쿠팡 탭 발견:', targetTab.id);
    }

    // 2. Content script 주입 확인
    await ensureContentScript(targetTab.id);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. 쉽먼트 목록 조회 메시지 전송
    const response = await sendMessageWithTimeout(targetTab.id, {
      action: 'getShipmentList',
      filters: filters
    }, 30000);

    console.log('✅ 쉽먼트 목록 조회 응답:', response);
    return response || { success: false, error: '응답 없음' };

  } catch (error) {
    console.error('❌ 쉽먼트 목록 조회 오류:', error);
    return { success: false, error: error.message, shipments: [] };
  }
}

/**
 * 쉽먼트 액션 범용 핸들러 (라벨/내역서 다운로드, 후처리 등)
 */
async function handleShipmentAction(action, params) {
  console.log(`🚚 쉽먼트 액션 시작: ${action}`, params);

  try {
    // 1. 쿠팡 탭 찾기 또는 생성
    const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/*' });
    let targetTab;

    if (tabs.length === 0) {
      console.log('⚠️ 쿠팡 탭이 없습니다. 새 탭 생성...');
      targetTab = await chrome.tabs.create({
        url: 'https://supplier.coupang.com/ibs/asn/active'
      });
      await waitForTabLoad(targetTab.id);
    } else {
      targetTab = tabs[0];
      console.log('✅ 쿠팡 탭 발견:', targetTab.id);
    }

    // 2. Content script 주입 확인
    await ensureContentScript(targetTab.id);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. 메시지 전송 (2분 타임아웃 - 여러 건 처리 시 시간 소요)
    const message = { action: action, ...params };
    const response = await sendMessageWithTimeout(targetTab.id, message, 120000);

    console.log(`✅ 쉽먼트 액션 완료: ${action}`, response);
    return response || { success: false, error: '응답 없음' };

  } catch (error) {
    console.error(`❌ 쉽먼트 액션 오류: ${action}`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 탭 로드 완료 대기
 */
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkLoaded = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (tab.status === 'complete') {
          // 추가 대기 (DOM 로드 완료 + SPA 렌더링을 위해 5초)
          setTimeout(resolve, 5000);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error('Tab load timeout'));
        } else {
          setTimeout(checkLoaded, 500);
        }
      });
    };

    // onUpdated 리스너 사용
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // 추가 대기 (DOM 로드 완료를 위해)
        setTimeout(resolve, 2000);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // 타임아웃 설정
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      // 타임아웃이어도 일단 진행
      resolve();
    }, timeout);
  });
}

/**
 * 쿠팡 가격 수집 처리
 * 브라우저 탭을 열어서 직접 검색 결과를 파싱
 * options.incognito: true면 시크릿 모드로 검색
 */
async function handleCollectCoupangPrices(keyword, options = {}) {
  console.log('💰 쿠팡 가격 수집 시작:', keyword, options.incognito ? '(시크릿 모드)' : '');

  if (!keyword || keyword.trim() === '') {
    return { success: false, error: '검색 키워드가 필요합니다.' };
  }

  let priceTab = null;
  let incognitoWindow = null;

  try {
    // 쿠팡 검색 URL 생성
    const searchUrl = `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(keyword)}&channel=user`;

    // 시크릿 모드로 열기 옵션
    if (options.incognito) {
      try {
        // 먼저 시크릿 모드 허용 여부 확인
        const isAllowedIncognito = await chrome.extension.isAllowedIncognitoAccess();
        console.log('🔒 시크릿 모드 허용 여부:', isAllowedIncognito);

        if (!isAllowedIncognito) {
          throw new Error('시크릿 모드가 허용되지 않았습니다. 확장 프로그램 설정에서 "시크릿 모드에서 허용"을 켜주세요.');
        }

        // 시크릿 윈도우 생성
        const newWindow = await chrome.windows.create({
          url: searchUrl,
          incognito: true,
          focused: false,
          state: 'minimized'
        });

        console.log('🔒 시크릿 윈도우 생성 결과:', newWindow);

        // window 자체가 null인지 확인
        if (!newWindow || !newWindow.id) {
          throw new Error('시크릿 윈도우를 생성할 수 없습니다. (newWindow: ' + JSON.stringify(newWindow) + ')');
        }

        incognitoWindow = newWindow.id;

        // 탭 정보가 바로 안 올 수 있으므로 확인
        if (newWindow.tabs && newWindow.tabs.length > 0 && newWindow.tabs[0] && newWindow.tabs[0].id) {
          priceTab = newWindow.tabs[0].id;
        } else {
          // 탭이 없으면 잠시 대기 후 윈도우의 탭을 조회
          await new Promise(resolve => setTimeout(resolve, 500));
          const tabs = await chrome.tabs.query({ windowId: incognitoWindow });
          if (tabs && tabs.length > 0 && tabs[0].id) {
            priceTab = tabs[0].id;
          } else {
            throw new Error('시크릿 모드에서 탭을 생성할 수 없습니다. 확장 프로그램 설정에서 "시크릿 모드에서 허용"을 체크해주세요.');
          }
        }
        console.log('🔒 시크릿 모드 쿠팡 검색 탭 열림:', priceTab);
      } catch (incognitoError) {
        console.error('시크릿 모드 오류:', incognitoError);
        // 시크릿 모드 실패 시 일반 모드로 폴백
        console.log('⚠️ 시크릿 모드 실패, 일반 모드로 전환');

        // 실패한 시크릿 윈도우 정리
        if (incognitoWindow) {
          try { await chrome.windows.remove(incognitoWindow); } catch(e) {}
        }
        incognitoWindow = null;

        const tab = await chrome.tabs.create({
          url: searchUrl,
          active: false
        });
        priceTab = tab.id;
        console.log('🌐 쿠팡 검색 탭 열림 (폴백):', priceTab);
      }
    } else {
      // 일반 탭 열기
      const tab = await chrome.tabs.create({
        url: searchUrl,
        active: false // 백그라운드에서 열기
      });
      priceTab = tab.id;
      console.log('🌐 쿠팡 검색 탭 열림:', priceTab);
    }

    // 페이지 로딩 완료 대기
    await waitForTabLoad(priceTab, 15000);

    // 동적 콘텐츠 로딩 대기 - 쿠팡은 JavaScript로 상품을 로드하므로 충분히 기다림
    console.log('⏳ 동적 콘텐츠 로딩 대기 중...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 페이지 내용 확인 (디버깅용)
    const pageCheck = await chrome.scripting.executeScript({
      target: { tabId: priceTab },
      func: () => {
        return {
          url: window.location.href,
          title: document.title,
          bodyLength: document.body ? document.body.innerHTML.length : 0,
          hasSearchResults: document.querySelector('.search-product-list') !== null ||
                           document.querySelector('[class*="search-product"]') !== null ||
                           document.querySelector('[data-product-id]') !== null,
          productCount: document.querySelectorAll('li.search-product, [class*="search-product"], [data-product-id]').length
        };
      }
    });

    if (pageCheck && pageCheck[0] && pageCheck[0].result) {
      console.log('📋 페이지 상태:', pageCheck[0].result);

      // 검색 결과가 아직 없으면 추가 대기
      if (!pageCheck[0].result.hasSearchResults && pageCheck[0].result.productCount === 0) {
        console.log('⏳ 검색 결과 로딩 추가 대기...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // 가격 정보 추출 스크립트 실행
    const results = await chrome.scripting.executeScript({
      target: { tabId: priceTab },
      func: extractCoupangPrices
    });

    // 시크릿 윈도우면 윈도우 전체 닫기, 아니면 탭만 닫기
    if (incognitoWindow) {
      try {
        await chrome.windows.remove(incognitoWindow);
        console.log('🗑️ 시크릿 윈도우 닫힘:', incognitoWindow);
      } catch (e) {
        console.error('시크릿 윈도우 닫기 실패:', e);
      }
      incognitoWindow = null;
    } else if (priceTab) {
      try {
        await chrome.tabs.remove(priceTab);
        console.log('🗑️ 가격 수집 탭 닫힘:', priceTab);
      } catch (e) {
        console.error('탭 닫기 실패:', e);
      }
    }
    priceTab = null;

    if (results && results[0] && results[0].result) {
      const priceData = results[0].result;
      console.log('✅ 가격 수집 완료:', priceData);
      return {
        success: true,
        keyword: keyword,
        ...priceData
      };
    } else {
      return {
        success: false,
        error: '가격 정보를 추출할 수 없습니다.'
      };
    }

  } catch (error) {
    console.error('❌ 가격 수집 오류:', error);

    // 오류 발생 시 정리
    if (incognitoWindow) {
      try {
        await chrome.windows.remove(incognitoWindow);
      } catch (e) {
        // 윈도우가 이미 닫혔을 수 있음
      }
    } else if (priceTab) {
      try {
        await chrome.tabs.remove(priceTab);
      } catch (e) {
        // 탭이 이미 닫혔을 수 있음
      }
    }

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 쿠팡 검색 결과 페이지에서 가격 추출 (개선된 버전)
 * - 배송 타입별 분류
 * - IQR 방법으로 이상치 제거
 * (chrome.scripting.executeScript에서 실행됨)
 */
function extractCoupangPrices() {
  const products = [];

  // 디버깅: 페이지 상태 확인
  console.log('🔍 페이지 URL:', window.location.href);
  console.log('🔍 페이지 타이틀:', document.title);
  console.log('🔍 body 길이:', document.body ? document.body.innerHTML.length : 0);

  // 검색 결과에서 상품 요소들 찾기 (여러 셀렉터 시도)
  const selectors = [
    '.search-product-list li[class*="search-product"]',
    '#productList li.search-product',
    'ul.search-product-list > li',
    '[class*="search-product"]',
    '[data-product-id]',
    '.baby-product, .product-item, [class*="ProductItem"]',
    'li.search-product',
    'a[href*="/products/"]',
    // 새로운 쿠팡 UI 셀렉터
    '[class*="SearchResult"] li',
    '[class*="productList"] li',
    '.search-content li'
  ];

  let productElements = [];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    console.log(`🔍 셀렉터 "${selector}": ${elements.length}개`);
    if (elements.length > 0 && productElements.length === 0) {
      productElements = elements;
    }
  }

  console.log('🔍 최종 선택된 상품 수:', productElements.length);

  productElements.forEach((product, index) => {
    if (index >= 50) return; // 최대 50개 수집

    try {
      // 가격 추출 (여러 셀렉터 시도)
      let priceNum = 0;
      const priceSelectors = [
        '.price-value',
        'strong.price-value',
        '.base-price',
        '.price em',
        '.discount-price strong',
        '[class*="price"] strong',
        '[data-log-actionid-label="price"] strong'
      ];

      for (const selector of priceSelectors) {
        const priceEl = product.querySelector(selector);
        if (priceEl) {
          const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
          priceNum = parseInt(priceText, 10);
          if (priceNum > 0) break;
        }
      }

      // 가격이 없거나 비정상적인 경우 스킵
      if (priceNum < 1000 || priceNum > 50000000) return;

      // 배송 타입 확인
      let deliveryType = 'general'; // 기본: 일반배송
      const deliveryBadge = product.querySelector('.badge-delivery, [class*="rocket"], [class*="Rocket"]');
      const badgeImg = product.querySelector('img[src*="rocket"], img[alt*="로켓"]');

      if (badgeImg) {
        const src = badgeImg.src || '';
        const alt = badgeImg.alt || '';
        if (src.includes('rocket_logo') || alt.includes('로켓배송')) {
          deliveryType = 'rocket';
        } else if (src.includes('rocket_wow') || alt.includes('로켓와우')) {
          deliveryType = 'rocketWow';
        } else if (src.includes('global') || alt.includes('직구')) {
          deliveryType = 'global';
        } else if (src.includes('seller') || alt.includes('판매자')) {
          deliveryType = 'sellerRocket';
        }
      }

      // 광고 여부 확인
      const isAd = product.querySelector('[class*="ad-badge"], [class*="adBadge"]') !== null ||
                   product.querySelector('span.ad-label') !== null;

      products.push({
        price: priceNum,
        deliveryType: deliveryType,
        isAd: isAd
      });

    } catch (e) {
      console.error('상품 파싱 오류:', e);
    }
  });

  console.log('📦 파싱된 상품:', products.length);

  // 상품을 못 찾은 경우 직접 가격 텍스트 스캔
  if (products.length === 0) {
    console.log('⚠️ 상품 요소 못 찾음, 가격 텍스트 직접 스캔...');

    // 디버깅: HTML 구조 일부 출력
    const bodySnippet = document.body ? document.body.innerHTML.substring(0, 2000) : '';
    console.log('🔍 HTML 미리보기:', bodySnippet);

    // 페이지 전체에서 가격 패턴 찾기 - 더 넓은 범위
    const priceSelectors = [
      '[class*="price"]', '[class*="Price"]',
      '[class*="amount"]', '[class*="Amount"]',
      '[class*="cost"]', '[class*="Cost"]',
      'strong', 'em', 'span'
    ];

    let allPriceElements = [];
    for (const sel of priceSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        allPriceElements = [...allPriceElements, ...els];
      }
    }
    console.log('🔍 가격 관련 요소:', allPriceElements.length);

    const seenPrices = new Set();
    allPriceElements.forEach((el, idx) => {
      if (idx >= 500) return;
      const text = el.textContent || '';
      // 가격 패턴: 숫자,숫자원 또는 숫자,숫자 (한국 원화)
      const matches = text.match(/(\d{1,3}(,\d{3})+|\d{4,})\s*원?/g);
      if (matches) {
        matches.forEach(match => {
          const priceNum = parseInt(match.replace(/[^0-9]/g, ''), 10);
          // 합리적인 가격 범위
          if (priceNum >= 1000 && priceNum <= 50000000) {
            // 중복 방지
            if (!seenPrices.has(priceNum)) {
              seenPrices.add(priceNum);
              products.push({
                price: priceNum,
                deliveryType: 'general',
                isAd: false
              });
            }
          }
        });
      }
    });

    console.log('📦 텍스트 스캔으로 찾은 가격:', products.length);
  }

  if (products.length === 0) {
    // 최후의 디버깅 정보
    console.log('❌ 가격을 찾을 수 없음');
    console.log('🔍 body 존재:', !!document.body);
    console.log('🔍 검색 결과 영역:', document.querySelector('#searchResults, .search-results, [class*="search"]'));
    console.log('🔍 로딩 인디케이터:', document.querySelector('[class*="loading"], [class*="spinner"]'));

    return {
      found: false,
      all: { status: 'no_data', totalItems: 0 },
      debug: {
        url: window.location.href,
        title: document.title,
        bodyLength: document.body ? document.body.innerHTML.length : 0
      }
    };
  }

  // 광고 제외한 상품만
  const nonAdProducts = products.filter(p => !p.isAd);
  const allPrices = (nonAdProducts.length > 0 ? nonAdProducts : products).map(p => p.price);

  // IQR 방법으로 이상치 제거
  function removeOutliers(prices) {
    if (prices.length < 4) return prices;

    const sorted = [...prices].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    const lowerBound = q1 - iqr * 1.5;
    const upperBound = q3 + iqr * 1.5;

    return sorted.filter(p => p >= lowerBound && p <= upperBound);
  }

  // 통계 계산 함수
  function calcStats(prices) {
    if (prices.length === 0) {
      return { status: 'no_data', totalItems: 0 };
    }

    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const average = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);

    return {
      status: 'success',
      min,
      max,
      average,
      median,
      totalItems: prices.length
    };
  }

  // 이상치 제거된 가격으로 통계 계산
  const cleanedPrices = removeOutliers(allPrices);
  const allStats = calcStats(cleanedPrices);

  // 배송 타입별 통계 (옵션)
  const rocketPrices = nonAdProducts.filter(p => p.deliveryType === 'rocket').map(p => p.price);
  const rocketStats = calcStats(removeOutliers(rocketPrices));

  console.log('📊 가격 통계:', {
    원본: allPrices.length,
    이상치제거: cleanedPrices.length,
    로켓: rocketPrices.length
  });

  return {
    found: true,
    all: allStats,
    rocket: rocketStats.totalItems > 0 ? rocketStats : { status: 'no_data', totalItems: 0 },
    rawCount: products.length,
    adCount: products.filter(p => p.isAd).length
  };
}

/**
 * 1688 일괄 수집 핸들러
 * 카테고리별로 1688 검색 → 상품 링크 추출 → 개별 상품 수집 → AI 편집 → 저장
 */
async function handleBatch1688Collect(categories, sender) {
  console.log('📦 1688 일괄 수집 시작:', categories?.length, '개 카테고리');

  const results = {
    success: true,
    totalCategories: categories?.length || 0,
    completedCategories: 0,
    totalProducts: 0,
    completedProducts: 0,
    errors: []
  };

  // 프로그레스 업데이트 함수 (웹페이지로 전송)
  async function updateProgress(progress) {
    try {
      // localhost 탭 찾기
      const tabs = await chrome.tabs.query({ url: '*://localhost:*/*' });
      if (tabs.length > 0) {
        for (const tab of tabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: 'batchCollectProgress',
              progress: progress
            });
          } catch (e) {
            // 메시지 전송 실패 무시
          }
        }
      }
    } catch (e) {
      console.log('⚠️ 프로그레스 업데이트 실패:', e.message);
    }
  }

  try {
    if (!categories || categories.length === 0) {
      throw new Error('수집할 카테고리가 없습니다.');
    }

    // 각 카테고리 처리
    for (let catIdx = 0; catIdx < categories.length; catIdx++) {
      const category = categories[catIdx];
      console.log(`\n📂 [${catIdx + 1}/${categories.length}] 카테고리 처리 시작:`, category.categoryName);

      await updateProgress({
        type: 'category_start',
        categoryIndex: catIdx,
        categoryName: category.categoryName,
        totalCategories: categories.length
      });

      try {
        // 1. 1688 검색 페이지 열기
        const searchUrl = category.url;
        console.log('🔗 1688 검색 URL:', searchUrl);

        const searchTab = await chrome.tabs.create({
          url: searchUrl,
          active: false  // 백그라운드에서 열기
        });

        // 페이지 로드 대기
        await waitForTabLoad(searchTab.id);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 추가 대기

        // 2. Content script 주입 및 상품 링크 추출
        console.log('📋 상품 목록 추출 중...');

        try {
          await chrome.scripting.executeScript({
            target: { tabId: searchTab.id },
            files: ['content/content-full.js']
          });
        } catch (e) {
          console.log('⚠️ Content script 주입 경고:', e.message);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // 상품 목록 추출
        const listResponse = await sendMessageWithTimeout(searchTab.id, {
          action: 'extractProductData'
        }, 30000);

        // 검색 탭 닫기
        try {
          await chrome.tabs.remove(searchTab.id);
        } catch (e) {
          console.log('⚠️ 검색 탭 닫기 실패:', e.message);
        }

        if (!listResponse || !listResponse.success || !listResponse.data?.results) {
          console.log('⚠️ 상품 목록 추출 실패:', listResponse?.error);
          results.errors.push({
            category: category.categoryName,
            error: listResponse?.error || '상품 목록을 추출할 수 없습니다.'
          });
          results.completedCategories++;
          continue;
        }

        const productLinks = listResponse.data.results;
        const collectCount = Math.min(category.productCount || 10, productLinks.length);

        console.log(`✅ 상품 ${productLinks.length}개 발견, ${collectCount}개 수집 예정`);

        await updateProgress({
          type: 'products_found',
          categoryIndex: catIdx,
          categoryName: category.categoryName,
          foundCount: productLinks.length,
          collectCount: collectCount
        });

        // 3. 각 상품 수집
        for (let prodIdx = 0; prodIdx < collectCount; prodIdx++) {
          const productInfo = productLinks[prodIdx];
          const productUrl = productInfo.link;

          console.log(`\n  🛍️ [${prodIdx + 1}/${collectCount}] 상품 수집:`, productUrl?.substring(0, 50) + '...');

          await updateProgress({
            type: 'product_start',
            categoryIndex: catIdx,
            categoryName: category.categoryName,
            productIndex: prodIdx,
            totalProducts: collectCount,
            productUrl: productUrl
          });

          try {
            // 상품 페이지 열기
            const productTab = await chrome.tabs.create({
              url: productUrl,
              active: false
            });

            await waitForTabLoad(productTab.id);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Content script 주입
            try {
              await chrome.scripting.executeScript({
                target: { tabId: productTab.id },
                files: ['content/content-full.js']
              });
            } catch (e) {
              console.log('⚠️ Content script 주입 경고:', e.message);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            // 상품 데이터 추출
            const productResponse = await sendMessageWithTimeout(productTab.id, {
              action: 'extractProductData'
            }, 30000);

            // 상품 탭 닫기
            try {
              await chrome.tabs.remove(productTab.id);
            } catch (e) {
              console.log('⚠️ 상품 탭 닫기 실패:', e.message);
            }

            if (!productResponse || !productResponse.success || !productResponse.data) {
              console.log('⚠️ 상품 추출 실패:', productResponse?.error);
              await updateProgress({
                type: 'product_error',
                categoryIndex: catIdx,
                productIndex: prodIdx,
                error: productResponse?.error || '상품 데이터 추출 실패'
              });
              continue;
            }

            // 4. 서버에 상품 저장
            console.log('  💾 상품 저장 중...');
            const productData = productResponse.data;
            productData.categoryPath = category.categoryPath;
            productData.categoryName = category.categoryName;
            productData.priceType = category.priceType;

            const saveResponse = await fetchFromAuthTab(
              'http://localhost:4000/api/products/save',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData)
              }
            );

            if (!saveResponse || !saveResponse.success) {
              console.log('⚠️ 상품 저장 실패:', saveResponse?.error);
              await updateProgress({
                type: 'product_error',
                categoryIndex: catIdx,
                productIndex: prodIdx,
                error: saveResponse?.error || '상품 저장 실패'
              });
              continue;
            }

            const savedProductId = saveResponse.id;
            console.log('  ✅ 상품 저장 완료, ID:', savedProductId);

            // 5. AI 자동 편집
            console.log('  🤖 AI 자동 편집 중...');
            await updateProgress({
              type: 'ai_processing',
              categoryIndex: catIdx,
              productIndex: prodIdx,
              productId: savedProductId
            });

            const aiResponse = await fetchFromAuthTab(
              `http://localhost:4000/api/products/${savedProductId}/ai-auto-edit`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              }
            );

            if (!aiResponse || !aiResponse.success) {
              console.log('⚠️ AI 편집 실패 (계속 진행):', aiResponse?.error);
            } else {
              console.log('  ✅ AI 편집 완료');
            }

            results.completedProducts++;

            await updateProgress({
              type: 'product_complete',
              categoryIndex: catIdx,
              productIndex: prodIdx,
              productId: savedProductId,
              aiSuccess: aiResponse?.success || false
            });

          } catch (productError) {
            console.error('  ❌ 상품 처리 오류:', productError.message);
            await updateProgress({
              type: 'product_error',
              categoryIndex: catIdx,
              productIndex: prodIdx,
              error: productError.message
            });
          }

          // 요청 간 딜레이 (서버 부하 방지)
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        results.totalProducts += collectCount;
        results.completedCategories++;

        await updateProgress({
          type: 'category_complete',
          categoryIndex: catIdx,
          categoryName: category.categoryName,
          productsCollected: collectCount
        });

      } catch (categoryError) {
        console.error(`❌ 카테고리 처리 오류 [${category.categoryName}]:`, categoryError.message);
        results.errors.push({
          category: category.categoryName,
          error: categoryError.message
        });
        results.completedCategories++;
      }
    }

    // 완료 알림
    await updateProgress({
      type: 'complete',
      results: results
    });

    console.log('\n✅ 1688 일괄 수집 완료:', results);
    return results;

  } catch (error) {
    console.error('❌ 1688 일괄 수집 오류:', error);
    results.success = false;
    results.errors.push({ error: error.message });

    await updateProgress({
      type: 'error',
      error: error.message
    });

    return results;
  }
}

/**
 * 인증된 탭에서 fetch 실행 (localhost 서버 API 호출용)
 */
async function fetchFromAuthTab(url, options = {}) {
  try {
    // localhost 탭 찾기
    const tabs = await chrome.tabs.query({ url: '*://localhost:*/*' });

    if (tabs.length === 0) {
      console.log('⚠️ localhost 탭이 없습니다.');
      return null;
    }

    const targetTab = tabs[0];

    // 탭에서 fetch 실행
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: async (fetchUrl, fetchOptions) => {
        try {
          const response = await fetch(fetchUrl, {
            method: fetchOptions.method || 'GET',
            headers: fetchOptions.headers || {},
            body: fetchOptions.body,
            credentials: 'include'
          });
          return await response.json();
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      args: [url, options]
    });

    return results?.[0]?.result;
  } catch (error) {
    console.error('❌ fetchFromAuthTab 오류:', error);
    return { success: false, error: error.message };
  }
}
