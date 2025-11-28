// 쿠팡 판매자 페이지 카테고리 수집 스크립트
// 브라우저 콘솔에서 실행하세요 (F12 -> Console)

class CoupangCategoryCollector {
    constructor() {
        this.baseUrl = '/qvt/kan-categories/find-by-parent';
        this.allCategories = {};
        this.discoveredIds = new Set();
    }

    async fetchCategories(kanCategoryId = null, kanLevel = 1) {
        const params = new URLSearchParams({ kanLevel: kanLevel.toString() });
        if (kanCategoryId !== null) {
            params.append('kanCategoryId', kanCategoryId.toString());
        }

        const url = `${this.baseUrl}?${params.toString()}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                }
            });

            if (!response.ok) {
                console.log(`❌ ID ${kanCategoryId}: ${response.status}`);
                return null;
            }

            const contentType = response.headers.get('content-type');
            
            if (contentType.includes('application/json')) {
                return await response.json();
            } else {
                const html = await response.text();
                return this.parseHtmlCategories(html);
            }
        } catch (error) {
            console.error(`Error fetching ID ${kanCategoryId}:`, error);
            return null;
        }
    }

    parseHtmlCategories(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const items = doc.querySelectorAll('.dropdown-item span');
        
        return Array.from(items).map(span => span.textContent.trim());
    }

    async discoverAllCategories(maxId = 100) {
        console.log('🔍 카테고리 ID 탐색 시작...');
        
        for (let id = 1; id <= maxId; id++) {
            const categories = await this.fetchCategories(id, 2);
            
            if (categories && categories.length > 0) {
                this.allCategories[id] = categories;
                this.discoveredIds.add(id);
                console.log(`✓ ID ${id}: ${categories.length}개 카테고리 - ${categories.slice(0, 3).join(', ')}${categories.length > 3 ? '...' : ''}`);
            }
            
            // 진행 상황 표시
            if (id % 10 === 0) {
                console.log(`📊 진행: ${id}/${maxId} (발견된 ID: ${this.discoveredIds.size}개)`);
            }
            
            // API 부하 방지를 위한 딜레이
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`\n✅ 완료! 총 ${this.discoveredIds.size}개의 유효한 카테고리 ID 발견`);
        return this.allCategories;
    }

    async collectLevel3Categories() {
        console.log('\n🔍 Level 3 카테고리 수집 시작...');
        const level3Data = {};
        
        for (const parentId of this.discoveredIds) {
            const subCategories = this.allCategories[parentId];
            
            for (let i = 0; i < subCategories.length; i++) {
                // Level 3는 추가 API 호출이 필요할 수 있음
                // 현재는 Level 2까지만 수집
            }
        }
        
        return level3Data;
    }

    downloadAsJSON(filename = 'coupang_categories.json') {
        const dataStr = JSON.stringify(this.allCategories, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log(`💾 파일 다운로드 시작: ${filename}`);
    }

    downloadAsCSV(filename = 'coupang_categories.csv') {
        let csv = 'Category ID,Category Name\n';
        
        for (const [id, categories] of Object.entries(this.allCategories)) {
            for (const category of categories) {
                csv += `${id},"${category}"\n`;
            }
        }
        
        const dataBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log(`💾 CSV 파일 다운로드 시작: ${filename}`);
    }
}

// 사용 방법:
console.log(`
╔════════════════════════════════════════════════════════════╗
║       쿠팡 판매자 카테고리 수집 스크립트                    ║
╚════════════════════════════════════════════════════════════╝

사용 방법:

1. 모든 카테고리 수집:
   const collector = new CoupangCategoryCollector();
   await collector.discoverAllCategories();
   
2. JSON 파일로 다운로드:
   collector.downloadAsJSON();
   
3. CSV 파일로 다운로드:
   collector.downloadAsCSV();

4. 전체 실행 (한 번에):
   const collector = new CoupangCategoryCollector();
   await collector.discoverAllCategories();
   collector.downloadAsJSON();
   collector.downloadAsCSV();
`);

// 자동 실행을 원하시면 아래 주석을 해제하세요:
/*
(async () => {
    const collector = new CoupangCategoryCollector();
    await collector.discoverAllCategories(100);
    collector.downloadAsJSON();
    collector.downloadAsCSV();
})();
*/
