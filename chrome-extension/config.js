// TotalBot 서버 설정
// 로컬 개발: 'http://localhost:5001'
// 운영 서버: 'https://totalbot.cafe24.com/node-api'

const CONFIG = {
  // 서버 URL (끝에 슬래시 없이)
  SERVER_URL: 'https://totalbot.cafe24.com/node-api',

  // 로컬 개발용
  // SERVER_URL: 'http://localhost:5001',
};

// 전역으로 내보내기
if (typeof window !== 'undefined') {
  window.TOTALBOT_CONFIG = CONFIG;
}
