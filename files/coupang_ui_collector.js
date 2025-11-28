// 쿠팡 판매자 페이지 - UI 자동 클릭 카테고리 수집
// 상품 등록 페이지에서 실행하세요

class CoupangUICollector {
    constructor() {
        this.allCategories = {
            level1: [],
            level2: {},
            level3: {}
        };
        this.delay = 300; // 클릭 간 딜레이 (ms)
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Level 1 카테고리 (대분류) 수집
    async collectLevel1() {
        console.log('📂 Level 1 카테고리 수집 시작...');
        
        const level1Container = document.querySelector('.qvt-cate-tree .col.rsfe-scroll');
        if (!level1Container) {
            console.error('❌ Level 1 컨테이너를 찾을 수 없습니다.');
            return;
        }

        const items = level1Container.querySelectorAll('.dropdown-item');
        
        for (const item of items) {
            const span = item.querySelector('span');
            if (span) {
                const categoryName = span.textContent.trim();
                this.allCategories.level1.push(categoryName);
                console.log(`  ✓ ${categoryName}`);
            }
        }
        
        console.log(`✅ Level 1 완료: ${this.allCategories.level1.length}개 카테고리 발견\n`);
    }

    // Level 2 카테고리 (중분류) 수집
    async collectLevel2() {
        console.log('📂 Level 2 카테고리 수집 시작...');
        
        const level1Container = document.querySelector('.qvt-cate-tree .col.rsfe-scroll');
        if (!level1Container) {
            console.error('❌ Level 1 컨테이너를 찾을 수 없습니다.');
            return;
        }

        const level1Items = level1Container.querySelectorAll('.dropdown-item');
        
        for (let i = 0; i < level1Items.length; i++) {
            const item = level1Items[i];
            const level1Name = item.querySelector('span')?.textContent.trim();
            
            if (!level1Name) continue;
            
            console.log(`\n🔍 "${level1Name}" 하위 카테고리 수집 중...`);
            
            // Level 1 항목 클릭
            item.click();
            await this.wait(this.delay);
            
            // Level 2 컨테이너 찾기
            const level2Container = document.querySelectorAll('.qvt-cate-tree .col.rsfe-scroll')[1];
            
            if (level2Container) {
                const level2Items = level2Container.querySelectorAll('.dropdown-item span');
                const level2Categories = Array.from(level2Items).map(span => span.textContent.trim());
                
                this.allCategories.level2[level1Name] = level2Categories;
                
                console.log(`  ✓ ${level2Categories.length}개 하위 카테고리: ${level2Categories.slice(0, 3).join(', ')}${level2Categories.length > 3 ? '...' : ''}`);
            }
        }
        
        const totalLevel2 = Object.values(this.allCategories.level2).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`\n✅ Level 2 완료: ${totalLevel2}개 카테고리 발견\n`);
    }

    // Level 3 카테고리 (소분류) 수집
    async collectLevel3() {
        console.log('📂 Level 3 카테고리 수집 시작...');
        
        const level1Container = document.querySelector('.qvt-cate-tree .col.rsfe-scroll');
        if (!level1Container) {
            console.error('❌ Level 1 컨테이너를 찾을 수 없습니다.');
            return;
        }

        const level1Items = level1Container.querySelectorAll('.dropdown-item');
        
        for (let i = 0; i < level1Items.length; i++) {
            const level1Item = level1Items[i];
            const level1Name = level1Item.querySelector('span')?.textContent.trim();
            
            if (!level1Name) continue;
            
            // Level 1 클릭
            level1Item.click();
            await this.wait(this.delay);
            
            const level2Container = document.querySelectorAll('.qvt-cate-tree .col.rsfe-scroll')[1];
            if (!level2Container) continue;
            
            const level2Items = level2Container.querySelectorAll('.dropdown-item');
            
            this.allCategories.level3[level1Name] = {};
            
            for (let j = 0; j < level2Items.length; j++) {
                const level2Item = level2Items[j];
                const level2Name = level2Item.querySelector('span')?.textContent.trim();
                
                if (!level2Name) continue;
                
                // Level 2 클릭
                level2Item.click();
                await this.wait(this.delay);
                
                const level3Container = document.querySelectorAll('.qvt-cate-tree .col.rsfe-scroll')[2];
                
                if (level3Container) {
                    const level3Items = level3Container.querySelectorAll('.dropdown-item span');
                    const level3Categories = Array.from(level3Items).map(span => span.textContent.trim());
                    
                    if (level3Categories.length > 0) {
                        this.allCategories.level3[level1Name][level2Name] = level3Categories;
                        console.log(`  ✓ ${level1Name} > ${level2Name}: ${level3Categories.length}개`);
                    }
                }
            }
        }
        
        console.log('\n✅ Level 3 완료\n');
    }

    // 전체 수집 (모든 레벨)
    async collectAll() {
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║       쿠팡 카테고리 전체 수집 시작                         ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        
        await this.collectLevel1();
        await this.collectLevel2();
        await this.collectLevel3();
        
        this.printSummary();
        
        return this.allCategories;
    }

    printSummary() {
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║       수집 완료 요약                                        ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        
        const level1Count = this.allCategories.level1.length;
        const level2Count = Object.values(this.allCategories.level2).reduce((sum, arr) => sum + arr.length, 0);
        
        let level3Count = 0;
        for (const level1 of Object.values(this.allCategories.level3)) {
            for (const level2 of Object.values(level1)) {
                level3Count += level2.length;
            }
        }
        
        console.log(`📊 Level 1 (대분류): ${level1Count}개`);
        console.log(`📊 Level 2 (중분류): ${level2Count}개`);
        console.log(`📊 Level 3 (소분류): ${level3Count}개`);
        console.log(`📊 총 카테고리: ${level1Count + level2Count + level3Count}개\n`);
    }

    // 계층적 구조로 변환
    convertToHierarchy() {
        const hierarchy = [];
        
        for (const level1Name of this.allCategories.level1) {
            const level1Node = {
                name: level1Name,
                children: []
            };
            
            const level2Categories = this.allCategories.level2[level1Name] || [];
            
            for (const level2Name of level2Categories) {
                const level2Node = {
                    name: level2Name,
                    children: []
                };
                
                const level3Categories = this.allCategories.level3[level1Name]?.[level2Name] || [];
                
                for (const level3Name of level3Categories) {
                    level2Node.children.push({ name: level3Name });
                }
                
                level1Node.children.push(level2Node);
            }
            
            hierarchy.push(level1Node);
        }
        
        return hierarchy;
    }

    // CSV 형식으로 변환
    convertToCSV() {
        let csv = 'Level 1,Level 2,Level 3\n';
        
        for (const level1Name of this.allCategories.level1) {
            const level2Categories = this.allCategories.level2[level1Name] || [];
            
            if (level2Categories.length === 0) {
                csv += `"${level1Name}","",""\n`;
            } else {
                for (const level2Name of level2Categories) {
                    const level3Categories = this.allCategories.level3[level1Name]?.[level2Name] || [];
                    
                    if (level3Categories.length === 0) {
                        csv += `"${level1Name}","${level2Name}",""\n`;
                    } else {
                        for (const level3Name of level3Categories) {
                            csv += `"${level1Name}","${level2Name}","${level3Name}"\n`;
                        }
                    }
                }
            }
        }
        
        return csv;
    }

    // JSON 다운로드
    downloadJSON(filename = 'coupang_categories_full.json') {
        const hierarchy = this.convertToHierarchy();
        const dataStr = JSON.stringify({ 
            raw: this.allCategories,
            hierarchy: hierarchy
        }, null, 2);
        
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log(`💾 JSON 파일 다운로드: ${filename}`);
    }

    // CSV 다운로드
    downloadCSV(filename = 'coupang_categories_full.csv') {
        const csv = this.convertToCSV();
        const dataBlob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log(`💾 CSV 파일 다운로드: ${filename}`);
    }
}

// 사용 방법
console.log(`
╔════════════════════════════════════════════════════════════╗
║   쿠팡 판매자 카테고리 자동 수집 (UI 클릭 방식)            ║
╚════════════════════════════════════════════════════════════╝

📌 사용 전 준비:
1. 쿠팡 판매자센터 > 상품 등록 페이지로 이동
2. 카테고리 선택 드롭다운이 화면에 보이도록 스크롤

📌 사용 방법:

// 1. 수집기 생성
const collector = new CoupangUICollector();

// 2. 전체 카테고리 수집 (Level 1~3)
await collector.collectAll();

// 3. 파일 다운로드
collector.downloadJSON();
collector.downloadCSV();

// 또는 한 번에:
const collector = new CoupangUICollector();
await collector.collectAll();
collector.downloadJSON();
collector.downloadCSV();

⏱️  예상 소요 시간: 약 30초~1분
`);
