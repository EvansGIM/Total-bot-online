const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');

// 상품 데이터 저장 경로
const PRODUCTS_DIR = path.join(__dirname, '../data/products');
const PRODUCTS_FILE = path.join(PRODUCTS_DIR, 'products.json');

// 디렉토리 생성
async function ensureDirectoryExists() {
  try {
    await fs.mkdir(PRODUCTS_DIR, { recursive: true });
  } catch (error) {
    console.error('디렉토리 생성 오류:', error);
  }
}

// 상품 데이터 로드
async function loadProducts() {
  try {
    await ensureDirectoryExists();
    const data = await fs.readFile(PRODUCTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // 파일이 없으면 빈 배열 반환
    }
    throw error;
  }
}

// 상품 데이터 저장
async function saveProducts(products) {
  await ensureDirectoryExists();
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
}

// 상품 목록 조회
router.get('/list', async (req, res) => {
  try {
    const products = await loadProducts();
    res.json({ success: true, products });
  } catch (error) {
    console.error('상품 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '상품 목록 조회 실패' });
  }
});

// 상품 상세 조회
router.get('/:id', async (req, res) => {
  try {
    const products = await loadProducts();
    const product = products.find(p => p.id === req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error('상품 조회 오류:', error);
    res.status(500).json({ success: false, message: '상품 조회 실패' });
  }
});

// 번역 헬퍼 함수
async function translateText(text) {
  if (!text || !text.trim()) {
    return '';
  }

  try {
    const url = 'https://translate.googleapis.com/translate_a/single';
    const params = {
      client: 'gtx',
      sl: 'zh-CN',
      tl: 'ko',
      dt: 't',
      q: text
    };

    const response = await axios.get(url, {
      params,
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data && response.data[0] && response.data[0][0] && response.data[0][0][0]) {
      return response.data[0][0][0];
    }

    return text; // 번역 실패 시 원본 반환
  } catch (error) {
    console.error('번역 오류:', error.message);
    return text; // 오류 시 원본 반환
  }
}

// 상품 저장 (Chrome Extension에서 호출)
router.post('/save', async (req, res) => {
  try {
    const productData = req.body;

    if (!productData || !productData.results) {
      return res.status(400).json({ success: false, message: '유효하지 않은 상품 데이터입니다.' });
    }

    // 병렬 번역을 위한 Promise 배열
    const translationPromises = [];

    // 상품명 번역
    if (productData.titleCn && (!productData.title || productData.title.trim() === '')) {
      console.log('[Products API] 상품명 번역 예약:', productData.titleCn);
      translationPromises.push(
        translateText(productData.titleCn).then(result => {
          productData.title = result;
        })
      );
    }

    // 옵션명 번역 (results 배열의 각 항목)
    if (productData.results && Array.isArray(productData.results)) {
      for (const item of productData.results) {
        // optionName1Cn → optionName1
        if (item.optionName1Cn && (!item.optionName1 || item.optionName1 === item.optionName1Cn)) {
          translationPromises.push(
            translateText(item.optionName1Cn).then(result => {
              item.optionName1 = result;
            })
          );
        }

        // optionName2Cn → optionName2
        if (item.optionName2Cn && (!item.optionName2 || item.optionName2 === item.optionName2Cn)) {
          translationPromises.push(
            translateText(item.optionName2Cn).then(result => {
              item.optionName2 = result;
            })
          );
        }
      }
    }

    // 모든 번역 동시 실행
    if (translationPromises.length > 0) {
      console.log('[Products API] 병렬 번역 시작:', translationPromises.length, '개');
      await Promise.all(translationPromises);
      console.log('[Products API] 병렬 번역 완료');
    }

    // 고유 ID 생성
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    productData.id = id;
    productData.savedAt = new Date().toISOString();
    productData.status = 'collected'; // 기본 상태: 상품 수집

    // 기존 상품 로드
    const products = await loadProducts();

    // 새 상품 추가
    products.push(productData);

    // 저장
    await saveProducts(products);

    console.log('[Products API] 상품 저장 완료:', id);
    res.json({ success: true, id, product: productData });
  } catch (error) {
    console.error('상품 저장 오류:', error);
    res.status(500).json({ success: false, message: '상품 저장 실패' });
  }
});

// 상품 수정
router.put('/:id', async (req, res) => {
  try {
    const products = await loadProducts();
    const index = products.findIndex(p => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    // 디버깅: 수신한 데이터 확인
    console.log('[Products API] 수신한 데이터:');
    console.log('  - title:', req.body.title || req.body.titleCn);
    console.log('  - results count:', req.body.results?.length || 0);
    console.log('  - images count:', req.body.images?.length || 0);
    console.log('  - Has detailHtml:', !!req.body.detailHtml);
    console.log('  - detailHtml length:', req.body.detailHtml?.length || 0);
    if (req.body.detailHtml) {
      console.log('  - detailHtml preview:', req.body.detailHtml.substring(0, 100));
    }

    // 수정된 데이터로 업데이트
    products[index] = {
      ...products[index],
      ...req.body,
      id: req.params.id, // ID는 변경 불가
      updatedAt: new Date().toISOString()
    };

    await saveProducts(products);

    console.log('[Products API] 상품 수정 완료:', req.params.id);
    console.log('[Products API] 저장된 데이터의 detailHtml 길이:', products[index].detailHtml?.length || 0);
    res.json({ success: true, product: products[index] });
  } catch (error) {
    console.error('상품 수정 오류:', error);
    res.status(500).json({ success: false, message: '상품 수정 실패' });
  }
});

// 상품 삭제
router.delete('/:id', async (req, res) => {
  try {
    const products = await loadProducts();
    const filtered = products.filter(p => p.id !== req.params.id);

    if (filtered.length === products.length) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    await saveProducts(filtered);

    console.log('[Products API] 상품 삭제 완료:', req.params.id);
    res.json({ success: true, message: '상품이 삭제되었습니다.' });
  } catch (error) {
    console.error('상품 삭제 오류:', error);
    res.status(500).json({ success: false, message: '상품 삭제 실패' });
  }
});

// 상품 일괄 삭제
router.post('/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ success: false, message: '유효하지 않은 요청입니다.' });
    }

    const products = await loadProducts();
    const filtered = products.filter(p => !ids.includes(p.id));

    await saveProducts(filtered);

    console.log('[Products API] 상품 일괄 삭제 완료:', ids.length, '개');
    res.json({ success: true, message: `${ids.length}개 상품이 삭제되었습니다.` });
  } catch (error) {
    console.error('상품 일괄 삭제 오류:', error);
    res.status(500).json({ success: false, message: '상품 삭제 실패' });
  }
});

// 상품 상태 변경
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['collected', 'uploaded', 'approved'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 상태입니다. (collected, uploaded, approved 중 하나)'
      });
    }

    const products = await loadProducts();
    const index = products.findIndex(p => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    products[index].status = status;
    products[index].statusUpdatedAt = new Date().toISOString();

    await saveProducts(products);

    console.log('[Products API] 상품 상태 변경:', req.params.id, '->', status);
    res.json({ success: true, product: products[index] });
  } catch (error) {
    console.error('상품 상태 변경 오류:', error);
    res.status(500).json({ success: false, message: '상품 상태 변경 실패' });
  }
});

// 상품 일괄 상태 변경
router.post('/batch-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    const validStatuses = ['collected', 'uploaded', 'approved'];

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '상품 ID가 필요합니다.' });
    }

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 상태입니다. (collected, uploaded, approved 중 하나)'
      });
    }

    const products = await loadProducts();
    let updatedCount = 0;

    for (const product of products) {
      if (ids.includes(product.id)) {
        product.status = status;
        product.statusUpdatedAt = new Date().toISOString();
        updatedCount++;
      }
    }

    await saveProducts(products);

    console.log('[Products API] 상품 일괄 상태 변경:', updatedCount, '개 ->', status);
    res.json({ success: true, message: `${updatedCount}개 상품 상태가 변경되었습니다.`, updatedCount });
  } catch (error) {
    console.error('상품 일괄 상태 변경 오류:', error);
    res.status(500).json({ success: false, message: '상품 상태 변경 실패' });
  }
});

// 상세페이지 자동 생성
router.post('/generate-detail', async (req, res) => {
  try {
    const { productData } = req.body;

    if (!productData) {
      return res.status(400).json({ success: false, message: '상품 데이터가 필요합니다.' });
    }

    // 상세페이지 HTML 생성
    const html = generateDetailPageHtml(productData);

    res.json({ success: true, html });
  } catch (error) {
    console.error('상세페이지 생성 오류:', error);
    res.status(500).json({ success: false, message: '상세페이지 생성 실패' });
  }
});

// 상세페이지 HTML 생성 함수
function generateDetailPageHtml(product) {
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
  `;

  return html.trim();
}

// 라벨컷 HTML 생성 함수 (하단 표시사항만)
function generateLabelHtml(product) {
  const title = product.title || product.titleCn || '상품명';

  // detailPageItems에서 quality-table 찾기
  let qualityTable = null;
  if (product.detailPageItems && Array.isArray(product.detailPageItems)) {
    qualityTable = product.detailPageItems.find(item => item.type === 'quality-table');
  }

  // 품질표시사항 테이블 HTML 생성
  let tableHtml = '';
  if (qualityTable && qualityTable.rows && qualityTable.rows.length > 0) {
    tableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
      ${qualityTable.rows.map(row => `
      <tr style="border-bottom: 1px solid #e0e0e0;">
        <td style="padding: 10px; font-weight: 600; color: #555; width: 35%; vertical-align: top;">${row.label || ''}</td>
        <td style="padding: 10px; color: #666;">${row.value || ''}</td>
      </tr>
      `).join('')}
    </table>
    `;
  } else {
    // 기본 정보 (편집하지 않은 경우)
    tableHtml = `
    <ul style="font-size: 14px; line-height: 1.8; color: #666; padding-left: 20px; margin: 0;">
      <li>상품명: ${title}</li>
      <li>제조국: 중국 OEM</li>
      <li>제조사: 협력사</li>
      <li>A/S 책임자와 전화번호: 1577-7011</li>
      <li>품질보증기준: 본 제품은 공정거래위원회 고시 분쟁 해결기준에 의거 교환 또는 보상 받으실 수 있습니다.</li>
      <li>상품의 색상 및 사이즈는 모니터 해상도에 따라 실제와 다를 수 있습니다.</li>
      <li>교환 및 반품은 상품 수령 후 7일 이내 가능합니다.</li>
      <li>사용한 상품이나 포장이 훼손된 경우 교환/반품이 불가능할 수 있습니다.</li>
    </ul>
    `;
  }

  const tableTitle = (qualityTable && qualityTable.title) || '품질표시사항';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: Arial, sans-serif;
      background: white;
    }
    .label-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 8px;
    }
    h3 {
      font-size: 18px;
      margin: 0 0 10px 0;
      color: #333;
    }
  </style>
</head>
<body>
  <div class="label-container">
    <h3>${tableTitle}</h3>
    ${tableHtml}
  </div>
</body>
</html>
  `.trim();
}

// HTML을 이미지로 변환하는 API
router.post('/html-to-image', async (req, res) => {
  let browser;
  try {
    const { html, type } = req.body; // type: 'detail' or 'label'

    if (!html) {
      return res.status(400).json({ success: false, message: 'HTML이 필요합니다.' });
    }

    console.log('[HTML to Image] 변환 시작:', type);

    // Puppeteer 브라우저 실행
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // HTML 설정
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // 라벨컷은 작은 크기, 상세페이지는 큰 크기
    if (type === 'label') {
      await page.setViewport({ width: 800, height: 400 });
    } else {
      await page.setViewport({ width: 800, height: 1200 });
    }

    // 스크린샷 촬영
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true
    });

    await browser.close();

    console.log('[HTML to Image] 변환 완료');

    // Base64로 변환하여 반환
    const base64Image = screenshot.toString('base64');
    res.json({
      success: true,
      image: `data:image/png;base64,${base64Image}`
    });

  } catch (error) {
    console.error('[HTML to Image] 오류:', error);
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ success: false, message: '이미지 변환 실패', error: error.message });
  }
});

// 상품의 상세페이지 + 라벨컷 이미지 생성 API
router.post('/generate-images', async (req, res) => {
  let browser;
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ success: false, message: '상품 데이터가 필요합니다.' });
    }

    console.log('[Generate Images] 시작:', products.length, '개 상품');

    // 편집하지 않은 제품 체크
    const uneditedProducts = [];
    for (let i = 0; i < products.length; i++) {
      let product = products[i];

      // 상품 ID가 있으면 DB에서 최신 데이터 확인
      if (product.id) {
        const allProducts = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf-8'));
        const latestProduct = allProducts.find(p => p.id === product.id);
        if (latestProduct) {
          product = latestProduct;
        }
      }

      // detailPageItems가 없거나 비어있으면 편집되지 않은 것
      if (!product.detailPageItems || product.detailPageItems.length === 0) {
        const productName = product.title || product.titleCn || `상품 ${i + 1}`;
        uneditedProducts.push(productName);
      }
    }

    // 편집하지 않은 제품이 있으면 에러 반환
    if (uneditedProducts.length > 0) {
      console.log('[Generate Images] 편집되지 않은 제품 발견:', uneditedProducts);
      return res.status(400).json({
        success: false,
        message: '일부 상품이 편집되지 않았습니다. 먼저 편집기에서 상세페이지를 편집하고 저장해주세요.',
        uneditedProducts: uneditedProducts
      });
    }

    const results = [];

    // Puppeteer 브라우저 실행 (재사용)
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (let i = 0; i < products.length; i++) {
      let product = products[i];

      // 상품 ID가 있으면 DB에서 최신 데이터 다시 읽기 (detailHtml 포함)
      if (product.id) {
        const allProducts = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf-8'));
        const latestProduct = allProducts.find(p => p.id === product.id);
        if (latestProduct) {
          console.log(`[Product ${i + 1}] DB에서 최신 데이터 로드 (ID: ${product.id})`);
          product = latestProduct;
        }
      }

      // 디버깅: 상품 정보 로깅
      console.log(`[Product ${i + 1}] ID: ${product.id}, Title: ${(product.title || product.titleCn || '').substring(0, 30)}`);
      console.log(`[Product ${i + 1}] Has detailHtml: ${!!product.detailHtml}, Length: ${product.detailHtml ? product.detailHtml.length : 0}`);
      if (product.detailHtml) {
        console.log(`[Product ${i + 1}] detailHtml preview (first 200 chars): ${product.detailHtml.substring(0, 200)}`);
      }

      // 사용자가 편집한 상세페이지 HTML 사용 (없으면 자동 생성)
      const detailHtml = product.detailHtml || generateDetailPageHtml(product);
      console.log(`[Product ${i + 1}] Using ${product.detailHtml ? 'USER-EDITED' : 'AUTO-GENERATED'} detailHtml`);

      // 라벨컷 HTML 생성
      const labelHtml = generateLabelHtml(product);

      // 상세페이지 이미지 생성
      const detailPage = await browser.newPage();
      await detailPage.setContent(detailHtml, { waitUntil: 'networkidle0' });
      await detailPage.setViewport({ width: 800, height: 1200 });
      const detailScreenshot = await detailPage.screenshot({
        type: 'png',
        fullPage: true
      });
      await detailPage.close();

      // 라벨컷 이미지 생성
      const labelPage = await browser.newPage();
      await labelPage.setContent(labelHtml, { waitUntil: 'networkidle0' });
      await labelPage.setViewport({ width: 800, height: 400 });
      const labelScreenshot = await labelPage.screenshot({
        type: 'png',
        fullPage: true
      });
      await labelPage.close();

      results.push({
        productIndex: i,
        detailImage: `data:image/png;base64,${detailScreenshot.toString('base64')}`,
        labelImage: `data:image/png;base64,${labelScreenshot.toString('base64')}`
      });

      console.log(`[Generate Images] ${i + 1}/${products.length} 완료`);
    }

    await browser.close();

    console.log('[Generate Images] 모두 완료');

    res.json({
      success: true,
      images: results
    });

  } catch (error) {
    console.error('[Generate Images] 오류:', error);
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ success: false, message: '이미지 생성 실패', error: error.message });
  }
});

module.exports = router;
