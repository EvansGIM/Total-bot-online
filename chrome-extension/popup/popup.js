/**
 * TotalBot Popup - 간단한 UI
 */

const SERVER_URL = 'https://totalbot.cafe24.com/node-api';

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

// 메뉴 버튼들
const menuProducts = document.getElementById('menu-products');
const menuEditor = document.getElementById('menu-editor');
const menuOrders = document.getElementById('menu-orders');
const menuSettings = document.getElementById('menu-settings');
const menuCollect = document.getElementById('menu-collect');

// 초기화
init();

async function init() {
  const result = await chrome.storage.local.get(['authToken', 'userInfo']);

  if (result.authToken && result.userInfo) {
    showMainScreen(result.userInfo);
  } else {
    showLoginScreen();
  }

  setupMenuLinks();
}

function showLoginScreen() {
  loginScreen.style.display = 'flex';
  mainScreen.style.display = 'none';
}

function showMainScreen(userInfo) {
  loginScreen.style.display = 'none';
  mainScreen.style.display = 'block';

  userNameEl.textContent = userInfo.name || '사용자';

  if (userInfo.grade === 'premium') {
    userGradeEl.textContent = 'Premium';
    userGradeEl.className = 'badge premium';
  } else {
    userGradeEl.textContent = 'Basic';
    userGradeEl.className = 'badge';
  }
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
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'login',
        data: { username, password }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
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

// Enter 키로 로그인
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loginBtn.click();
  }
});

usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    passwordInput.focus();
  }
});

// 로그아웃
logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['authToken', 'userInfo']);
  showLoginScreen();
  usernameInput.value = '';
  passwordInput.value = '';
});

// 메뉴 링크 설정
function setupMenuLinks() {
  menuProducts.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${SERVER_URL}/products.html` });
  });

  menuEditor.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${SERVER_URL}/image-editor.html` });
  });

  menuOrders.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${SERVER_URL}/orders.html` });
  });

  menuSettings.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${SERVER_URL}/settings.html` });
  });

  menuCollect.addEventListener('click', (e) => {
    e.preventDefault();
    // 현재 탭이 지원하는 사이트인지 확인하고 수집 시작
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      const url = tab.url || '';

      if (url.includes('1688.com') || url.includes('aliexpress.com') || url.includes('taobao.com')) {
        // 수집 가능한 페이지
        chrome.tabs.sendMessage(tab.id, { action: 'startCrawl' }, (response) => {
          if (chrome.runtime.lastError) {
            alert('이 페이지에서는 수집할 수 없습니다.\n상품 상세 페이지로 이동해주세요.');
          }
        });
        window.close();
      } else {
        alert('1688, AliExpress, 타오바오 상품 페이지에서 수집할 수 있습니다.');
      }
    });
  });
}
