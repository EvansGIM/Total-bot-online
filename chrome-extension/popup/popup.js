/**
 * TotalBot Popup UI Script
 */

// 서버 URL 설정
const SERVER_URL = 'https://totalbot.cafe24.com/node-api';

// 인증 헤더 포함 fetch 함수
async function authFetch(url, options = {}) {
  const result = await chrome.storage.local.get(['authToken']);
  const token = result.authToken;

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

// DOM 요소
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const userNameEl = document.getElementById('user-name');
const userGradeEl = document.getElementById('user-grade');

// 탭 버튼
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// 상품 수집 버튼
const crawlCurrentBtn = document.getElementById('crawl-current-btn');
const editImagesBtn = document.getElementById('edit-images-btn');
const editOptionsBtn = document.getElementById('edit-options-btn');
const crawlStatus = document.getElementById('crawl-status');

// 상태 탭
const statusTabBtns = document.querySelectorAll('.status-tab-btn');
const productListEl = document.getElementById('product-list');

// 상품 데이터 캐시
let allProducts = [];
let currentStatusFilter = 'all';

// 발주 처리 버튼
const uploadOrderBtn = document.getElementById('upload-order-btn');
const processOrderBtn = document.getElementById('process-order-btn');
const orderStatus = document.getElementById('order-status');

// 정산 버튼
const uploadSettlementBtn = document.getElementById('upload-settlement-btn');
const calculateSettlementBtn = document.getElementById('calculate-settlement-btn');
const settlementStatus = document.getElementById('settlement-status');

// 설정 버튼
const coupangIdInput = document.getElementById('coupang-id');
const coupangPwInput = document.getElementById('coupang-pw');
const businessNumberInput = document.getElementById('business-number');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsStatus = document.getElementById('settings-status');

// 초기화
init();

async function init() {
  // 인증 토큰 확인
  const result = await chrome.storage.local.get(['authToken', 'userInfo']);

  if (result.authToken && result.userInfo) {
    // 로그인 상태
    showMainScreen(result.userInfo);
    // 상품 목록 로드
    loadProductList();
  } else {
    // 로그아웃 상태
    showLoginScreen();
  }

  // 설정 로드
  loadSettings();

  // 상태 탭 이벤트
  setupStatusTabs();
}

// 로그인 화면 표시
function showLoginScreen() {
  loginScreen.style.display = 'block';
  mainScreen.style.display = 'none';
}

// 메인 화면 표시
function showMainScreen(userInfo) {
  loginScreen.style.display = 'none';
  mainScreen.style.display = 'block';

  // 사용자 정보 표시
  userNameEl.textContent = userInfo.name || '사용자';
  userGradeEl.textContent = userInfo.grade === 'premium' ? 'Premium' : 'Basic';
  userGradeEl.className = userInfo.grade === 'premium' ? 'badge premium' : 'badge';
}

// 로그인
loginBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    loginError.textContent = '아이디와 비밀번호를 입력하세요.';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '로그인 중...';
  loginError.textContent = '';

  try {
    const response = await sendMessage({
      action: 'login',
      data: { username, password }
    });

    if (response.success) {
      showMainScreen(response.user);
    } else {
      loginError.textContent = response.error || '로그인 실패';
    }
  } catch (error) {
    loginError.textContent = '서버 연결 실패';
    console.error('로그인 오류:', error);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '로그인';
  }
});

// 로그아웃
logoutBtn.addEventListener('click', async () => {
  const response = await sendMessage({ action: 'logout' });
  if (response.success) {
    showLoginScreen();
    usernameInput.value = '';
    passwordInput.value = '';
  }
});

// 탭 전환
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.tab;

    // 모든 탭 비활성화
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    // 선택한 탭 활성화
    btn.classList.add('active');
    document.getElementById(`${targetTab}-tab`).classList.add('active');
  });
});

// 현재 페이지 상품 수집
crawlCurrentBtn.addEventListener('click', async () => {
  crawlStatus.innerHTML = '<p>⏳ 상품 데이터 수집 중...</p>';
  crawlCurrentBtn.disabled = true;

  try {
    // 현재 활성 탭 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id) {
      throw new Error('탭을 찾을 수 없습니다.');
    }

    // 페이지 유형 확인
    const pageType = detectPageType(tab.url);
    if (!pageType.includes('product')) {
      throw new Error('상품 페이지에서 실행해주세요.');
    }

    crawlStatus.innerHTML = '<p>⏳ 데이터 추출 중...</p>';

    // Background에 크롤링 요청
    const response = await sendMessage({
      action: 'crawlProduct',
      tabId: tab.id
    });

    if (response.success && response.data) {
      const productData = response.data;
      const results = productData.results || [];

      // 데이터 저장은 Background에서 이미 처리

      // 결과 표시
      let resultsHtml = `
        <p class="success">✅ 수집 완료!</p>
        <p><strong>${productData.title || '상품'}</strong></p>
      `;

      if (results.length > 0) {
        resultsHtml += `<p>📦 수집된 항목: ${results.length}개</p>`;
      }

      crawlStatus.innerHTML = resultsHtml;

      // 상품 목록 새로고침
      loadProductList();

    } else {
      crawlStatus.innerHTML = `<p class="error">❌ ${response.error || '수집 실패'}</p>`;
    }
  } catch (error) {
    crawlStatus.innerHTML = `<p class="error">❌ ${error.message}</p>`;
    console.error('크롤링 오류:', error);
  } finally {
    crawlCurrentBtn.disabled = false;
  }
});

// 페이지 유형 감지 함수
function detectPageType(url) {
  if (!url) return 'unknown';

  if (url.includes('1688.com')) {
    if (url.includes('/offer/') || url.includes('detail.1688.com')) {
      return '1688-product';
    }
    return '1688-other';
  } else if (url.includes('coupang.com')) {
    if (url.includes('/vp/products/')) {
      return 'coupang-product';
    }
    return 'coupang-other';
  } else if (url.includes('aliexpress.com')) {
    if (url.includes('/item/')) {
      return 'aliexpress-product';
    }
    return 'aliexpress-other';
  }

  return 'unknown';
}

// 이미지 AI 편집 버튼
editImagesBtn.addEventListener('click', async () => {
  crawlStatus.innerHTML = '<p>⏳ 제품 목록 로드 중...</p>';

  try {
    const products = await getCollectedProducts();

    if (products.length === 0) {
      crawlStatus.innerHTML = '<p class="info">수집된 상품이 없습니다. 먼저 상품을 수집해주세요.</p>';
      return;
    }

    // 새 창에서 이미지 편집 페이지 열기
    const url = `${SERVER_URL}/image-editor.html?productId=${products[0].id || 'latest'}`;
    chrome.tabs.create({ url });

    crawlStatus.innerHTML = '<p class="success">✅ 이미지 편집 페이지를 열었습니다.</p>';
  } catch (error) {
    crawlStatus.innerHTML = `<p class="error">❌ ${error.message}</p>`;
    console.error('이미지 편집 오류:', error);
  }
});

// 옵션명 일괄편집 버튼
editOptionsBtn.addEventListener('click', async () => {
  crawlStatus.innerHTML = '<p>⏳ 제품 목록 로드 중...</p>';

  try {
    const products = await getCollectedProducts();

    if (products.length === 0) {
      crawlStatus.innerHTML = '<p class="info">수집된 상품이 없습니다. 먼저 상품을 수집해주세요.</p>';
      return;
    }

    // 새 창에서 옵션명 편집 페이지 열기
    const url = `${SERVER_URL}/option-editor.html?productId=${products[0].id || 'latest'}`;
    chrome.tabs.create({ url });

    crawlStatus.innerHTML = '<p class="success">✅ 옵션명 편집 페이지를 열었습니다.</p>';
  } catch (error) {
    crawlStatus.innerHTML = `<p class="error">❌ ${error.message}</p>`;
    console.error('옵션명 편집 오류:', error);
  }
});

// 발주 파일 업로드 & 처리
uploadOrderBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.multiple = true;  // 여러 파일 선택 가능

  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    orderStatus.innerHTML = `<p>⏳ ${files.length}개 파일 업로드 중...</p>`;
    uploadOrderBtn.disabled = true;
    processOrderBtn.disabled = true;

    try {
      // FormData로 파일 전송
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const response = await sendMessage({
        action: 'uploadOrderFiles',
        formData: formData
      });

      if (response.success) {
        orderStatus.innerHTML = `
          <p class="success">✅ 발주 처리 완료!</p>
          <p>발주: ${response.data.orderCount}건</p>
          <p>쉽먼트 파일: ${response.data.shipmentFiles}개</p>
          ${response.data.failures.length > 0 ? `<p class="error">실패: ${response.data.failures.length}개</p>` : ''}
        `;
      } else {
        orderStatus.innerHTML = `<p class="error">❌ ${response.error}</p>`;
      }
    } catch (error) {
      orderStatus.innerHTML = `<p class="error">❌ ${error.message}</p>`;
      console.error('발주 처리 오류:', error);
    } finally {
      uploadOrderBtn.disabled = false;
      processOrderBtn.disabled = false;
    }
  };

  input.click();
});

// 발주 처리 (기존 로직 유지 - 나중에 사용)
processOrderBtn.addEventListener('click', async () => {
  orderStatus.innerHTML = '<p class="info">💡 "발주서 업로드"를 클릭하여 파일을 선택하세요.</p>';
});

// 정산 파일 업로드
let coupangSettlementFile = null;
let rootlogisFiles = [];

uploadSettlementBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.multiple = false;

  input.onchange = async (e) => {
    coupangSettlementFile = e.target.files[0];
    if (!coupangSettlementFile) return;

    settlementStatus.innerHTML = '<p class="success">✅ 쿠팡 입고내역서 업로드 완료!</p><p class="info">이제 "정산 계산" 버튼을 눌러 루트로지스 파일을 선택하세요.</p>';
  };

  input.click();
});

// 정산 계산
calculateSettlementBtn.addEventListener('click', async () => {
  if (!coupangSettlementFile) {
    settlementStatus.innerHTML = '<p class="error">❌ 먼저 쿠팡 입고내역서를 업로드하세요.</p>';
    return;
  }

  // 루트로지스 파일 선택
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.multiple = true;

  input.onchange = async (e) => {
    rootlogisFiles = Array.from(e.target.files);
    if (rootlogisFiles.length === 0) return;

    settlementStatus.innerHTML = `<p>⏳ 정산 계산 중... (루트로지스 ${rootlogisFiles.length}개 파일)</p>`;
    calculateSettlementBtn.disabled = true;

    try {
      const formData = new FormData();
      formData.append('coupangFile', coupangSettlementFile);
      for (const file of rootlogisFiles) {
        formData.append('rootlogisFiles', file);
      }

      const response = await sendMessage({
        action: 'calculateSettlement',
        formData: formData
      });

      if (response.success) {
        const summary = response.data.summary;
        settlementStatus.innerHTML = `
          <p class="success">✅ 정산 계산 완료!</p>
          <p><strong>매출:</strong> ${summary.매출.toLocaleString()}원</p>
          <p><strong>매입:</strong> ${summary.매입.toLocaleString()}원</p>
          <p><strong>입출고비용:</strong> ${summary.입출고비용.toLocaleString()}원</p>
          <p><strong>순이익:</strong> ${summary.순이익.toLocaleString()}원</p>
          <p><strong>이익률:</strong> ${summary.이익률}</p>
          <p class="info">📊 정산서가 생성되었습니다.</p>
        `;
      } else {
        settlementStatus.innerHTML = `<p class="error">❌ ${response.error}</p>`;
      }
    } catch (error) {
      settlementStatus.innerHTML = `<p class="error">❌ ${error.message}</p>`;
      console.error('정산 계산 오류:', error);
    } finally {
      calculateSettlementBtn.disabled = false;
    }
  };

  input.click();
});

// 설정 저장
saveSettingsBtn.addEventListener('click', async () => {
  const settings = {
    coupang: {
      id: coupangIdInput.value.trim(),
      password: coupangPwInput.value.trim(),
      business_number: businessNumberInput.value.trim()
    }
  };

  try {
    await chrome.storage.local.set({ settings });
    settingsStatus.innerHTML = '<p class="success">✅ 설정 저장 완료!</p>';

    setTimeout(() => {
      settingsStatus.innerHTML = '';
    }, 2000);
  } catch (error) {
    settingsStatus.innerHTML = `<p class="error">❌ 저장 실패</p>`;
  }
});

// 설정 로드
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');

  if (settings && settings.coupang) {
    coupangIdInput.value = settings.coupang.id || '';
    coupangPwInput.value = settings.coupang.password || '';
    businessNumberInput.value = settings.coupang.business_number || '';
  }
}

// 수집된 상품 저장
async function saveCollectedProduct(product) {
  const { collectedProducts } = await chrome.storage.local.get('collectedProducts');
  const products = collectedProducts || [];

  products.push(product);

  await chrome.storage.local.set({ collectedProducts: products });
}

// 수집된 상품 가져오기
async function getCollectedProducts() {
  const { collectedProducts } = await chrome.storage.local.get('collectedProducts');
  return collectedProducts || [];
}

// Background에 메시지 전송 (Promise 래퍼)
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// 상태 탭 이벤트 설정
function setupStatusTabs() {
  statusTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;

      // 모든 탭 비활성화
      statusTabBtns.forEach(b => b.classList.remove('active'));
      // 선택한 탭 활성화
      btn.classList.add('active');

      // 필터 적용
      currentStatusFilter = status;
      renderProductList();
    });
  });
}

// 서버에서 상품 목록 로드
async function loadProductList() {
  try {
    productListEl.innerHTML = '<div class="loading">상품 목록 로딩 중...</div>';

    const response = await authFetch(`${SERVER_URL}/api/products/list`);
    const data = await response.json();

    if (data.success && data.products) {
      allProducts = data.products;
      // 최신순 정렬
      allProducts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
      updateStatusCounts();
      renderProductList();
    } else {
      productListEl.innerHTML = '<div class="empty">상품 목록을 불러올 수 없습니다.</div>';
    }
  } catch (error) {
    console.error('상품 목록 로드 오류:', error);
    productListEl.innerHTML = '<div class="empty">서버에 연결할 수 없습니다.</div>';
  }
}

// 상태별 개수 업데이트
function updateStatusCounts() {
  const counts = {
    all: allProducts.length,
    collected: 0,
    uploaded: 0,
    approved: 0
  };

  allProducts.forEach(p => {
    const status = p.status || 'collected';
    if (counts[status] !== undefined) {
      counts[status]++;
    }
  });

  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-collected').textContent = counts.collected;
  document.getElementById('count-uploaded').textContent = counts.uploaded;
  document.getElementById('count-approved').textContent = counts.approved;
}

// 상품 목록 렌더링
function renderProductList() {
  const filteredProducts = currentStatusFilter === 'all'
    ? allProducts
    : allProducts.filter(p => (p.status || 'collected') === currentStatusFilter);

  if (filteredProducts.length === 0) {
    productListEl.innerHTML = '<div class="empty">상품이 없습니다.</div>';
    return;
  }

  const html = filteredProducts.map(product => {
    const title = product.title || product.titleCn || '제목 없음';
    const status = product.status || 'collected';
    const statusLabel = {
      collected: '수집됨',
      uploaded: '업로드됨',
      approved: '승인됨'
    }[status] || status;

    // 썸네일 이미지
    let thumbUrl = '';
    if (product.mainImage) {
      thumbUrl = product.mainImage;
    } else if (product.results && product.results[0]) {
      const firstResult = product.results[0];
      thumbUrl = firstResult.imageLink ||
        (firstResult.titleImage && firstResult.titleImage[0]) ||
        '';
    }

    // 옵션 개수
    const optionCount = product.results ? product.results.length : 0;

    // 날짜 포맷
    const savedAt = product.savedAt ? new Date(product.savedAt).toLocaleDateString('ko-KR') : '';

    return `
      <div class="product-item" data-id="${product.id}">
        <img class="thumb" src="${thumbUrl}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f0f0f0%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2240%22>📦</text></svg>'">
        <div class="info">
          <div class="title">${title}</div>
          <div class="meta">
            <span>옵션 ${optionCount}개</span>
            <span>${savedAt}</span>
          </div>
        </div>
        <span class="status-badge ${status}">${statusLabel}</span>
      </div>
    `;
  }).join('');

  productListEl.innerHTML = html;

  // 상품 클릭 이벤트
  productListEl.querySelectorAll('.product-item').forEach(item => {
    item.addEventListener('click', () => {
      const productId = item.dataset.id;
      openProductDetail(productId);
    });
  });
}

// 상품 상세 페이지 열기
function openProductDetail(productId) {
  const url = `${SERVER_URL}/image-editor.html?productId=${productId}`;
  chrome.tabs.create({ url });
}
