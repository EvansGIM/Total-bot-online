# 🏪 쿠팡 카테고리 견적서 자동 다운로드 시스템

Likezone 서비스에 통합하기 위한 쿠팡 카테고리 검색 및 견적서 자동 다운로드 솔루션

## 📋 목차

1. [시스템 구조](#시스템-구조)
2. [빠른 시작](#빠른-시작)
3. [상세 설치 가이드](#상세-설치-가이드)
4. [API 문서](#api-문서)
5. [프론트엔드 통합](#프론트엔드-통합)
6. [운영 가이드](#운영-가이드)
7. [문제 해결](#문제-해결)

---

## 🏗️ 시스템 구조

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│  Likezone 웹    │───────▶│  FastAPI 서버    │───────▶│  쿠팡 API       │
│  (프론트엔드)   │        │  (프록시)        │        │                 │
└─────────────────┘        └──────────────────┘        └─────────────────┘
         ▲                          │
         │                          │
         └──────────────────────────┘
              견적서 파일 다운로드
```

### 왜 프록시 서버가 필요한가?

1. **CORS 문제 해결**: 브라우저에서 직접 쿠팡 API 호출 불가
2. **쿠키 관리**: 서버에서 쿠팡 세션 쿠키를 안전하게 관리
3. **보안**: 쿠키 정보가 클라이언트에 노출되지 않음
4. **확장성**: 추가 기능 (로깅, 캐싱, 에러 처리) 쉽게 추가 가능

---

## 🚀 빠른 시작

### 1. 백엔드 서버 실행 (5분)

```bash
# 1. 의존성 설치
pip install -r requirements.txt

# 2. 서버 실행
python coupang_quotation_api.py
```

서버가 `http://localhost:8000`에서 실행됩니다.

### 2. 프론트엔드 테스트 (1분)

HTML 파일을 만들고 브라우저에서 열기:

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>쿠팡 견적서 테스트</title>
</head>
<body>
    <h1>쿠팡 카테고리 검색</h1>
    <input type="text" id="search" placeholder="검색어 입력">
    <button onclick="search()">검색</button>
    <div id="results"></div>

    <script>
        async function search() {
            const keyword = document.getElementById('search').value;
            const response = await fetch(
                `http://localhost:8000/api/v1/categories/search?keyword=${keyword}`
            );
            const data = await response.json();
            document.getElementById('results').innerHTML = 
                JSON.stringify(data, null, 2);
        }
    </script>
</body>
</html>
```

---

## 📦 상세 설치 가이드

### 1. 쿠키 설정 (중요!)

#### 방법 1: 브라우저에서 수동 추출

1. **Chrome에서 쿠팡 판매자센터 로그인**
   ```
   https://supplier.coupang.com
   ```

2. **F12 → Application → Cookies → supplier.coupang.com**

3. **필수 쿠키 복사:**
   - `sid`
   - `CSID`
   - `member_srl`
   - `ILOGIN`

4. **`coupang_quotation_api.py` 파일의 `CoupangSession.__init__` 수정:**

```python
def __init__(self):
    self.cookies = {
        "sid": "여기에_sid_값_붙여넣기",
        "CSID": "여기에_CSID_값_붙여넣기",
        "member_srl": "여기에_member_srl_값_붙여넣기",
        "ILOGIN": "Y",
    }
```

#### 방법 2: 헬퍼 스크립트 사용 (추천)

```bash
python cookie_helper.py
```

화면의 안내에 따라 쿠키를 붙여넣으면 자동으로 `.env` 파일 생성

### 2. 서버 실행 옵션

#### 개발 환경
```bash
# 자동 리로드 활성화
python coupang_quotation_api.py
```

#### 프로덕션 환경
```bash
# Gunicorn 사용 (추천)
pip install gunicorn
gunicorn coupang_quotation_api:app \
    --workers 4 \
    --bind 0.0.0.0:8000 \
    --timeout 120

# 또는 uvicorn
uvicorn coupang_quotation_api:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 4
```

### 3. 방화벽 설정

서버가 외부에서 접근 가능하도록 포트 오픈:

```bash
# Ubuntu/Debian
sudo ufw allow 8000/tcp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --reload
```

---

## 📖 API 문서

### 1. 카테고리 검색

**요청:**
```http
GET /api/v1/categories/search?keyword=패션의류
```

**응답:**
```json
{
  "categories": [
    {
      "id": "5933",
      "name": "티셔츠",
      "path": "패션의류 > 여성의류 > 티셔츠",
      "level": 3
    }
  ],
  "total": 1
}
```

### 2. 견적서 다운로드

**요청:**
```http
POST /api/v1/quotation/download
Content-Type: application/json

{
  "category_ids": ["5933", "5934"],
  "locale": "ko"
}
```

**응답:**
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="coupang_quotation_20251115.xlsx"

[Excel 파일 바이너리 데이터]
```

### 3. 쿠키 업데이트 (관리자용)

**요청:**
```http
POST /api/v1/session/update-cookies
Content-Type: application/json

{
  "sid": "new_session_id",
  "CSID": "new_csrf_token"
}
```

---

## 🎨 프론트엔드 통합

### React 예시

```jsx
import React, { useState } from 'react';

function CoupangCategorySearch() {
    const [keyword, setKeyword] = useState('');
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState([]);

    const search = async () => {
        const response = await fetch(
            `http://localhost:8000/api/v1/categories/search?keyword=${keyword}`
        );
        const data = await response.json();
        setResults(data.categories);
    };

    const download = async () => {
        const response = await fetch(
            'http://localhost:8000/api/v1/quotation/download',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category_ids: selected,
                    locale: 'ko'
                })
            }
        );

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '쿠팡_견적서.xlsx';
        a.click();
    };

    return (
        <div>
            <input 
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="카테고리 검색"
            />
            <button onClick={search}>검색</button>

            {results.map(cat => (
                <div key={cat.id}>
                    <input
                        type="checkbox"
                        checked={selected.includes(cat.id)}
                        onChange={e => {
                            if (e.target.checked) {
                                setSelected([...selected, cat.id]);
                            } else {
                                setSelected(selected.filter(id => id !== cat.id));
                            }
                        }}
                    />
                    {cat.path}
                </div>
            ))}

            <button onClick={download} disabled={selected.length === 0}>
                견적서 다운로드 ({selected.length}개)
            </button>
        </div>
    );
}
```

### Odoo 통합

```python
# Odoo 컨트롤러 예시
from odoo import http
import requests

class CoupangQuotationController(http.Controller):
    
    @http.route('/coupang/search', type='json', auth='user')
    def search_categories(self, keyword):
        """카테고리 검색"""
        response = requests.get(
            'http://localhost:8000/api/v1/categories/search',
            params={'keyword': keyword}
        )
        return response.json()
    
    @http.route('/coupang/download', type='http', auth='user')
    def download_quotation(self, category_ids):
        """견적서 다운로드"""
        response = requests.post(
            'http://localhost:8000/api/v1/quotation/download',
            json={
                'category_ids': category_ids.split(','),
                'locale': 'ko'
            }
        )
        
        return request.make_response(
            response.content,
            headers=[
                ('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                ('Content-Disposition', 'attachment; filename=coupang_quotation.xlsx')
            ]
        )
```

---

## ⚙️ 운영 가이드

### 쿠키 자동 갱신 (크론잡)

쿠키는 약 1-2주마다 만료됩니다. 자동 갱신 스크립트:

```bash
# crontab -e
# 매주 월요일 오전 9시에 쿠키 갱신 알림
0 9 * * 1 /usr/bin/python /path/to/check_cookie_expiry.py
```

`check_cookie_expiry.py`:
```python
import requests
import sys

def check_api_health():
    try:
        response = requests.get('http://localhost:8000/api/v1/categories/search?keyword=test')
        if response.status_code == 401:
            print("⚠️ 쿠키가 만료되었습니다! 갱신이 필요합니다.")
            # 슬랙/이메일 알림 전송
            return False
        return True
    except Exception as e:
        print(f"❌ API 오류: {e}")
        return False

if __name__ == '__main__':
    if not check_api_health():
        sys.exit(1)
```

### 로깅 설정

```python
# coupang_quotation_api.py에 추가
import logging
from logging.handlers import RotatingFileHandler

# 파일 로그 핸들러
file_handler = RotatingFileHandler(
    'coupang_api.log',
    maxBytes=10485760,  # 10MB
    backupCount=5
)
file_handler.setFormatter(
    logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
)

logger = logging.getLogger(__name__)
logger.addHandler(file_handler)
```

### 모니터링

```bash
# PM2로 프로세스 관리
npm install -g pm2
pm2 start "uvicorn coupang_quotation_api:app --host 0.0.0.0 --port 8000" --name coupang-api
pm2 save
pm2 startup
```

---

## 🔧 문제 해결

### 1. "403 Forbidden" 오류

**원인:** 쿠키 만료 또는 잘못된 쿠키

**해결:**
1. 쿠팡 판매자센터에 다시 로그인
2. 새로운 쿠키 복사
3. `coupang_quotation_api.py` 업데이트
4. 서버 재시작

### 2. "CORS 오류"

**원인:** 허용되지 않은 도메인에서 요청

**해결:**
`coupang_quotation_api.py`의 `allow_origins`에 도메인 추가:

```python
allow_origins=[
    "http://localhost:3000",
    "https://likezone.co.kr",
    "https://your-domain.com",  # 추가
]
```

### 3. "검색 결과가 없습니다"

**원인:** 
- 검색어가 잘못되었거나
- API 응답 구조가 예상과 다름

**해결:**
1. 직접 curl로 테스트:
```bash
curl 'http://localhost:8000/api/v1/categories/search?keyword=패션'
```

2. 응답 구조 확인 후 `search_categories` 함수 수정

### 4. "다운로드한 파일이 열리지 않음"

**원인:** 
- Excel 파일이 아닌 HTML 오류 페이지일 수 있음
- 쿠키 문제

**해결:**
1. 파일을 텍스트 에디터로 열어서 내용 확인
2. HTML이면 오류 메시지 확인
3. 쿠키 갱신

---

## 📊 성능 최적화

### 캐싱 추가

```python
from functools import lru_cache
from datetime import datetime, timedelta

# 검색 결과 캐싱 (5분)
search_cache = {}

@app.get("/api/v1/categories/search")
async def search_categories(keyword: str):
    cache_key = f"search:{keyword}"
    
    # 캐시 확인
    if cache_key in search_cache:
        cached_time, cached_data = search_cache[cache_key]
        if datetime.now() - cached_time < timedelta(minutes=5):
            logger.info(f"Cache hit: {keyword}")
            return cached_data
    
    # API 호출
    result = await _do_search(keyword)
    
    # 캐시 저장
    search_cache[cache_key] = (datetime.now(), result)
    
    return result
```

---

## 🎯 다음 단계

1. **쿠키 자동 갱신 시스템 구축**
2. **사용자별 검색 히스토리 저장**
3. **즐겨찾기 기능 추가**
4. **Odoo ERP와 완전 통합**

---

## 📞 지원

문제가 발생하면:
1. 로그 파일 확인: `coupang_api.log`
2. API 상태 확인: `http://localhost:8000/health`
3. 쿠키 상태 확인

**Happy Coding! 🚀**
