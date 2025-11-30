/**
 * TotalBot Server
 * - Express 기반 API 서버
 * - 크롬 확장과 통신
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const https = require('https');

// 환경 변수 로드
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// TotalBot API 서버 URL
const TOTALBOT_API = 'https://114.202.247.228';

// 미들웨어
app.use(cors());
app.use(express.json({ limit: '50mb' })); // 이미지 업로드를 위해 크기 제한 증가
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 정적 파일 제공 (업로드된 이미지 등)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// HTML 파일 캐시 비활성화 미들웨어 (항상 최신 버전 제공)
app.use((req, res, next) => {
  if (req.url.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});

// 개발 환경에서는 캐시 비활성화 (파일 변경사항 즉시 반영)
const staticOptions = process.env.NODE_ENV === 'production'
  ? { maxAge: '1d' }  // 프로덕션: 1일 캐시
  : {
      maxAge: 0,      // 개발: 캐시 비활성화
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    };

app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// 라우트 임포트
const authRoutes = require('./routes/auth');
const excelRoutes = require('./routes/excel');
const crawlRoutes = require('./routes/crawl');
const orderRoutes = require('./routes/order');
const settlementRoutes = require('./routes/settlement');
const translateRoutes = require('./routes/translate');
const productsRoutes = require('./routes/products');
const quoteRoutes = require('./routes/quote');
const coupangRoutes = require('./routes/coupang');
const magicEraserRoutes = require('./routes/magicEraser');
const geminiRoutes = require('./routes/gemini');
const ordersRoutes = require('./routes/orders');
const settingsRoutes = require('./routes/settings');
const sizeChartRoutes = require('./routes/sizeChart');
const priceHistoryRoutes = require('./routes/priceHistory');

// 라우트 등록
console.log('✅ Magic Eraser 라우트 로드됨:', typeof magicEraserRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/excel', excelRoutes);
app.use('/api/crawl', crawlRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/settlement', settlementRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/coupang', coupangRoutes);
app.use('/api', magicEraserRoutes);
app.use('/api/gemini', geminiRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/size-chart', sizeChartRoutes);
app.use('/api/price-history', priceHistoryRoutes);
console.log('✅ Magic Eraser 라우트 등록 완료');
console.log('✅ Price History 라우트 등록 완료');
console.log('✅ Size Chart 라우트 등록 완료');
console.log('✅ Settings 라우트 등록 완료');
console.log('✅ Gemini 라우트 등록 완료');
console.log('✅ Orders 라우트 등록 완료');

// 기본 경로 -> 로그인 페이지로 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ============================================
// TotalBot API 프록시 (CORS 우회)
// ============================================

// 프록시 헬퍼 함수
function proxyRequest(method, apiPath, body, req, res) {
  const url = new URL(apiPath, TOTALBOT_API);

  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    rejectUnauthorized: false // SSL 인증서 검증 비활성화
  };

  // 쿠키 전달
  if (req.headers.cookie) {
    options.headers['Cookie'] = req.headers.cookie;
  }

  const proxyReq = https.request(options, (proxyRes) => {
    // 쿠키 전달
    if (proxyRes.headers['set-cookie']) {
      res.setHeader('Set-Cookie', proxyRes.headers['set-cookie']);
    }

    res.status(proxyRes.statusCode);

    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch (e) {
        res.send(data);
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    res.status(500).json({ success: false, message: '서버 연결 오류' });
  });

  if (body) {
    proxyReq.write(JSON.stringify(body));
  }

  proxyReq.end();
}

// 로그인 프록시
app.post('/proxy/login', (req, res) => {
  proxyRequest('POST', '/login', req.body, req, res);
});

// 회원가입 프록시
app.post('/proxy/users', (req, res) => {
  proxyRequest('POST', '/users', req.body, req, res);
});

// 사용자 정보 프록시
app.get('/proxy/user/info', (req, res) => {
  proxyRequest('GET', '/user/info', null, req, res);
});

// 포인트 관련 프록시
app.get('/proxy/user/points', (req, res) => {
  proxyRequest('GET', '/api/user/points', null, req, res);
});

app.get('/proxy/user/points/history', (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  proxyRequest('GET', '/api/user/points/history' + (query ? '?' + query : ''), null, req, res);
});

app.post('/proxy/user/points/charge', (req, res) => {
  proxyRequest('POST', '/api/user/points/charge', req.body, req, res);
});

// 재고 데이터 프록시
app.get('/proxy/inventory_data/by_username', (req, res) => {
  proxyRequest('GET', '/api/inventory_data/by_username', null, req, res);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404 에러 처리
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '요청하신 경로를 찾을 수 없습니다.'
  });
});

// 전역 에러 핸들러
app.use((err, req, res, next) => {
  console.error('서버 오류:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || '서버 내부 오류가 발생했습니다.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`\n🚀 TotalBot 서버 시작됨!`);
  console.log(`   포트: ${PORT}`);
  console.log(`   환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   시간: ${new Date().toLocaleString('ko-KR')}\n`);
});

// 프로세스 종료 처리
process.on('SIGTERM', () => {
  console.log('SIGTERM 신호 수신 - 서버 종료 중...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT 신호 수신 - 서버 종료 중...');
  process.exit(0);
});
