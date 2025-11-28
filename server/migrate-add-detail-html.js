const fs = require('fs').promises;
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products', 'products.json');

// 기본 상세페이지 HTML 생성 (editor.html의 generateDefaultDetailHtml과 동일)
function generateDefaultDetailHtml(product) {
  const title = product.title || product.titleCn || '상품명';
  const description = product.description || '';
  const mainImage = product.mainImage || '';
  const images = product.images || [];
  const options = product.results || [];

  let html = `
<div style="max-width: 800px; margin: 0 auto; font-family: Arial, sans-serif;">
  <!-- 상품 제목 -->
  <h1 style="font-size: 28px; font-weight: bold; margin-bottom: 20px; color: #333;">
    ${title}
  </h1>

  <!-- 대표 이미지 -->
  ${mainImage ? `
  <div style="margin-bottom: 30px; text-align: center;">
    <img src="${mainImage}" style="max-width: 100%; height: auto; border-radius: 8px;">
  </div>
  ` : ''}

  <!-- 상품 설명 -->
  ${description ? `
  <div style="margin-bottom: 30px; padding: 20px; background: #f9f9f9; border-radius: 8px;">
    <h2 style="font-size: 20px; margin-bottom: 12px; color: #333;">상품 설명</h2>
    <p style="font-size: 15px; line-height: 1.8; color: #666;">
      ${description}
    </p>
  </div>
  ` : ''}

  <!-- 옵션 정보 -->
  ${options.length > 0 ? `
  <div style="margin-bottom: 30px;">
    <h2 style="font-size: 20px; margin-bottom: 12px; color: #333;">구매 옵션</h2>
    <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="padding: 12px; border: 1px solid #ddd; text-align: left;">옵션</th>
          <th style="padding: 12px; border: 1px solid #ddd; text-align: right;">가격</th>
        </tr>
      </thead>
      <tbody>
        ${options.map(opt => `
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;">
            ${opt.optionName1 || opt.optionName1Cn || ''}
            ${opt.optionName2 || opt.optionName2Cn ? ' - ' + (opt.optionName2 || opt.optionName2Cn) : ''}
          </td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: right;">
            ${opt.price ? opt.price.toLocaleString() + '원' : '-'}
          </td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- 추가 이미지들 -->
  ${images.length > 0 ? `
  <div style="margin-bottom: 30px;">
    <h2 style="font-size: 20px; margin-bottom: 12px; color: #333;">상세 이미지</h2>
    ${images.map(img => `
    <div style="margin-bottom: 20px; text-align: center;">
      <img src="${img}" style="max-width: 100%; height: auto; border-radius: 8px;">
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- 주의사항 -->
  <div style="margin-top: 40px; padding: 20px; background: #fff9e6; border-left: 4px solid #ffcc00; border-radius: 4px;">
    <h3 style="font-size: 16px; margin-bottom: 10px; color: #333;">구매 전 확인사항</h3>
    <ul style="font-size: 14px; line-height: 1.8; color: #666; padding-left: 20px;">
      <li>상품의 색상 및 사이즈는 모니터 해상도에 따라 실제와 다를 수 있습니다.</li>
      <li>교환 및 반품은 상품 수령 후 7일 이내 가능합니다.</li>
      <li>사용한 상품이나 포장이 훼손된 경우 교환/반품이 불가능할 수 있습니다.</li>
      <li>배송비는 구매 금액에 따라 달라질 수 있습니다.</li>
    </ul>
  </div>
</div>
  `.trim();

  return html;
}

async function migrateProducts() {
  try {
    console.log('🔄 상품 데이터 마이그레이션 시작...\n');

    // products.json 읽기
    const data = await fs.readFile(PRODUCTS_FILE, 'utf-8');
    const products = JSON.parse(data);

    console.log(`📦 총 ${products.length}개의 상품 발견\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    // 각 상품에 대해 detailHtml 생성
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const productTitle = product.title || product.titleCn || `상품 ${i + 1}`;

      if (!product.detailHtml || product.detailHtml.trim() === '') {
        console.log(`  ✏️  [${i + 1}/${products.length}] ${productTitle.substring(0, 40)}`);
        console.log(`      - results: ${product.results?.length || 0}개`);
        console.log(`      - images: ${product.images?.length || 0}개`);

        // detailHtml 생성
        product.detailHtml = generateDefaultDetailHtml(product);
        console.log(`      ✅ detailHtml 생성 완료 (${product.detailHtml.length} 자)`);

        updatedCount++;
      } else {
        console.log(`  ⏭️  [${i + 1}/${products.length}] ${productTitle.substring(0, 40)} - 이미 detailHtml 존재`);
        skippedCount++;
      }
    }

    // 백업 파일 생성
    const backupFile = PRODUCTS_FILE.replace('.json', `.backup-${Date.now()}.json`);
    await fs.writeFile(backupFile, data, 'utf-8');
    console.log(`\n💾 백업 파일 생성: ${backupFile}`);

    // 업데이트된 데이터 저장
    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');

    console.log(`\n✅ 마이그레이션 완료!`);
    console.log(`   - 업데이트: ${updatedCount}개`);
    console.log(`   - 건너뜀: ${skippedCount}개`);
    console.log(`   - 총: ${products.length}개\n`);

  } catch (error) {
    console.error('❌ 마이그레이션 오류:', error);
    process.exit(1);
  }
}

// 실행
migrateProducts();
