/**
 * TotalBot Popup - 간단한 UI
 */

const SERVER_URL = 'https://totalbot.cafe24.com';

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
const menuOrders = document.getElementById('menu-orders');
const menu1688 = document.getElementById('menu-1688');

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

// 웹 로그인 페이지 열기
document.getElementById('web-login-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: `${SERVER_URL}/login.html` });
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

  menuOrders.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${SERVER_URL}/orders.html` });
  });

  menu1688.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://www.1688.com/' });
  });
}
