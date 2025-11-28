# 🚀 빠른 시작 가이드

5분 안에 쿠팡 카테고리 견적서 자동 다운로드 시스템을 실행하세요!

## ✅ 체크리스트

- [ ] Python 3.8+ 설치됨
- [ ] 쿠팡 판매자센터 계정 있음
- [ ] 쿠팡 판매자센터에 로그인된 상태

## 📋 단계별 가이드

### 1단계: 쿠키 가져오기 (2분)

1. **Chrome에서 쿠팡 판매자센터 로그인**
   ```
   https://supplier.coupang.com
   ```

2. **F12 → Application → Cookies → supplier.coupang.com**

3. **다음 쿠키 값 복사:**
   - `sid` 값 복사
   - `CSID` 값 복사
   - `member_srl` 값 복사

4. **메모장에 임시 저장**

---

### 2단계: 서버 설정 (1분)

1. **`coupang_quotation_api.py` 파일 열기**

2. **21번째 줄 근처의 `CoupangSession` 클래스 찾기**

3. **쿠키 값 붙여넣기:**

```python
class CoupangSession:
    def __init__(self):
        self.cookies = {
            "sid": "여기에_복사한_sid_붙여넣기",
            "CSID": "여기에_복사한_CSID_붙여넣기",
            "member_srl": "여기에_복사한_member_srl_붙여넣기",
            "ILOGIN": "Y",
        }
```

4. **저장 (Ctrl/Cmd + S)**

---

### 3단계: 서버 실행 (1분)

**터미널에서 실행:**

```bash
# 의존성 설치
pip install -r requirements.txt

# 서버 실행
python coupang_quotation_api.py
```

**성공 메시지:**
```
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000
```

---

### 4단계: 테스트 (1분)

**방법 1: 브라우저에서 직접 테스트**

1. **`demo.html` 파일을 Chrome으로 열기**

2. **검색창에 "패션"이라고 입력**

3. **결과가 나타나면 성공! ✅**

**방법 2: curl로 테스트**

```bash
# 검색 테스트
curl "http://localhost:8000/api/v1/categories/search?keyword=패션"

# 결과 예시:
# {"categories":[{"id":"5933","name":"티셔츠",...}],"total":10}
```

---

## 🎉 성공!

이제 민호님의 Likezone 사이트에서 사용할 수 있습니다!

### 다음 단계

1. **Likezone에 통합:**
   - `coupang-quotation-client.js`를 프론트엔드에 추가
   - API 호출 코드 작성

2. **프로덕션 배포:**
   - 서버를 클라우드에 배포 (AWS, GCP, Azure 등)
   - HTTPS 설정
   - 도메인 연결

3. **쿠키 관리:**
   - 1-2주마다 쿠키 갱신 필요
   - 자동 알림 설정 권장

---

## ❓ 문제 해결

### "403 Forbidden" 오류
→ 쿠키가 잘못되었습니다. 1단계부터 다시 시작하세요.

### "Connection refused" 오류
→ 서버가 실행 중인지 확인하세요. `python coupang_quotation_api.py`

### "CORS 오류"
→ `demo.html`을 웹 서버로 실행하거나, Chrome을 CORS 비활성화 모드로 실행:
```bash
# Mac
open -na "Google Chrome" --args --disable-web-security --user-data-dir=/tmp/chrome

# Windows
chrome.exe --disable-web-security --user-data-dir=C:\temp\chrome
```

### "검색 결과가 없습니다"
→ 다른 키워드로 시도해보세요 (예: "식품", "뷰티", "생활용품")

---

## 📞 도움이 필요하신가요?

1. **서버 상태 확인:**
   ```bash
   curl http://localhost:8000/health
   ```

2. **로그 확인:**
   - 터미널에서 실행 중인 서버의 출력 확인

3. **상세 가이드:**
   - `INTEGRATION_GUIDE.md` 참고

---

## 🎯 핵심 파일

| 파일 | 용도 |
|------|------|
| `coupang_quotation_api.py` | 백엔드 API 서버 |
| `coupang-quotation-client.js` | 프론트엔드 클라이언트 라이브러리 |
| `demo.html` | 테스트용 데모 페이지 |
| `requirements.txt` | Python 의존성 |
| `INTEGRATION_GUIDE.md` | 상세 통합 가이드 |

---

**축하합니다! 이제 쿠팡 카테고리 견적서를 자동으로 다운로드할 수 있습니다! 🎊**
