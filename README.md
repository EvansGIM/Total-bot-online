# TotalBot - 크롬 확장 프로그램 버전

> 기존 Python TotalBot을 크롬 확장 + Node.js 서버로 완전히 재구현한 버전입니다.

## 📦 프로젝트 구조

```
테스트/
├── chrome-extension/          # 크롬 확장 프로그램
│   ├── manifest.json          # 확장 설정 파일
│   ├── background.js          # Background Service Worker
│   ├── content/
│   │   └── content.js         # Content Script (웹페이지 데이터 추출)
│   ├── popup/
│   │   ├── popup.html         # Popup UI
│   │   ├── popup.js           # Popup 로직
│   │   └── popup.css          # Popup 스타일
│   └── icons/                 # 아이콘 (추가 필요)
│
└── server/                    # Node.js API 서버
    ├── package.json           # 서버 의존성
    ├── server.js              # 메인 서버 파일
    ├── .env                   # 환경 변수
    ├── middleware/
    │   └── auth.js            # JWT 인증 미들웨어
    └── routes/
        ├── auth.js            # 인증 (로그인/회원가입)
        ├── excel.js           # 엑셀 처리
        ├── crawl.js           # 크롤링 데이터 관리
        ├── order.js           # 발주 처리
        └── settlement.js      # 정산 처리
```

## 🚀 설치 및 실행 방법

### 1. 서버 설치

```bash
cd server

# 의존성 설치
npm install

# 서버 실행
npm start

# 개발 모드 (nodemon)
npm run dev
```

서버가 `http://localhost:5000`에서 실행됩니다.

### 2. 크롬 확장 설치

1. 크롬 브라우저 열기
2. 주소창에 `chrome://extensions` 입력
3. 우측 상단 "개발자 모드" 활성화
4. "압축해제된 확장 프로그램을 로드합니다" 클릭
5. `chrome-extension` 폴더 선택
6. 확장 프로그램이 설치되고 툴바에 아이콘이 표시됨

### 3. 아이콘 파일 추가 (선택사항)

`chrome-extension/icons/` 폴더에 다음 파일을 추가하세요:
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

또는 임시로 다음 명령으로 더미 아이콘 생성:
```bash
cd chrome-extension
mkdir -p icons
# 원하는 아이콘 파일을 icons 폴더에 복사
```

## 📖 사용 방법

### 로그인
1. 크롬 툴바에서 TotalBot 아이콘 클릭
2. 기본 계정으로 로그인:
   - 아이디: `admin`
   - 비밀번호: `admin123`

### 상품 수집
1. 쿠팡/알리익스프레스 상품 페이지 방문
2. TotalBot 아이콘 클릭
3. "현재 페이지 수집" 버튼 클릭
4. 수집된 데이터 확인 후 "수집된 상품 보기"로 엑셀 다운로드

### 발주 처리
1. "발주 처리" 탭 이동
2. "발주 파일 업로드" 클릭하여 엑셀 업로드
3. "발주 처리 시작" 클릭
4. 처리 결과 확인

### 정산
1. "정산" 탭 이동
2. "정산 파일 업로드" 클릭 (쿠팡/루트로지스/3PL 데이터)
3. "정산 계산하기" 클릭
4. 정산 결과 다운로드

## 🔧 개발 기술 스택

### 크롬 확장
- **Manifest V3** (최신 크롬 확장 규격)
- **Vanilla JavaScript** (ES6+)
- **Chrome APIs**: storage, downloads, tabs, scripting
- **Content Scripts**: 웹페이지 직접 조작

### 서버
- **Node.js** + **Express.js**
- **JWT** (인증)
- **bcrypt** (비밀번호 해싱)
- **xlsx** (엑셀 처리)
- **sharp** (이미지 처리)
- **multer** (파일 업로드)

## 📋 주요 기능

### ✅ 구현 완료
- [x] 인증 시스템 (로그인/회원가입)
- [x] 상품 자동 수집 (쿠팡/알리익스프레스/1688)
- [x] 엑셀 처리 (생성/업로드/파싱)
- [x] 발주 자동 처리
- [x] 정산 계산
- [x] 재고 관리
- [x] 크롬 스토리지 (데이터 저장)

### 🔄 추가 개발 필요
- [ ] 이미지 자동 리사이즈
- [ ] 상세페이지 자동 제작 UI
- [ ] 쿠팡 자동 업로드 (Selenium 대체)
- [ ] 구글 시트 연동
- [ ] 데이터베이스 연동 (MongoDB/MySQL)
- [ ] 실시간 알림
- [ ] 사용자 권한 관리 (Premium/Basic)

## 🔑 API 엔드포인트

### 인증
- `POST /api/auth/login` - 로그인
- `POST /api/auth/register` - 회원가입
- `GET /api/auth/me` - 사용자 정보 조회

### 엑셀
- `POST /api/excel/generate` - 엑셀 생성
- `POST /api/excel/upload` - 엑셀 업로드
- `POST /api/excel/parse` - 엑셀 파싱

### 크롤링
- `POST /api/crawl/save` - 상품 데이터 저장
- `GET /api/crawl/products` - 수집된 상품 조회
- `DELETE /api/crawl/products/:id` - 상품 삭제

### 발주
- `POST /api/order/process` - 발주 처리
- `GET /api/order/inventory` - 재고 조회
- `POST /api/order/generate` - 발주서 생성
- `GET /api/order/history` - 주문 내역

### 정산
- `POST /api/settlement/calculate` - 정산 계산
- `POST /api/settlement/download` - 정산서 다운로드

## 🎨 UI 스크린샷

(스크린샷 추가 예정)

## 🐛 알려진 이슈

1. **Service Worker 5분 제한**: 현재 Keep-Alive로 우회 중
2. **CORS 문제**: 일부 사이트에서 이미지 다운로드 제한
3. **엑셀 한글 인코딩**: UTF-8 BOM 처리 필요

## 📞 문의 및 지원

- Issues: [GitHub Issues](https://github.com/seunghoon4176/totalbot/issues)
- 기존 Python 버전: `/Users/evans/Documents/GitHub/totalbot`

## 📝 라이선스

Copyright © 2025

---

## 🔄 기존 Python 버전과의 차이점

| 기능 | Python 버전 | 크롬 확장 버전 |
|------|-------------|---------------|
| **설치** | PyInstaller 실행 파일 | 크롬 확장 + 서버 |
| **UI** | PySide6 (Desktop) | HTML/CSS/JS (Popup) |
| **크롤링** | Selenium + undetected-chromedriver | Content Scripts (직접 DOM 접근) |
| **엑셀** | openpyxl, pandas | xlsx (SheetJS) |
| **이미지** | Pillow | Sharp (서버), Canvas (클라이언트) |
| **인증** | auth.json (파일) | JWT (토큰) + 서버 DB |
| **데이터 저장** | 로컬 파일 | chrome.storage + 서버 DB |
| **업데이트** | 수동 다운로드 | 자동 (Chrome Web Store) |

## 🚀 향후 개발 계획

1. **Phase 1** (현재)
   - ✅ 기본 구조 완성
   - ✅ 주요 기능 구현

2. **Phase 2** (1-2주)
   - [ ] 데이터베이스 연동
   - [ ] 사용자 권한 시스템
   - [ ] 이미지 처리 고도화

3. **Phase 3** (2-3주)
   - [ ] 상세페이지 제작 UI
   - [ ] 구글 시트 연동
   - [ ] 실시간 알림

4. **Phase 4** (4주)
   - [ ] Chrome Web Store 배포
   - [ ] 프로덕션 서버 구축
   - [ ] 테스트 및 버그 수정

---

**개발 완료일**: 2025-01-13
**버전**: 1.0.0 (베타)
