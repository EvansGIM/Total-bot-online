/**
 * 쿠팡 카테고리 견적서 API 클라이언트
 * Likezone 서비스 통합용
 */

class CoupangQuotationClient {
    /**
     * @param {string} apiBaseUrl - API 서버 주소 (예: http://localhost:8000)
     */
    constructor(apiBaseUrl = 'http://localhost:8000') {
        this.apiBaseUrl = apiBaseUrl;
        this.searchCache = new Map();
    }

    /**
     * 카테고리 검색
     * @param {string} keyword - 검색 키워드
     * @returns {Promise<{categories: Array, total: number}>}
     */
    async searchCategories(keyword) {
        // 캐시 확인
        if (this.searchCache.has(keyword)) {
            console.log(`[Cache Hit] ${keyword}`);
            return this.searchCache.get(keyword);
        }

        const url = `${this.apiBaseUrl}/api/v1/categories/search?keyword=${encodeURIComponent(keyword)}`;
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`검색 실패: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            // 캐시 저장 (최대 100개)
            if (this.searchCache.size > 100) {
                const firstKey = this.searchCache.keys().next().value;
                this.searchCache.delete(firstKey);
            }
            this.searchCache.set(keyword, data);

            return data;
        } catch (error) {
            console.error('카테고리 검색 오류:', error);
            throw error;
        }
    }

    /**
     * 견적서 다운로드
     * @param {Array<string>} categoryIds - 카테고리 ID 배열
     * @param {string} locale - 언어 (기본값: 'ko')
     * @returns {Promise<Blob>} - Excel 파일 Blob
     */
    async downloadQuotation(categoryIds, locale = 'ko') {
        const url = `${this.apiBaseUrl}/api/v1/quotation/download`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    category_ids: categoryIds,
                    locale: locale
                })
            });

            if (!response.ok) {
                throw new Error(`다운로드 실패: ${response.status} ${response.statusText}`);
            }

            // Blob으로 변환
            const blob = await response.blob();
            return blob;
        } catch (error) {
            console.error('견적서 다운로드 오류:', error);
            throw error;
        }
    }

    /**
     * 견적서 자동 다운로드 (브라우저에서 파일 저장)
     * @param {Array<string>} categoryIds - 카테고리 ID 배열
     * @param {string} filename - 저장할 파일명 (선택사항)
     */
    async autoDownloadQuotation(categoryIds, filename = null) {
        try {
            const blob = await this.downloadQuotation(categoryIds);
            
            // 파일명 생성
            if (!filename) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                filename = `쿠팡_견적서_${timestamp}.xlsx`;
            }

            // Blob을 URL로 변환하여 다운로드
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            // 정리
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            console.log(`✅ 견적서 다운로드 완료: ${filename}`);
            return true;
        } catch (error) {
            console.error('자동 다운로드 오류:', error);
            throw error;
        }
    }

    /**
     * 검색부터 다운로드까지 한 번에
     * @param {string} keyword - 검색 키워드
     * @param {number} maxResults - 최대 결과 수 (기본값: 전체)
     */
    async searchAndDownload(keyword, maxResults = null) {
        try {
            // 1. 검색
            console.log(`🔍 검색 중: ${keyword}`);
            const searchResult = await this.searchCategories(keyword);
            
            if (searchResult.total === 0) {
                throw new Error('검색 결과가 없습니다.');
            }

            // 2. 카테고리 ID 추출
            let categories = searchResult.categories;
            if (maxResults && maxResults < categories.length) {
                categories = categories.slice(0, maxResults);
            }

            const categoryIds = categories.map(cat => cat.id);
            console.log(`📋 발견된 카테고리: ${categories.length}개`);
            categories.forEach(cat => {
                console.log(`  - ${cat.path}`);
            });

            // 3. 다운로드
            console.log(`⬇️ 견적서 다운로드 중...`);
            await this.autoDownloadQuotation(categoryIds);

            return {
                success: true,
                categories: categories,
                total: categories.length
            };
        } catch (error) {
            console.error('검색 및 다운로드 오류:', error);
            throw error;
        }
    }
}


// React/Vue 컴포넌트용 Hook
class CoupangQuotationUIHelper {
    constructor(client) {
        this.client = client;
    }

    /**
     * 검색 UI 상태 관리 헬퍼
     */
    createSearchState() {
        return {
            keyword: '',
            results: [],
            loading: false,
            error: null,
            selectedCategories: []
        };
    }

    /**
     * 검색 실행
     */
    async handleSearch(state, keyword) {
        state.loading = true;
        state.error = null;
        
        try {
            const result = await this.client.searchCategories(keyword);
            state.results = result.categories;
            state.keyword = keyword;
            return result;
        } catch (error) {
            state.error = error.message;
            throw error;
        } finally {
            state.loading = false;
        }
    }

    /**
     * 카테고리 선택/해제
     */
    toggleCategory(state, categoryId) {
        const index = state.selectedCategories.indexOf(categoryId);
        if (index > -1) {
            state.selectedCategories.splice(index, 1);
        } else {
            state.selectedCategories.push(categoryId);
        }
    }

    /**
     * 선택된 카테고리의 견적서 다운로드
     */
    async handleDownload(state) {
        if (state.selectedCategories.length === 0) {
            throw new Error('카테고리를 선택해주세요.');
        }

        try {
            await this.client.autoDownloadQuotation(state.selectedCategories);
            return true;
        } catch (error) {
            state.error = error.message;
            throw error;
        }
    }
}


// HTML 샘플 (참고용)
const HTML_EXAMPLE = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>쿠팡 카테고리 견적서 다운로드</title>
    <style>
        body {
            font-family: 'Noto Sans KR', sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .search-box {
            margin-bottom: 30px;
        }
        .search-input {
            width: 100%;
            padding: 15px;
            font-size: 16px;
            border: 2px solid #ddd;
            border-radius: 8px;
        }
        .category-list {
            display: grid;
            gap: 10px;
        }
        .category-item {
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .category-item:hover {
            background-color: #f0f0f0;
        }
        .category-item.selected {
            background-color: #e3f2fd;
            border-color: #2196F3;
        }
        .download-btn {
            width: 100%;
            padding: 15px;
            background-color: #2196F3;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 20px;
        }
        .download-btn:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <h1>🏪 쿠팡 카테고리 견적서</h1>
    
    <div class="search-box">
        <input 
            type="text" 
            id="searchInput" 
            class="search-input" 
            placeholder="카테고리 검색 (예: 패션의류, 식품, 뷰티)"
        >
    </div>

    <div id="results" class="category-list"></div>

    <button id="downloadBtn" class="download-btn" disabled>
        선택한 카테고리 견적서 다운로드
    </button>

    <script src="coupang-quotation-client.js"></script>
    <script>
        // 클라이언트 초기화
        const client = new CoupangQuotationClient('http://localhost:8000');
        const helper = new CoupangQuotationUIHelper(client);
        const state = helper.createSearchState();

        // DOM 요소
        const searchInput = document.getElementById('searchInput');
        const resultsDiv = document.getElementById('results');
        const downloadBtn = document.getElementById('downloadBtn');

        // 검색 이벤트
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const keyword = e.target.value.trim();
                if (keyword.length === 0) {
                    resultsDiv.innerHTML = '';
                    return;
                }

                try {
                    await helper.handleSearch(state, keyword);
                    renderResults();
                } catch (error) {
                    resultsDiv.innerHTML = \`<p style="color: red;">검색 오류: \${error.message}</p>\`;
                }
            }, 500);
        });

        // 결과 렌더링
        function renderResults() {
            resultsDiv.innerHTML = state.results.map(cat => \`
                <div 
                    class="category-item \${state.selectedCategories.includes(cat.id) ? 'selected' : ''}"
                    onclick="toggleCategory('\${cat.id}')"
                >
                    <strong>\${cat.name}</strong>
                    <div style="font-size: 14px; color: #666; margin-top: 5px;">
                        \${cat.path}
                    </div>
                </div>
            \`).join('');

            downloadBtn.disabled = state.selectedCategories.length === 0;
        }

        // 카테고리 선택/해제
        function toggleCategory(categoryId) {
            helper.toggleCategory(state, categoryId);
            renderResults();
        }

        // 다운로드 버튼
        downloadBtn.addEventListener('click', async () => {
            try {
                downloadBtn.disabled = true;
                downloadBtn.textContent = '다운로드 중...';
                
                await helper.handleDownload(state);
                
                downloadBtn.textContent = '✅ 다운로드 완료!';
                setTimeout(() => {
                    downloadBtn.textContent = '선택한 카테고리 견적서 다운로드';
                    downloadBtn.disabled = state.selectedCategories.length === 0;
                }, 2000);
            } catch (error) {
                alert('다운로드 실패: ' + error.message);
                downloadBtn.textContent = '선택한 카테고리 견적서 다운로드';
                downloadBtn.disabled = false;
            }
        });
    </script>
</body>
</html>
`;


// Node.js 환경 지원
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CoupangQuotationClient,
        CoupangQuotationUIHelper
    };
}
