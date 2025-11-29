/**
 * TotalBot 공통 인증 모듈
 * 모든 페이지에서 로그인 체크를 수행합니다.
 */

const AUTH_API_SERVER = 'https://114.202.247.228';

// 현재 로그인한 사용자 정보
let currentUser = null;

/**
 * 로그인 체크 - 비로그인 시 login.html로 리다이렉트
 * @returns {boolean} 로그인 여부
 */
function checkAuth() {
    const userInfoStr = localStorage.getItem('userInfo');

    if (!userInfoStr) {
        redirectToLogin();
        return false;
    }

    try {
        currentUser = JSON.parse(userInfoStr);
        updateUserDisplay();
        return true;
    } catch (e) {
        console.error('Failed to parse user info:', e);
        redirectToLogin();
        return false;
    }
}

/**
 * 로그인 페이지로 리다이렉트
 */
function redirectToLogin() {
    // 현재 페이지가 login.html이나 register.html이면 리다이렉트하지 않음
    const currentPage = window.location.pathname.split('/').pop();
    if (currentPage === 'login.html' || currentPage === 'register.html' || currentPage === '') {
        return;
    }
    window.location.href = 'login.html';
}

/**
 * 사용자 정보 UI 업데이트
 */
function updateUserDisplay() {
    if (!currentUser) return;

    const userName = currentUser.name || currentUser.username || '사용자';
    const userGrade = currentUser.grade || 'basic';
    const isAdmin = currentUser.is_admin || false;

    const userNameEl = document.getElementById('userName');
    const gradeEl = document.getElementById('userGrade');

    if (userNameEl) {
        userNameEl.textContent = userName;
    }

    if (gradeEl) {
        let gradeText = '일반';
        let gradeClass = 'basic';

        if (isAdmin) {
            gradeText = '관리자';
            gradeClass = 'admin';
        } else if (userGrade === 'premium') {
            gradeText = '프리미엄';
            gradeClass = 'premium';
        } else if (userGrade === 'student') {
            gradeText = '학생';
            gradeClass = 'student';
        }

        gradeEl.textContent = gradeText;
        gradeEl.className = `user-grade ${gradeClass}`;
    }
}

/**
 * 로그아웃
 */
function logout() {
    if (confirm('로그아웃 하시겠습니까?')) {
        localStorage.removeItem('userInfo');
        localStorage.removeItem('username');
        localStorage.removeItem('password');
        window.location.href = 'login.html';
    }
}

/**
 * 현재 사용자 정보 가져오기
 * @returns {Object|null} 사용자 정보
 */
function getCurrentUser() {
    return currentUser;
}

/**
 * 프리미엄 사용자인지 확인
 * @returns {boolean}
 */
function isPremiumUser() {
    if (!currentUser) return false;
    if (currentUser.is_admin) return true;
    return currentUser.grade === 'premium' || currentUser.grade === 'student';
}

/**
 * 관리자인지 확인
 * @returns {boolean}
 */
function isAdminUser() {
    if (!currentUser) return false;
    return currentUser.is_admin === true;
}

/**
 * 기능 사용 가능 여부 확인
 * @param {string} feature - 기능명
 * @returns {boolean}
 */
function canUseFeature(feature) {
    // 프리미엄 전용 기능 목록
    const premiumFeatures = [
        'ai_product_name',
        'auto_order',
        'bulk_upload',
        'settlement'
    ];

    if (premiumFeatures.includes(feature)) {
        return isPremiumUser();
    }

    return true;
}

// 페이지 로드 시 자동 체크 (login, register 페이지 제외)
document.addEventListener('DOMContentLoaded', function() {
    const currentPage = window.location.pathname.split('/').pop();

    // login.html, register.html은 체크 제외
    if (currentPage !== 'login.html' && currentPage !== 'register.html') {
        checkAuth();
    }
});
