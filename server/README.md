# TotalBot 서버

## 설치

```bash
npm install
```

## 실행

```bash
# 프로덕션
npm start

# 개발 모드 (자동 재시작)
npm run dev
```

## 환경 변수 (.env)

```env
PORT=5000
NODE_ENV=development
JWT_SECRET=your_secret_key_here
MAX_FILE_SIZE=10485760
```

## API 엔드포인트

### 인증
- POST `/api/auth/login` - 로그인
- POST `/api/auth/register` - 회원가입
- GET `/api/auth/me` - 사용자 정보

### 엑셀
- POST `/api/excel/generate` - 엑셀 생성 및 다운로드
- POST `/api/excel/upload` - 엑셀 업로드 및 파싱

### 크롤링
- POST `/api/crawl/save` - 상품 데이터 저장
- GET `/api/crawl/products` - 상품 목록 조회
- DELETE `/api/crawl/products/:id` - 상품 삭제

### 발주
- POST `/api/order/process` - 발주 처리
- GET `/api/order/inventory` - 재고 조회
- POST `/api/order/generate` - 발주서 생성

### 정산
- POST `/api/settlement/calculate` - 정산 계산
- POST `/api/settlement/download` - 정산서 다운로드

## 데이터베이스

현재는 메모리 내 임시 데이터 사용 중.

프로덕션 환경에서는 MongoDB/MySQL 연동 필요:
1. `package.json`에 `mongoose` 또는 `mysql2` 추가
2. `models/` 폴더에 모델 정의
3. 각 라우트에서 DB 연동

## 폴더 구조

```
server/
├── server.js              # 메인 서버
├── .env                   # 환경 변수
├── middleware/
│   └── auth.js            # JWT 인증
└── routes/
    ├── auth.js            # 인증 라우트
    ├── excel.js           # 엑셀 라우트
    ├── crawl.js           # 크롤링 라우트
    ├── order.js           # 발주 라우트
    └── settlement.js      # 정산 라우트
```

## 테스트

```bash
# Health check
curl http://localhost:5000/health

# 로그인 테스트
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```
