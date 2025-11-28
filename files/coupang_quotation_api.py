"""
쿠팡 카테고리 검색 및 견적서 다운로드 API
Likezone 서비스에 통합하기 위한 백엔드 프록시 서버
"""

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import httpx
import logging
from datetime import datetime

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="쿠팡 카테고리 견적서 API",
    description="Likezone을 위한 쿠팡 카테고리 검색 및 견적서 다운로드 프록시",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://likezone.co.kr",
        "https://www.likezone.co.kr",
        # 개발 환경
        "http://localhost:8069",  # Odoo 기본 포트
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 쿠팡 세션 정보 (환경변수나 설정 파일로 관리 권장)
class CoupangSession:
    """쿠팡 세션 관리 클래스"""
    
    def __init__(self):
        # TODO: 환경변수로 이동
        self.cookies = {
            "sid": "6ac3fcff14ac4d0a9a41207f9addf518cd45aa3e",
            "CSID": "DUM_eNx520chtJPCNtm3eJp.55133fh5p",
            "member_srl": "118662519",
            "ILOGIN": "Y",
            # 필요한 다른 쿠키들 추가
        }
        
        self.headers = {
            "accept": "application/json, text/plain, */*",
            "accept-language": "ko-KR,ko;q=0.9",
            "referer": "https://supplier.coupang.com/qvt/registration",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        }
    
    def update_cookies(self, new_cookies: dict):
        """쿠키 업데이트"""
        self.cookies.update(new_cookies)

# 전역 세션 인스턴스
coupang_session = CoupangSession()


# Request/Response 모델
class CategorySearchRequest(BaseModel):
    keyword: str

class CategoryInfo(BaseModel):
    id: str
    name: str
    path: str  # 예: "패션의류 > 여성의류 > 티셔츠"
    level: int

class CategorySearchResponse(BaseModel):
    categories: List[CategoryInfo]
    total: int

class QuotationDownloadRequest(BaseModel):
    category_ids: List[str]
    locale: str = "ko"


@app.get("/")
async def root():
    """API 상태 확인"""
    return {
        "service": "쿠팡 카테고리 견적서 API",
        "status": "running",
        "version": "1.0.0",
        "endpoints": {
            "search": "/api/v1/categories/search",
            "download": "/api/v1/quotation/download"
        }
    }


@app.get("/api/v1/categories/search")
async def search_categories(keyword: str) -> CategorySearchResponse:
    """
    카테고리 검색
    
    Args:
        keyword: 검색할 키워드
        
    Returns:
        CategorySearchResponse: 검색된 카테고리 목록
    """
    url = f"https://supplier.coupang.com/qvt/kan-categories/search"
    params = {"keyword": keyword}
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url,
                params=params,
                cookies=coupang_session.cookies,
                headers=coupang_session.headers
            )
            
            logger.info(f"Search API - Status: {response.status_code}, Keyword: {keyword}")
            
            if response.status_code != 200:
                logger.error(f"Search failed: {response.status_code} - {response.text[:200]}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail="쿠팡 API 요청 실패"
                )
            
            # 응답 파싱
            data = response.json()
            
            # 카테고리 정보 추출 및 변환
            categories = []
            
            # 실제 응답 구조에 맞게 조정 필요
            # 예상 구조: { "categories": [...] } 또는 바로 리스트
            if isinstance(data, list):
                raw_categories = data
            elif isinstance(data, dict) and "categories" in data:
                raw_categories = data["categories"]
            else:
                raw_categories = []
            
            for cat in raw_categories:
                categories.append(CategoryInfo(
                    id=str(cat.get("id") or cat.get("categoryId")),
                    name=cat.get("name", ""),
                    path=cat.get("path", cat.get("name", "")),
                    level=cat.get("level", 0)
                ))
            
            return CategorySearchResponse(
                categories=categories,
                total=len(categories)
            )
            
    except httpx.TimeoutException:
        logger.error(f"Timeout searching for: {keyword}")
        raise HTTPException(status_code=504, detail="쿠팡 서버 응답 시간 초과")
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"검색 중 오류 발생: {str(e)}")


@app.post("/api/v1/quotation/download")
async def download_quotation(request: QuotationDownloadRequest):
    """
    견적서 다운로드
    
    Args:
        request: 다운로드 요청 (카테고리 ID 목록)
        
    Returns:
        StreamingResponse: Excel 파일 스트림
    """
    # 카테고리 ID를 콤마로 연결
    category_ids_str = ",".join(request.category_ids)
    
    url = "https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation"
    params = {
        "leafKanCategoryIds": category_ids_str,
        "locale": request.locale
    }
    
    # 다운로드용 헤더 (HTML 등을 accept)
    download_headers = {
        **coupang_session.headers,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                url,
                params=params,
                cookies=coupang_session.cookies,
                headers=download_headers,
                follow_redirects=True
            )
            
            logger.info(
                f"Download API - Status: {response.status_code}, "
                f"Categories: {category_ids_str[:50]}"
            )
            
            if response.status_code != 200:
                logger.error(f"Download failed: {response.status_code}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail="견적서 다운로드 실패"
                )
            
            # Content-Type 확인
            content_type = response.headers.get("content-type", "")
            logger.info(f"Response Content-Type: {content_type}")
            
            # 파일명 생성
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"coupang_quotation_{timestamp}.xlsx"
            
            # Content-Disposition 헤더에서 파일명 추출 시도
            if "content-disposition" in response.headers:
                content_disp = response.headers["content-disposition"]
                if "filename=" in content_disp:
                    # filename="..." 형식에서 추출
                    filename = content_disp.split("filename=")[1].strip('"')
            
            # Excel 파일로 응답
            return Response(
                content=response.content,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                }
            )
            
    except httpx.TimeoutException:
        logger.error(f"Timeout downloading quotation for: {category_ids_str}")
        raise HTTPException(status_code=504, detail="견적서 다운로드 시간 초과")
    except Exception as e:
        logger.error(f"Download error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"다운로드 중 오류 발생: {str(e)}")


@app.post("/api/v1/session/update-cookies")
async def update_session_cookies(cookies: dict):
    """
    쿠팡 세션 쿠키 업데이트
    (관리자용 - 실제 운영 시에는 인증 추가 필요)
    
    Args:
        cookies: 업데이트할 쿠키 딕셔너리
    """
    try:
        coupang_session.update_cookies(cookies)
        logger.info("Session cookies updated successfully")
        return {"status": "success", "message": "쿠키가 업데이트되었습니다"}
    except Exception as e:
        logger.error(f"Cookie update error: {str(e)}")
        raise HTTPException(status_code=500, detail="쿠키 업데이트 실패")


@app.get("/health")
async def health_check():
    """헬스 체크"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    
    # 개발 서버 실행
    uvicorn.run(
        "coupang_quotation_api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
