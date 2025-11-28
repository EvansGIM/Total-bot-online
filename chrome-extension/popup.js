/**
 * TotalBot Popup Script
 */

// Extension ID 표시
document.getElementById('extensionId').textContent = chrome.runtime.id;

// 대시보드 열기 버튼
document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'http://localhost:5001/products.html'
  });
});

// 쿠팡 사이트 열기 버튼
document.getElementById('openCoupang').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://supplier.coupang.com'
  });
});
