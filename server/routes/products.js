const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const authMiddleware = require('../middleware/auth');

// 상품 데이터 저장 기본 경로
const DATA_DIR = path.join(__dirname, '../data/products');

// 유저별 상품 파일 경로 반환
function getUserProductsFile(userId) {
  return path.join(DATA_DIR, String(userId), 'products.json');
}

// 유저별 디렉토리 생성
async function ensureUserDirectoryExists(userId) {
  const userDir = path.join(DATA_DIR, String(userId));
  try {
    await fs.mkdir(userDir, { recursive: true });
  } catch (error) {
    console.error('디렉토리 생성 오류:', error);
  }
}

// 유저별 상품 데이터 로드
async function loadUserProducts(userId) {
  try {
    await ensureUserDirectoryExists(userId);
    const filePath = getUserProductsFile(userId);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // 파일이 없으면 빈 배열 반환
    }
    throw error;
  }
}

// 유저별 상품 데이터 저장
async function saveUserProducts(userId, products) {
  await ensureUserDirectoryExists(userId);
  const filePath = getUserProductsFile(userId);
  await fs.writeFile(filePath, JSON.stringify(products, null, 2), 'utf-8');
}

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

    return text;
  } catch (error) {
    console.error('번역 오류:', error.message);
    return text;
  }
}

// ============================================
// 인증 필요 API (유저별 데이터)
// ============================================

// 상품 목록 조회 (인증 필요)
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const products = await loadUserProducts(userId);
    res.json({ success: true, products });
  } catch (error) {
    console.error('상품 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '상품 목록 조회 실패' });
  }
});

// 상품 상세 조회 (인증 필요)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const products = await loadUserProducts(userId);
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

// 상품 저장 (인증 필요)
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productData = req.body;

    if (!productData || !productData.results) {
      return res.status(400).json({ success: false, message: '유효하지 않은 상품 데이터입니다.' });
    }

    // 병렬 번역
    const translationPromises = [];

    if (productData.titleCn && (!productData.title || productData.title.trim() === '')) {
      translationPromises.push(
        translateText(productData.titleCn).then(result => {
          productData.title = result;
        })
      );
    }

    if (productData.results && Array.isArray(productData.results)) {
      for (const item of productData.results) {
        if (item.optionName1Cn && (!item.optionName1 || item.optionName1 === item.optionName1Cn)) {
          translationPromises.push(
            translateText(item.optionName1Cn).then(result => {
              item.optionName1 = result;
            })
          );
        }

        if (item.optionName2Cn && (!item.optionName2 || item.optionName2 === item.optionName2Cn)) {
          translationPromises.push(
            translateText(item.optionName2Cn).then(result => {
              item.optionName2 = result;
            })
          );
        }
      }
    }

    if (translationPromises.length > 0) {
      await Promise.all(translationPromises);
    }

    // 고유 ID 생성
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    productData.id = id;
    productData.userId = userId;
    productData.savedAt = new Date().toISOString();
    productData.status = 'collected';

    // 유저별 상품 로드 및 저장
    const products = await loadUserProducts(userId);
    products.push(productData);
    await saveUserProducts(userId, products);

    console.log(`[Products API] 상품 저장 완료 (User: ${userId}):`, id);
    res.json({ success: true, id, product: productData });
  } catch (error) {
    console.error('상품 저장 오류:', error);
    res.status(500).json({ success: false, message: '상품 저장 실패' });
  }
});

// 상품 수정 (인증 필요) - PUT
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const products = await loadUserProducts(userId);
    const index = products.findIndex(p => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    products[index] = {
      ...products[index],
      ...req.body,
      id: req.params.id,
      userId: userId,
      updatedAt: new Date().toISOString()
    };

    await saveUserProducts(userId, products);

    console.log(`[Products API] 상품 수정 완료 (User: ${userId}):`, req.params.id);
    res.json({ success: true, product: products[index] });
  } catch (error) {
    console.error('상품 수정 오류:', error);
    res.status(500).json({ success: false, message: '상품 수정 실패' });
  }
});

// 상품 부분 수정 (인증 필요) - PATCH (PUT과 동일한 동작)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const products = await loadUserProducts(userId);
    const index = products.findIndex(p => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    products[index] = {
      ...products[index],
      ...req.body,
      id: req.params.id,
      userId: userId,
      updatedAt: new Date().toISOString()
    };

    await saveUserProducts(userId, products);

    console.log(`[Products API] 상품 부분 수정 완료 (User: ${userId}):`, req.params.id);
    res.json({ success: true, product: products[index] });
  } catch (error) {
    console.error('상품 부분 수정 오류:', error);
    res.status(500).json({ success: false, message: '상품 수정 실패' });
  }
});

// 상품 삭제 (인증 필요)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const products = await loadUserProducts(userId);
    const filtered = products.filter(p => p.id !== req.params.id);

    if (filtered.length === products.length) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    await saveUserProducts(userId, filtered);

    console.log(`[Products API] 상품 삭제 완료 (User: ${userId}):`, req.params.id);
    res.json({ success: true, message: '상품이 삭제되었습니다.' });
  } catch (error) {
    console.error('상품 삭제 오류:', error);
    res.status(500).json({ success: false, message: '상품 삭제 실패' });
  }
});

// 상품 일괄 삭제 (인증 필요)
router.post('/batch-delete', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ success: false, message: '유효하지 않은 요청입니다.' });
    }

    const products = await loadUserProducts(userId);
    const filtered = products.filter(p => !ids.includes(p.id));

    await saveUserProducts(userId, filtered);

    console.log(`[Products API] 상품 일괄 삭제 완료 (User: ${userId}):`, ids.length, '개');
    res.json({ success: true, message: `${ids.length}개 상품이 삭제되었습니다.` });
  } catch (error) {
    console.error('상품 일괄 삭제 오류:', error);
    res.status(500).json({ success: false, message: '상품 삭제 실패' });
  }
});

// 상품 상태 변경 (인증 필요)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.body;
    const validStatuses = ['collected', 'uploaded', 'approved'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 상태입니다. (collected, uploaded, approved 중 하나)'
      });
    }

    const products = await loadUserProducts(userId);
    const index = products.findIndex(p => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    products[index].status = status;
    products[index].statusUpdatedAt = new Date().toISOString();

    await saveUserProducts(userId, products);

    console.log(`[Products API] 상품 상태 변경 (User: ${userId}):`, req.params.id, '->', status);
    res.json({ success: true, product: products[index] });
  } catch (error) {
    console.error('상품 상태 변경 오류:', error);
    res.status(500).json({ success: false, message: '상품 상태 변경 실패' });
  }
});

// 상품 일괄 상태 변경 (인증 필요)
router.post('/batch-status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
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

    const products = await loadUserProducts(userId);
    let updatedCount = 0;

    for (const product of products) {
      if (ids.includes(product.id)) {
        product.status = status;
        product.statusUpdatedAt = new Date().toISOString();
        updatedCount++;
      }
    }

    await saveUserProducts(userId, products);

    console.log(`[Products API] 상품 일괄 상태 변경 (User: ${userId}):`, updatedCount, '개 ->', status);
    res.json({ success: true, message: `${updatedCount}개 상품 상태가 변경되었습니다.`, updatedCount });
  } catch (error) {
    console.error('상품 일괄 상태 변경 오류:', error);
    res.status(500).json({ success: false, message: '상품 상태 변경 실패' });
  }
});

// ============================================
// 상세페이지 관련 API
// ============================================

// 상세페이지 자동 생성
router.post('/generate-detail', authMiddleware, async (req, res) => {
  try {
    const { productData } = req.body;

    if (!productData) {
      return res.status(400).json({ success: false, message: '상품 데이터가 필요합니다.' });
    }

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
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Noto Sans KR', sans-serif !important; }
    body { margin: 0; padding: 20px; background: white; }
  </style>
</head>
<body>
<div style="max-width: 800px; margin: 0 auto; font-family: 'Noto Sans KR', sans-serif;">
  <h1 style="font-size: 28px; font-weight: bold; margin-bottom: 20px; color: #333;">
    ${title}
  </h1>

  ${mainImage ? `
  <div style="margin-bottom: 30px; text-align: center;">
    <img src="${mainImage}" style="max-width: 100%; height: auto; border-radius: 8px;">
  </div>
  ` : ''}

  ${description ? `
  <div style="margin-bottom: 30px; padding: 20px; background: #f9f9f9; border-radius: 8px;">
    <h2 style="font-size: 20px; margin-bottom: 12px; color: #333;">상품 설명</h2>
    <p style="font-size: 15px; line-height: 1.8; color: #666;">
      ${description}
    </p>
  </div>
  ` : ''}

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
</body>
</html>
  `;

  return html.trim();
}

// 라벨컷 HTML 생성 함수
function generateLabelHtml(product) {
  const title = product.title || product.titleCn || '상품명';

  let qualityTable = null;
  if (product.detailPageItems && Array.isArray(product.detailPageItems)) {
    qualityTable = product.detailPageItems.find(item => item.type === 'quality-table');
  }

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
    tableHtml = `
    <ul style="font-size: 14px; line-height: 1.8; color: #666; padding-left: 20px; margin: 0;">
      <li>상품명: ${title}</li>
      <li>제조국: 중국 OEM</li>
      <li>제조사: 협력사</li>
      <li>A/S 책임자와 전화번호: 1577-7011</li>
      <li>품질보증기준: 본 제품은 공정거래위원회 고시 분쟁 해결기준에 의거 교환 또는 보상 받으실 수 있습니다.</li>
    </ul>
    `;
  }

  const tableTitle = (qualityTable && qualityTable.title) || '품질표시사항';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Noto Sans KR', sans-serif !important; }
    body { margin: 0; padding: 20px; font-family: 'Noto Sans KR', sans-serif; background: white; }
    .label-container { max-width: 800px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 8px; }
    h3 { font-size: 18px; margin: 0 0 10px 0; color: #333; }
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

// HTML을 이미지로 변환
router.post('/html-to-image', authMiddleware, async (req, res) => {
  let browser;
  try {
    const { html, type } = req.body;

    if (!html) {
      return res.status(400).json({ success: false, message: 'HTML이 필요합니다.' });
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    if (type === 'label') {
      await page.setViewport({ width: 800, height: 400 });
    } else {
      await page.setViewport({ width: 800, height: 1200 });
    }

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true
    });

    await browser.close();

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

// 상품 이미지 생성 API
router.post('/generate-images', authMiddleware, async (req, res) => {
  let browser;
  try {
    const userId = req.user.id;
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ success: false, message: '상품 데이터가 필요합니다.' });
    }

    console.log(`[Generate Images] 시작 (User: ${userId}):`, products.length, '개 상품');

    // 편집하지 않은 제품 체크
    const uneditedProducts = [];
    const userProducts = await loadUserProducts(userId);

    for (let i = 0; i < products.length; i++) {
      let product = products[i];

      if (product.id) {
        const latestProduct = userProducts.find(p => p.id === product.id);
        if (latestProduct) {
          product = latestProduct;
        }
      }

      if (!product.detailPageItems || product.detailPageItems.length === 0) {
        const productName = product.title || product.titleCn || `상품 ${i + 1}`;
        uneditedProducts.push(productName);
      }
    }

    if (uneditedProducts.length > 0) {
      return res.status(400).json({
        success: false,
        message: '일부 상품이 편집되지 않았습니다. 먼저 편집기에서 상세페이지를 편집하고 저장해주세요.',
        uneditedProducts: uneditedProducts
      });
    }

    const results = [];

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (let i = 0; i < products.length; i++) {
      let product = products[i];

      if (product.id) {
        const latestProduct = userProducts.find(p => p.id === product.id);
        if (latestProduct) {
          product = latestProduct;
        }
      }

      const detailHtml = product.detailHtml || generateDetailPageHtml(product);
      const labelHtml = generateLabelHtml(product);

      // 상세페이지 이미지
      const detailPage = await browser.newPage();
      await detailPage.setContent(detailHtml, { waitUntil: 'networkidle0' });
      await detailPage.setViewport({ width: 800, height: 1200 });
      // 웹폰트 로딩 대기
      await detailPage.evaluate(() => document.fonts.ready);
      await new Promise(resolve => setTimeout(resolve, 500)); // 추가 대기
      const detailScreenshot = await detailPage.screenshot({ type: 'png', fullPage: true });
      await detailPage.close();

      // 라벨컷 이미지
      const labelPage = await browser.newPage();
      await labelPage.setContent(labelHtml, { waitUntil: 'networkidle0' });
      await labelPage.setViewport({ width: 800, height: 400 });
      // 웹폰트 로딩 대기
      await labelPage.evaluate(() => document.fonts.ready);
      await new Promise(resolve => setTimeout(resolve, 500)); // 추가 대기
      const labelScreenshot = await labelPage.screenshot({ type: 'png', fullPage: true });
      await labelPage.close();

      results.push({
        productIndex: i,
        detailImage: `data:image/png;base64,${detailScreenshot.toString('base64')}`,
        labelImage: `data:image/png;base64,${labelScreenshot.toString('base64')}`
      });

      console.log(`[Generate Images] ${i + 1}/${products.length} 완료`);
    }

    await browser.close();

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
