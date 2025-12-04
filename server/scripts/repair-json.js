#!/usr/bin/env node
/**
 * 손상된 products.json 복구 스크립트
 *
 * 사용법: node repair-json.js <user_id>
 * 예: node repair-json.js 4
 */

const fs = require('fs');
const path = require('path');

const userId = process.argv[2];
if (!userId) {
  console.log('사용법: node repair-json.js <user_id>');
  process.exit(1);
}

const dataDir = path.join(__dirname, '..', 'data', 'products', `user_${userId}`);
const filePath = path.join(dataDir, 'products.json');
const backupPath = path.join(dataDir, `products.backup.${Date.now()}.json`);

console.log(`\n📁 파일 경로: ${filePath}`);

if (!fs.existsSync(filePath)) {
  console.log('❌ 파일이 존재하지 않습니다.');
  process.exit(1);
}

// 파일 읽기
const rawData = fs.readFileSync(filePath, 'utf8');
console.log(`📊 파일 크기: ${(rawData.length / 1024 / 1024).toFixed(2)} MB`);

// JSON 파싱 시도
try {
  const products = JSON.parse(rawData);
  console.log(`✅ JSON 유효함 - ${products.length}개 상품`);

  // 최적화 진행
  console.log('\n🔧 데이터 최적화 시작...');

  let totalSaved = 0;
  const optimizedProducts = products.map(product => {
    const originalSize = JSON.stringify(product).length;

    // base64 이미지 제거
    if (product.detailPageItems && Array.isArray(product.detailPageItems)) {
      product.detailPageItems = product.detailPageItems.map(item => {
        if (item.type === 'IMAGE' && item.content && item.content.startsWith('data:image')) {
          return { ...item, content: '[BASE64_REMOVED]' };
        }
        return item;
      });
    }

    // detailHtml이 너무 크면 제거
    if (product.detailHtml && product.detailHtml.length > 100000) {
      product.detailHtml = '';
    }

    const newSize = JSON.stringify(product).length;
    totalSaved += (originalSize - newSize);

    return product;
  });

  console.log(`💾 절약된 용량: ${(totalSaved / 1024 / 1024).toFixed(2)} MB`);

  // 백업 후 저장
  fs.writeFileSync(backupPath, rawData);
  console.log(`📦 백업 저장: ${backupPath}`);

  fs.writeFileSync(filePath, JSON.stringify(optimizedProducts, null, 2));
  const newSize = fs.statSync(filePath).size;
  console.log(`✅ 최적화 완료: ${(newSize / 1024 / 1024).toFixed(2)} MB`);

} catch (e) {
  console.log(`\n❌ JSON 파싱 실패: ${e.message}`);

  // 에러 위치 추출
  const posMatch = e.message.match(/position (\d+)/);
  if (posMatch) {
    const errorPos = parseInt(posMatch[1]);
    console.log(`\n📍 에러 위치: ${errorPos} (${(errorPos / 1024 / 1024).toFixed(2)} MB)`);
    console.log('\n🔍 에러 주변 내용:');
    console.log('---');
    console.log(rawData.substring(Math.max(0, errorPos - 200), errorPos));
    console.log('>>> ERROR HERE <<<');
    console.log(rawData.substring(errorPos, Math.min(rawData.length, errorPos + 200)));
    console.log('---');

    // 복구 시도: 에러 위치 전까지 파싱 시도
    console.log('\n🔧 복구 시도 중...');

    // 마지막 유효한 ] 찾기
    let lastValidPos = errorPos;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < errorPos; i++) {
      const char = rawData[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '[' || char === '{') bracketCount++;
        if (char === ']' || char === '}') {
          bracketCount--;
          if (bracketCount === 0 && char === ']') {
            lastValidPos = i + 1;
          }
        }
      }
    }

    // 마지막으로 완전한 객체가 끝나는 위치 찾기
    let searchPos = errorPos - 1;
    while (searchPos > 0) {
      // },{ 또는 }] 패턴 찾기
      if (rawData[searchPos] === '}') {
        // 이 위치에서 잘라서 ]로 닫기 시도
        const truncated = rawData.substring(0, searchPos + 1) + ']';
        try {
          const recovered = JSON.parse(truncated);
          console.log(`\n✅ 복구 성공! ${recovered.length}개 상품 복구됨`);

          // 백업
          fs.writeFileSync(backupPath, rawData);
          console.log(`📦 원본 백업: ${backupPath}`);

          // 복구된 데이터 저장
          fs.writeFileSync(filePath, JSON.stringify(recovered, null, 2));
          console.log(`💾 복구된 데이터 저장 완료`);

          process.exit(0);
        } catch (e2) {
          // 계속 시도
        }
      }
      searchPos--;

      // 너무 많이 돌아가면 중단
      if (errorPos - searchPos > 10000000) {
        console.log('⚠️ 복구 실패 - 수동 복구 필요');
        break;
      }
    }
  }
}
