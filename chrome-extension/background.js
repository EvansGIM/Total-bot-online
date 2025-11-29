/**
 * TotalBot Chrome Extension - Background Script
 * 쿠팡 자동 업로드 백그라운드 관리
 */

// JSZip 및 SheetJS 라이브러리 로드
importScripts('lib/jszip.min.js');
importScripts('lib/xlsx.full.min.js');

// 서버 URL 설정
const SERVER_URL = 'https://totalbot.cafe24.com/node-api';

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

let coupangTab = null;
const injectedTabs = new Set(); // 이미 주입된 탭 추적
let excelDataStore = []; // Excel 파일 데이터를 메모리에 저장 (ArrayBuffer)

// 쿠팡 쿠키 자동 삭제 설정
let coupangOperationCount = 0;
const COOKIE_CLEAR_THRESHOLD = 10; // 10번 작업 후 쿠키 삭제

/**
 * 쿠팡 관련 쿠키 삭제
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
let cachedVendorId = null;

/**
 * 자동 승인 확인 시작
 */
function startApprovalChecker() {
  if (approvalCheckerStarted) {
    console.log('⚠️ 승인 확인기가 이미 실행 중입니다.');
    return;
  }

  console.log('🔄 자동 승인 확인 시작 (10분 간격)');
  approvalCheckerStarted = true;

  // 즉시 한 번 실행
  checkUploadedProductsApproval();

  // 10분마다 실행
  setInterval(() => {
    checkUploadedProductsApproval();
  }, APPROVAL_CHECK_INTERVAL);
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

    // 3. 쿠팡 탭 찾기
    const coupangTabId = await findCoupangTab();
    if (!coupangTabId) {
      console.log('⚠️ 쿠팡 탭을 찾을 수 없습니다. 쿠팡에 로그인해주세요.');
      return;
    }

    // 4. vendorId 가져오기
    if (!cachedVendorId) {
      const vendorResult = await chrome.tabs.sendMessage(coupangTabId, {
        action: 'getVendorId'
      });

      if (!vendorResult || !vendorResult.success) {
        console.log('⚠️ vendorId를 가져올 수 없습니다.');
        return;
      }
      cachedVendorId = vendorResult.vendorId;
      console.log('✅ vendorId:', cachedVendorId);
    }

    // 5. 각 견적서 상태 확인
    for (const [quoteId, productIds] of Object.entries(quoteGroups)) {
      console.log(`\n🔍 견적서 ${quoteId} 확인 중...`);

      try {
        const statusResult = await chrome.tabs.sendMessage(coupangTabId, {
          action: 'checkQuotationStatus',
          quotationId: quoteId,
          vendorId: cachedVendorId
        });

        if (statusResult && statusResult.success) {
          console.log(`   📊 결과: ${statusResult.message}`);

          // 승인 완료 시 상태 변경
          if (statusResult.isApproved) {
            console.log(`   ✅ 승인 완료! 상태 업데이트 중...`);
            await updateProductsToApproved(productIds);
          }
        } else {
          console.log(`   ⚠️ 상태 확인 실패: ${statusResult?.error || '알 수 없는 오류'}`);
        }

        // Rate limiting: 2-4초 대기
        await sleep(2000 + Math.random() * 2000);

      } catch (error) {
        console.error(`   ❌ 견적서 ${quoteId} 확인 오류:`, error);
      }
    }

    console.log('\n✅ 자동 승인 상태 확인 완료');

  } catch (error) {
    console.error('❌ 자동 승인 확인 오류:', error);
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
        files: ['content-coupang.js']
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

  // 쿠팡 탭 찾기
  const coupangTabId = await findCoupangTab();
  if (!coupangTabId) {
    throw new Error('쿠팡 탭을 찾을 수 없습니다. supplier.coupang.com에 로그인해주세요.');
  }

  // vendorId 가져오기
  if (!cachedVendorId) {
    const vendorResult = await chrome.tabs.sendMessage(coupangTabId, {
      action: 'getVendorId'
    });

    if (!vendorResult || !vendorResult.success) {
      throw new Error('vendorId를 가져올 수 없습니다. 쿠팡 페이지를 새로고침 해주세요.');
    }
    cachedVendorId = vendorResult.vendorId;
    console.log('✅ vendorId:', cachedVendorId);
  }

  // 각 견적서 상태 확인
  for (const [quoteId, productIds] of Object.entries(quoteGroups)) {
    console.log(`\n🔍 견적서 ${quoteId} 확인 중...`);
    result.checkedCount++;

    try {
      const statusResult = await chrome.tabs.sendMessage(coupangTabId, {
        action: 'checkQuotationStatus',
        quotationId: quoteId,
        vendorId: cachedVendorId
      });

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

      // Rate limiting: 2-4초 대기 (마지막 견적서가 아닌 경우)
      if (Object.keys(quoteGroups).indexOf(quoteId) < quoteIds.length - 1) {
        await sleep(2000 + Math.random() * 2000);
      }

    } catch (error) {
      console.error(`   ❌ 견적서 ${quoteId} 확인 오류:`, error);
    }
  }

  console.log('\n✅ 수동 승인 상태 확인 완료');
  console.log(`   확인된 견적서: ${result.checkedCount}개`);
  console.log(`   승인된 상품: ${result.approvedCount}개`);

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

// 확장 프로그램 시작 시 자동 승인 확인 시작
chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 확장 프로그램 시작됨');
  startApprovalChecker();
});

// 확장 프로그램 설치/업데이트 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('📦 확장 프로그램 설치/업데이트됨');
  startApprovalChecker();
});

// 서비스 워커 활성화 시에도 시작 (MV3 특성상 필요)
startApprovalChecker();

// localhost 탭에 자동으로 content script 주입
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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

// 탭이 닫히면 추적에서 제거
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
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
              files: ['content-coupang.js']
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

  if (message.action === 'fillQuotationExcels') {
    // 견적서 Excel 파일 자동 작성
    incrementCoupangOperation();
    console.log('🎯 EXTERNAL fillQuotationExcels 핸들러 실행됨!');
    console.log('📦 받은 message 객체:', message);
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
  // 1. option의 thumbnail 필드 우선 사용
  if (option && option.thumbnail) {
    const thumbnailUrl = option.thumbnail;
    // URL에서 파일명 생성
    try {
      const url = new URL(thumbnailUrl);
      const pathname = url.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;

      // option_ 또는 set_ 접두사가 없으면 추가
      if (!nameWithoutExt.startsWith('option_') && !nameWithoutExt.startsWith('set_')) {
        return `option_${nameWithoutExt}.png`;
      }
      return `${nameWithoutExt}.png`;
    } catch (e) {
      // URL 파싱 실패 시 원본 반환
      return option.thumbnail;
    }
  }

  // 2. option의 imageLink 필드 사용 (fallback)
  if (option && option.imageLink) {
    try {
      const url = new URL(option.imageLink);
      const pathname = url.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;

      if (!nameWithoutExt.startsWith('option_') && !nameWithoutExt.startsWith('set_')) {
        return `option_${nameWithoutExt}.png`;
      }
      return `${nameWithoutExt}.png`;
    } catch (e) {
      return option.imageLink;
    }
  }

  // 3. product의 mainImage 사용 (fallback)
  if (product && product.mainImage) {
    try {
      const url = new URL(product.mainImage);
      const pathname = url.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;

      if (!nameWithoutExt.startsWith('option_') && !nameWithoutExt.startsWith('set_')) {
        return `option_${nameWithoutExt}.png`;
      }
      return `${nameWithoutExt}.png`;
    } catch (e) {
      return product.mainImage;
    }
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
        { header: '모델명/품번', type: 'fixed', value: '단일상품' },
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

      // 6행에서 필수/선택 읽기, 7행에서 예시 값 읽기
      const requiredFields = {};  // 헤더명 기준 (기존 호환용)
      const requiredByColumn = {};  // 열 번호 기준 (정확한 체크용)
      const exampleValues = {};
      for (let col = 1; col <= 100; col++) {
        const headerCellAddress = XLSX.utils.encode_cell({ r: 4, c: col - 1 }); // 5행
        const requiredCellAddress = XLSX.utils.encode_cell({ r: 5, c: col - 1 }); // 6행
        const exampleCellAddress = XLSX.utils.encode_cell({ r: 6, c: col - 1 }); // 7행

        const headerCell = worksheet[headerCellAddress];
        const requiredCell = worksheet[requiredCellAddress];
        const exampleCell = worksheet[exampleCellAddress];

        if (headerCell && headerCell.v) {
          const headerName = String(headerCell.v).trim().replace(/\n/g, ' ');
          const requiredValue = requiredCell && requiredCell.v ? String(requiredCell.v).trim() : '';
          const exampleValue = exampleCell && exampleCell.v ? String(exampleCell.v).trim() : '';

          requiredFields[headerName] = requiredValue === '필수';
          requiredByColumn[col] = requiredValue === '필수';  // 열 번호로도 저장
          exampleValues[headerName] = exampleValue;
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
        { header: '모델명/품번', type: 'fixed', value: '단일상품' },
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
        { header: '모델명', type: 'productName', value: '' },
        { header: '수량', type: 'fixed', value: '1개' },
        { header: '제조자(수입자)', type: 'fixed', value: '주식회사 라이크존' },
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

      // 필수 칸 체크: 매핑되지 않은 필수 칸 찾기 (로깅용)
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
              example: exampleValues[headerName] || '',
              column: headers[headerName]
            });
          }
        }
      }

      // 필수 칸이 누락되었어도 계속 진행 (autoMappings에 정의되어 있으므로 자동 처리됨)
      if (missingRequiredFields.length > 0) {
        console.log(`   ℹ️  매핑되지 않은 필수 칸 ${missingRequiredFields.length}개:`,
          missingRequiredFields.map(f => f.header).join(', '));
        console.log(`   → autoMappings로 자동 처리됩니다`);
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
              brandName: finalBrandName,
              handlingCare: handlingCare || '해당사항없음',
              season: season || '사계절',
              requiredFields,
              priceSettings
            });

            // 필수가 아닌 필드는 값을 채우지 않음 (열 번호 기준으로 체크)
            const isRequired = requiredByColumn[mapping.column] === true;
            if (!isRequired) {
              // 선택 필드는 스킵
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

              // 중복 헤더가 있으면 다른 열에도 같은 값 작성 (필수인 열만)
              const allCols = headerAllColumns[mapping.header];
              if (allCols && allCols.length > 1) {
                for (const extraCol of allCols) {
                  if (extraCol !== mapping.column && requiredByColumn[extraCol] === true) {
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

              // 필수가 아닌 필드는 값을 채우지 않음 (열 번호 기준으로 체크)
              const isRequired = requiredByColumn[mapping.column] === true;
              if (!isRequired) {
                // 선택 필드는 스킵
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

                // 중복 헤더가 있으면 다른 열에도 같은 값 작성 (필수인 열만)
                const allCols = headerAllColumns[mapping.header];
                if (optIdx === 0 && mapping.header.includes('색상')) {
                  console.log(`      🔍 색상 중복 체크: header="${mapping.header}", allCols=${JSON.stringify(allCols)}`);
                }
                if (allCols && allCols.length > 1) {
                  for (const extraCol of allCols) {
                    if (optIdx === 0 && mapping.header.includes('색상')) {
                      console.log(`         extraCol=${extraCol}, !== mapping.column: ${extraCol !== mapping.column}, requiredByColumn[${extraCol}]=${requiredByColumn[extraCol]}`);
                    }
                    if (extraCol !== mapping.column && requiredByColumn[extraCol] === true) {
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
      throw error; // 에러를 다시 던져서 상위에서 처리할 수 있도록
    }

    // 다운로드할 이미지 목록 수집 (모두 상품 이미지)
    const imagesToDownload = [];

    for (let productIndex = 0; productIndex < products.length; productIndex++) {
      const product = products[productIndex];
      const options = product.results || [];

      // 1. 추가 이미지들 (images 배열) - 상품의 추가 이미지
      if (product.images && Array.isArray(product.images)) {
        product.images.forEach((imgUrl, imgIndex) => {
          if (imgUrl) {
            imagesToDownload.push({
              url: imgUrl,
              filename: `additional_${productIndex + 1}_${imgIndex + 1}.png`,
              type: 'additional',
              productIndex
            });
          }
        });
      }

      // 2. 옵션 이미지들 (대표이미지 파일명으로 사용됨)
      options.forEach((option, optIndex) => {
        const optionImageUrl = option.thumbnail || option.imageLink || option.option1Img;
        if (optionImageUrl) {
          const optionFilename = getOptionImageFilename(option, product, productIndex);
          if (optionFilename) {
            imagesToDownload.push({
              url: optionImageUrl,
              filename: optionFilename,
              type: 'option',
              productIndex,
              optionIndex: optIndex
            });
          }
        }
      });
    }

    console.log(`   📥 총 ${imagesToDownload.length}개 상품 이미지 수집 중...`);

    // 이미지 다운로드 및 productImageBlobs에 추가 (병렬 처리, 최대 5개씩)
    let successCount = 0;
    let failCount = 0;
    const batchSize = 5;

    for (let i = 0; i < imagesToDownload.length; i += batchSize) {
      const batch = imagesToDownload.slice(i, i + batchSize);
      const batchPromises = batch.map(async (imgInfo) => {
        try {
          // 이미지 fetch
          const response = await fetch(imgInfo.url);
          if (!response.ok) {
            console.warn(`   ⚠️  Failed to fetch: ${imgInfo.filename}`);
            return { success: false, filename: imgInfo.filename };
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

    console.log('\n✅ 견적서 자동 작성 완료');

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

      // 3. Excel Blob 데이터 수집 (서버에서 편집된 파일 그대로 사용 - 서식 보존)
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
      console.log('📤 Content script로 업로드 요청 전송...');

      const uploadData = {
        excelFiles: excelFilesData,
        productImages: productImagesData,  // Input #2: 상품 이미지
        labelImages: labelImagesData,      // Input #3: 라벨컷 이미지
        products: products
      };

      const uploadResponse = await chrome.tabs.sendMessage(coupangTabId, {
        action: 'uploadToCoupang',
        data: uploadData
      });

      console.log('✅ 쿠팡 업로드 응답:', uploadResponse);

      if (uploadResponse && uploadResponse.success) {
        console.log(`🎉 쿠팡 업로드 성공! 견적서 ID: ${uploadResponse.quoteId}`);

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

    case 'option1':
      return option1 || '';

    case 'option2':
      return option2 || '';

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
      return getOptionImageFilename(option, product, productIndex);

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
      // 추가 이미지 파일명 (add_ 접두사) - 현재는 빈 값
      return '';

    case 'calc:size_chart_image':
      // 사이즈 차트 이미지 - 선택 사항이면 공란 처리
      // 헤더명: '사이즈차트 이미지 파일명'
      if (requiredFields && requiredFields['사이즈차트 이미지 파일명'] === false) {
        return ''; // 선택이면 공란
      }
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
  // 알림은 선택적으로 사용 (아이콘 없이)
  try {
    chrome.notifications.create({
      type: 'basic',
      title: title,
      message: message
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

    // 쿠팡 OAuth 로그인 URL
    const oauthUrl = 'https://xauth.coupang.com/auth/realms/seller/protocol/openid-connect/auth?' +
      'response_type=code&client_id=supplier-hub&scope=openid&state=abc' +
      '&redirect_uri=https://supplier.coupang.com/login/oauth2/code/keycloak';

    // 이미 열린 쿠팡 탭이 있는지 확인
    if (coupangTab) {
      try {
        await chrome.tabs.get(coupangTab);
        console.log('✅ Existing tab found, reusing:', coupangTab);
      } catch (e) {
        console.log('⚠️ Previous tab closed');
        coupangTab = null;
      }
    }

    // 새 탭 생성 (백그라운드)
    if (!coupangTab) {
      console.log('🌐 Creating new tab for Coupang login...');
      const tab = await chrome.tabs.create({
        url: oauthUrl,
        active: false // 백그라운드에서 실행
      });
      coupangTab = tab.id;
      console.log('✅ Tab created:', coupangTab);
    }

    // 탭 로딩 완료 대기
    await waitForTabLoad(coupangTab);

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
 */
async function handleCategorySearch(keyword) {
  try {
    console.log('🔍 Handling category search:', keyword);

    // 쿠팡 탭 확인 및 생성
    await ensureCoupangTab();

    // 탭 상태 확인
    const tabInfo = await chrome.tabs.get(coupangTab);
    console.log('📍 Tab info before sendMessage:', {
      id: coupangTab,
      url: tabInfo.url,
      status: tabInfo.status
    });

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
    return response;

  } catch (error) {
    console.error('❌ Category search error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      coupangTab: coupangTab
    });
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
      files: ['content-coupang.js']
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
