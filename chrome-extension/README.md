# TotalBot 크롬 확장 프로그램

## 설치 방법

1. 크롬 브라우저에서 `chrome://extensions` 열기
2. 우측 상단 "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 이 폴더(`chrome-extension`) 선택

## 파일 구조

```
chrome-extension/
├── manifest.json          # 확장 프로그램 설정
├── background.js          # Background Service Worker
├── content/
│   └── content.js         # 웹페이지 데이터 추출
└── popup/
    ├── popup.html         # 팝업 UI
    ├── popup.js           # 팝업 로직
    └── popup.css          # 팝업 스타일
```

## 아이콘 파일 추가

`icons/` 폴더에 다음 파일을 추가하세요:
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

아이콘이 없으면 확장이 작동하지만 아이콘이 표시되지 않습니다.

## 주요 기능

- ✅ 쿠팡/알리익스프레스 상품 자동 수집
- ✅ 엑셀 다운로드
- ✅ 발주 처리
- ✅ 정산 계산
- ✅ 로그인/로그아웃

## 개발

개발자 도구에서 다음 확인:
- Background: `chrome://extensions` → 확장 "서비스 워커" 클릭
- Content Script: 웹페이지에서 F12 → Console
- Popup: 팝업 우클릭 → "검사"
