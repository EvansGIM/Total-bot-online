const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const os = require('os');
const authMiddleware = require('../middleware/auth');

// 폰트 파일 경로
const FONTS_DIR = path.join(__dirname, '../assets/fonts');

// 상품 데이터 저장 기본 경로
const DATA_DIR = path.join(__dirname, '../data/products');

// 유저별 설정 파일 경로
const SETTINGS_DIR = path.join(__dirname, '../data/settings');

// 유저 설정 로드 함수 (브랜드명 등)
async function loadUserSettings(userId) {
  try {
    const filePath = path.join(SETTINGS_DIR, `user_${userId}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { brandName: '' };  // 기본값
  }
}

// 유저별 상품 파일 경로 반환 (레거시 - 마이그레이션용)
function getUserProductsFile(userId) {
  return path.join(DATA_DIR, String(userId), 'products.json');
}

// 유저별 이미지 디렉토리 경로
function getUserImagesDir(userId) {
  return path.join(DATA_DIR, String(userId), 'images');
}

// 유저별 개별 상품 디렉토리 경로 (새 구조)
function getUserItemsDir(userId) {
  return path.join(DATA_DIR, String(userId), 'items');
}

// 개별 상품 파일 경로
function getProductFilePath(userId, productId) {
  return path.join(getUserItemsDir(userId), `${productId}.json`);
}

// 유저별 인덱스 파일 경로 (가벼운 메타데이터만)
function getUserIndexFile(userId) {
  return path.join(DATA_DIR, String(userId), 'index.json');
}

// 유저별 디렉토리 생성
async function ensureUserDirectoryExists(userId) {
  const userDir = path.join(DATA_DIR, String(userId));
  const imagesDir = getUserImagesDir(userId);
  const itemsDir = getUserItemsDir(userId);
  try {
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(itemsDir, { recursive: true });
  } catch (error) {
    console.error('디렉토리 생성 오류:', error);
  }
}

// ===== 새로운 개별 파일 기반 저장 시스템 =====

// 개별 상품 저장
async function saveProduct(userId, product) {
  await ensureUserDirectoryExists(userId);
  const filePath = getProductFilePath(userId, product.id);

  try {
    await acquireLock(filePath);

    // base64 이미지 추출 및 저장
    product = await extractAndSaveImages(userId, product);

    await fs.writeFile(filePath, JSON.stringify(product, null, 2), 'utf-8');

    // 인덱스 업데이트
    await updateProductIndex(userId, product);
  } finally {
    releaseLock(filePath);
  }
}

// 개별 상품 로드
async function loadProduct(userId, productId) {
  const filePath = getProductFilePath(userId, productId);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// 개별 상품 삭제
async function deleteProduct(userId, productId) {
  const filePath = getProductFilePath(userId, productId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // 인덱스에서 제거
  await removeFromIndex(userId, productId);
}

// 인덱스 업데이트 (가벼운 메타데이터만 저장)
async function updateProductIndex(userId, product) {
  const indexPath = getUserIndexFile(userId);

  try {
    await acquireLock(indexPath);

    let index = [];
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      index = JSON.parse(data);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    // 기존 항목 찾기
    const existingIdx = index.findIndex(item => item.id === product.id);

    // 가격 추출 (여러 위치에서 찾기)
    const firstResult = product.results?.[0];
    const extractedPrice = product.price ||
                          firstResult?.price ||
                          firstResult?.unitPrice ||
                          firstResult?.optionName2Price ||
                          product.salePrice ||
                          product.basePrice ||
                          null;

    // 인덱스용 경량 데이터
    const indexItem = {
      id: product.id,
      title: product.title,
      titleCn: product.titleCn,
      mainImage: product.mainImage,
      platform: product.platform,
      url: product.url,
      status: product.status,
      savedAt: product.savedAt,
      uploadedAt: product.uploadedAt,
      quoteId: product.quoteId,
      resultsCount: product.results?.length || 0,
      // 가격 정보 (목록 표시용) - 여러 위치에서 추출
      price: extractedPrice,
      isEdited: !!(product.detailPageItems && product.detailPageItems.length > 0),
      skuStatus: product.skuStatus
    };

    if (existingIdx >= 0) {
      index[existingIdx] = indexItem;
    } else {
      index.push(indexItem);
    }

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } finally {
    releaseLock(indexPath);
  }
}

// 인덱스에서 상품 제거
async function removeFromIndex(userId, productId) {
  const indexPath = getUserIndexFile(userId);

  try {
    await acquireLock(indexPath);

    let index = [];
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      index = JSON.parse(data);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    index = index.filter(item => item.id !== productId);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } finally {
    releaseLock(indexPath);
  }
}

// 인덱스 로드 (상품 목록용 - 가벼움)
async function loadProductIndex(userId) {
  await ensureUserDirectoryExists(userId);
  const indexPath = getUserIndexFile(userId);

  try {
    const data = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 인덱스가 없으면 레거시 파일에서 마이그레이션 시도
      return await migrateFromLegacy(userId);
    }
    throw error;
  }
}

// 레거시 products.json에서 새 구조로 마이그레이션
async function migrateFromLegacy(userId) {
  const legacyPath = getUserProductsFile(userId);

  try {
    const data = await fs.readFile(legacyPath, 'utf-8');
    const products = JSON.parse(data);

    console.log(`[Migration] User ${userId}: ${products.length}개 상품 마이그레이션 시작`);

    // 각 상품을 개별 파일로 저장
    for (const product of products) {
      await saveProduct(userId, product);
    }

    // 레거시 파일 백업 후 삭제
    const backupPath = legacyPath.replace('.json', `.backup.${Date.now()}.json`);
    await fs.rename(legacyPath, backupPath);

    console.log(`[Migration] User ${userId}: 마이그레이션 완료, 백업: ${backupPath}`);

    // 새로 생성된 인덱스 반환
    const indexPath = getUserIndexFile(userId);
    const indexData = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(indexData);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // 레거시 파일도 없으면 빈 배열
    }
    console.error(`[Migration] User ${userId} 마이그레이션 실패:`, error.message);
    return [];
  }
}

// 새 구조 사용 여부 확인
async function isUsingNewStructure(userId) {
  const indexPath = getUserIndexFile(userId);
  try {
    await fs.access(indexPath);
    return true;
  } catch {
    return false;
  }
}

// 파일 잠금 관리 (동시 쓰기 방지)
const fileLocks = new Map();

async function acquireLock(filePath, timeout = 10000) {
  const startTime = Date.now();
  while (fileLocks.get(filePath)) {
    if (Date.now() - startTime > timeout) {
      throw new Error('파일 잠금 획득 시간 초과');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  fileLocks.set(filePath, true);
}

function releaseLock(filePath) {
  fileLocks.delete(filePath);
}

// base64 이미지를 파일로 저장하고 경로 반환
async function saveBase64Image(userId, base64Data, prefix = 'img') {
  if (!base64Data || !base64Data.startsWith('data:')) {
    return base64Data; // base64가 아니면 그대로 반환
  }

  try {
    const matches = base64Data.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
    if (!matches) return '';

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const imageData = matches[2];
    const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
    const imagesDir = getUserImagesDir(userId);
    const filePath = path.join(imagesDir, fileName);

    await fs.writeFile(filePath, imageData, 'base64');

    // 상대 경로 반환 (서버에서 접근 가능한 URL)
    return `/api/products/images/${userId}/${fileName}`;
  } catch (error) {
    console.error('이미지 저장 오류:', error);
    return '';
  }
}

// 상품 데이터에서 base64 이미지 추출 및 파일로 저장
async function extractAndSaveImages(userId, product) {
  // detailPageItems의 generatedImage 처리
  if (product.detailPageItems && Array.isArray(product.detailPageItems)) {
    for (const item of product.detailPageItems) {
      if (item.generatedImage && item.generatedImage.startsWith('data:')) {
        item.generatedImage = await saveBase64Image(userId, item.generatedImage, 'detail');
      }
    }
  }

  // detailHtml 내 base64 이미지를 파일로 추출 (용량 절약)
  if (product.detailHtml && product.detailHtml.includes('data:image')) {
    const base64Regex = /data:image\/([a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)/g;
    let match;
    let newDetailHtml = product.detailHtml;
    let extractedCount = 0;

    while ((match = base64Regex.exec(product.detailHtml)) !== null) {
      const fullBase64 = match[0];
      const savedPath = await saveBase64Image(userId, fullBase64, 'detail_html');
      if (savedPath) {
        newDetailHtml = newDetailHtml.replace(fullBase64, savedPath);
        extractedCount++;
      }
    }

    if (extractedCount > 0) {
      console.log(`[Products] detailHtml에서 ${extractedCount}개 base64 이미지 추출`);
      product.detailHtml = newDetailHtml;
    }
  }

  return product;
}

// 유저별 상품 데이터 로드
async function loadUserProducts(userId) {
  const filePath = getUserProductsFile(userId);
  try {
    await ensureUserDirectoryExists(userId);
    await acquireLock(filePath);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // 파일이 없으면 빈 배열 반환
    }
    throw error;
  } finally {
    releaseLock(filePath);
  }
}

// 유저별 상품 데이터 저장 (이미지 추출 포함)
async function saveUserProducts(userId, products, extractImages = false) {
  await ensureUserDirectoryExists(userId);
  const filePath = getUserProductsFile(userId);

  try {
    await acquireLock(filePath);

    // 이미지 추출 옵션이 켜져 있으면 처리
    if (extractImages) {
      for (let i = 0; i < products.length; i++) {
        products[i] = await extractAndSaveImages(userId, products[i]);
      }
    }

    // JSON 크기 체크 (경고용)
    const jsonStr = JSON.stringify(products);
    const sizeMB = jsonStr.length / 1024 / 1024;
    if (sizeMB > 10) {
      console.warn(`[Products] 경고: 상품 데이터가 ${sizeMB.toFixed(1)}MB입니다. 최적화가 필요합니다.`);
    }

    await fs.writeFile(filePath, jsonStr, 'utf-8');
  } finally {
    releaseLock(filePath);
  }
}

// 로컬 폰트를 포함한 CSS 생성
function getLocalFontCSS() {
  const regularPath = path.join(FONTS_DIR, 'NotoSansKR-Regular.ttf');
  const mediumPath = path.join(FONTS_DIR, 'NotoSansKR-Medium.ttf');
  const boldPath = path.join(FONTS_DIR, 'NotoSansKR-Bold.ttf');

  // 폰트 파일 존재 여부 확인 로그
  const fsSync = require('fs');
  const fontsExist = fsSync.existsSync(regularPath);
  console.log(`[Font] 폰트 경로: ${FONTS_DIR}`);
  console.log(`[Font] 폰트 파일 존재: ${fontsExist ? 'YES' : 'NO'}`);

  return `
    @font-face {
      font-family: 'Noto Sans KR';
      font-style: normal;
      font-weight: 400;
      src: url('file://${regularPath}') format('truetype');
    }
    @font-face {
      font-family: 'Noto Sans KR';
      font-style: normal;
      font-weight: 500;
      src: url('file://${mediumPath}') format('truetype');
    }
    @font-face {
      font-family: 'Noto Sans KR';
      font-style: normal;
      font-weight: 700;
      src: url('file://${boldPath}') format('truetype');
    }
    * { font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', 'Nanum Gothic', sans-serif !important; }
  `;
}

// HTML을 임시 파일로 저장하고 스크린샷 캡처
async function captureHtmlScreenshot(browser, html, options = {}) {
  const { width = 800, height = 1200, fullPage = true } = options;

  // 임시 HTML 파일 생성
  const tempHtmlPath = path.join(os.tmpdir(), `totalbot_html_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.html`);

  // HTML에 로컬 폰트 CSS 삽입 (더 확실한 방식)
  const fontCSS = getLocalFontCSS();

  // 1. 외부 폰트 관련 태그 모두 제거
  let modifiedHtml = html
    .replace(/<link[^>]*preconnect[^>]*>/gi, '') // preconnect 링크 제거
    .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, '') // Google Fonts 링크 제거
    .replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, '') // gstatic 링크 제거
    .replace(/https?:\/\/fonts\.googleapis\.com[^"'\s]*/g, '') // URL만 있는 경우 제거
    .replace(/https?:\/\/fonts\.gstatic\.com[^"'\s]*/g, ''); // gstatic URL 제거

  // 2. <head> 태그 바로 뒤에 로컬 폰트 스타일 삽입
  if (modifiedHtml.includes('<head>')) {
    modifiedHtml = modifiedHtml.replace(
      '<head>',
      `<head>\n<meta charset="UTF-8">\n<style type="text/css">\n${fontCSS}\n</style>`
    );
  } else if (modifiedHtml.includes('<style>')) {
    // <head>가 없으면 기존 <style> 앞에 삽입
    modifiedHtml = modifiedHtml.replace(
      '<style>',
      `<style>${fontCSS}\n`
    );
  } else {
    // HTML 문서 구조가 없으면 완전한 구조로 감싸기
    modifiedHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style type="text/css">
${fontCSS}
</style>
</head>
<body>
${modifiedHtml}
</body>
</html>`;
  }

  await fs.writeFile(tempHtmlPath, modifiedHtml, 'utf-8');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // file:// 프로토콜로 로컬 파일 열기
    await page.goto(`file://${tempHtmlPath}`, {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: 30000
    });

    // 폰트 로딩 대기
    await page.evaluate(() => document.fonts.ready);
    await new Promise(resolve => setTimeout(resolve, 300));

    const screenshot = await page.screenshot({ type: 'png', fullPage });
    await page.close();

    return screenshot;
  } finally {
    // 임시 파일 삭제
    try {
      await fs.unlink(tempHtmlPath);
    } catch (e) {
      // ignore
    }
  }
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
// 이미지 제공 API (인증 불필요)
// ============================================

// 저장된 이미지 제공
router.get('/images/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    const imagePath = path.join(DATA_DIR, String(userId), 'images', filename);

    // 보안: 경로 탈출 방지
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).send('Invalid filename');
    }

    const fsSync = require('fs');
    if (!fsSync.existsSync(imagePath)) {
      return res.status(404).send('Image not found');
    }

    res.sendFile(imagePath);
  } catch (error) {
    console.error('이미지 제공 오류:', error);
    res.status(500).send('Error serving image');
  }
});

// ============================================
// 인증 필요 API (유저별 데이터)
// ============================================

// 기존 데이터 최적화 및 마이그레이션 (레거시 → 새 구조)
router.post('/optimize', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 이미 새 구조를 사용 중인지 확인
    const usingNewStructure = await isUsingNewStructure(userId);

    if (usingNewStructure) {
      // 새 구조에서는 개별 상품 최적화
      const index = await loadProductIndex(userId);
      let extractedCount = 0;
      let clearedHtmlCount = 0;

      for (const item of index) {
        const product = await loadProduct(userId, item.id);
        if (product) {
          let updated = false;

          // detailPageItems의 base64 이미지 추출
          if (product.detailPageItems && Array.isArray(product.detailPageItems)) {
            for (const pi of product.detailPageItems) {
              if (pi.generatedImage && pi.generatedImage.startsWith('data:')) {
                pi.generatedImage = await saveBase64Image(userId, pi.generatedImage, 'detail');
                extractedCount++;
                updated = true;
              }
            }
          }

          // 큰 detailHtml 비우기
          if (product.detailHtml && product.detailHtml.length > 100000) {
            product.detailHtml = '';
            clearedHtmlCount++;
            updated = true;
          }

          if (updated) {
            await saveProduct(userId, product);
          }
        }
      }

      res.json({
        success: true,
        message: `최적화 완료: ${extractedCount}개 이미지 추출, ${clearedHtmlCount}개 HTML 정리`,
        structure: 'new'
      });
    } else {
      // 레거시 구조에서 새 구조로 마이그레이션
      const index = await migrateFromLegacy(userId);

      res.json({
        success: true,
        message: `마이그레이션 완료: ${index.length}개 상품이 새 구조로 변환됨`,
        structure: 'migrated'
      });
    }
  } catch (error) {
    console.error('데이터 최적화 오류:', error);
    res.status(500).json({ success: false, message: '최적화 실패: ' + error.message });
  }
});

// 인덱스 재생성 (가격 등 누락된 필드 업데이트)
router.post('/rebuild-index', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const itemsDir = getUserItemsDir(userId);

    // items 디렉토리의 모든 상품 파일 읽기
    const files = await fs.readdir(itemsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    console.log(`[Rebuild Index] User ${userId}: ${jsonFiles.length}개 상품 인덱스 재생성 시작`);

    // 각 상품 파일을 읽어서 인덱스 재생성
    for (const file of jsonFiles) {
      const productId = file.replace('.json', '');
      const product = await loadProduct(userId, productId);
      if (product) {
        await updateProductIndex(userId, product);
      }
    }

    console.log(`[Rebuild Index] User ${userId}: 인덱스 재생성 완료`);
    res.json({ success: true, message: `${jsonFiles.length}개 상품 인덱스가 재생성되었습니다.` });
  } catch (error) {
    console.error('인덱스 재생성 오류:', error);
    res.status(500).json({ success: false, message: '인덱스 재생성 실패: ' + error.message });
  }
});

// 상품 목록 조회 (인증 필요) - 새 구조: 인덱스에서 바로 반환
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 새 구조: 인덱스 파일에서 바로 로드 (자동 마이그레이션 포함)
    const index = await loadProductIndex(userId);

    // 인덱스에 price 정보가 없으면 추가 (호환성)
    const lightProducts = index.map(p => ({
      ...p,
      price: p.price || null,
      updatedAt: p.updatedAt,
      statusUpdatedAt: p.statusUpdatedAt
    }));

    res.json({ success: true, products: lightProducts });
  } catch (error) {
    console.error('상품 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '상품 목록 조회 실패' });
  }
});

// 여러 상품 전체 데이터 조회 (인증 필요) - 견적서 생성용
router.post('/bulk', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '상품 ID가 필요합니다.' });
    }

    // 새 구조: 개별 파일에서 로드
    const selectedProducts = [];
    for (const id of ids) {
      const product = await loadProduct(userId, id);
      if (product) {
        selectedProducts.push(product);
      }
    }

    console.log(`[Products API] 상품 bulk 조회 (User: ${userId}): ${selectedProducts.length}개`);
    res.json({ success: true, products: selectedProducts });
  } catch (error) {
    console.error('상품 bulk 조회 오류:', error);
    res.status(500).json({ success: false, message: '상품 조회 실패' });
  }
});

// 상품 상세 조회 (인증 필요)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 새 구조: 개별 파일에서 로드
    const product = await loadProduct(userId, req.params.id);

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

    // 브랜드명 가져와서 상품명 앞에 추가
    const userSettings = await loadUserSettings(userId);
    const brandName = userSettings.brandName || '';
    if (brandName && productData.title) {
      // 이미 브랜드명이 포함되어 있지 않은 경우에만 추가
      if (!productData.title.startsWith(brandName)) {
        productData.title = `${brandName} ${productData.title}`;
        console.log(`[Products API] 브랜드명 추가: ${productData.title}`);
      }
    }

    // 고유 ID 생성
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    productData.id = id;
    productData.userId = userId;
    productData.savedAt = new Date().toISOString();
    productData.status = 'collected';

    // 새 구조: 개별 파일로 저장
    await saveProduct(userId, productData);

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

    // 새 구조: 개별 파일에서 로드
    const existingProduct = await loadProduct(userId, req.params.id);

    if (!existingProduct) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    let updatedProduct = {
      ...existingProduct,
      ...req.body,
      id: req.params.id,
      userId: userId,
      updatedAt: new Date().toISOString()
    };

    // 새 구조: 개별 파일로 저장 (이미지 추출 포함)
    await saveProduct(userId, updatedProduct);

    console.log(`[Products API] 상품 수정 완료 (User: ${userId}):`, req.params.id);
    res.json({ success: true, product: updatedProduct });
  } catch (error) {
    console.error('상품 수정 오류:', error);
    res.status(500).json({ success: false, message: '상품 수정 실패' });
  }
});

// 상품 부분 수정 (인증 필요) - PATCH (PUT과 동일한 동작)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 새 구조: 개별 파일에서 로드
    const existingProduct = await loadProduct(userId, req.params.id);

    if (!existingProduct) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    let updatedProduct = {
      ...existingProduct,
      ...req.body,
      id: req.params.id,
      userId: userId,
      updatedAt: new Date().toISOString()
    };

    // 새 구조: 개별 파일로 저장 (이미지 추출 포함)
    await saveProduct(userId, updatedProduct);

    console.log(`[Products API] 상품 부분 수정 완료 (User: ${userId}):`, req.params.id);
    res.json({ success: true, product: updatedProduct });
  } catch (error) {
    console.error('상품 부분 수정 오류:', error);
    res.status(500).json({ success: false, message: '상품 수정 실패' });
  }
});

// 상품 삭제 (인증 필요)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // 새 구조: 개별 파일 삭제
    await deleteProduct(userId, req.params.id);

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

    // 새 구조: 각 상품 개별 삭제
    for (const id of ids) {
      await deleteProduct(userId, id);
    }

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
    const validStatuses = ['collected', 'edited', 'uploaded', 'manual_pending', 'approved', 'ai_completed'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 상태입니다. (collected, edited, uploaded, manual_pending, approved, ai_completed 중 하나)'
      });
    }

    // 새 구조: 개별 파일에서 로드
    const product = await loadProduct(userId, req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    product.status = status;
    product.statusUpdatedAt = new Date().toISOString();

    // 새 구조: 개별 파일로 저장
    await saveProduct(userId, product);

    console.log(`[Products API] 상품 상태 변경 (User: ${userId}):`, req.params.id, '->', status);
    res.json({ success: true, product });
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
    const validStatuses = ['collected', 'edited', 'uploaded', 'manual_pending', 'approved', 'ai_completed'];

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '상품 ID가 필요합니다.' });
    }

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 상태입니다. (collected, edited, uploaded, manual_pending, approved, ai_completed 중 하나)'
      });
    }

    // 새 구조: 각 상품 개별 업데이트
    let updatedCount = 0;
    for (const id of ids) {
      const product = await loadProduct(userId, id);
      if (product) {
        product.status = status;
        product.statusUpdatedAt = new Date().toISOString();
        await saveProduct(userId, product);
        updatedCount++;
      }
    }

    console.log(`[Products API] 상품 일괄 상태 변경 (User: ${userId}):`, updatedCount, '개 ->', status);
    res.json({ success: true, message: `${updatedCount}개 상품 상태가 변경되었습니다.`, updatedCount });
  } catch (error) {
    console.error('상품 일괄 상태 변경 오류:', error);
    console.error('상품 일괄 상태 변경 오류 스택:', error.stack);
    res.status(500).json({ success: false, message: '상품 상태 변경 실패', error: error.message });
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
  <style>
    * { font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif !important; }
    body { margin: 0; padding: 20px; background: white; }
  </style>
</head>
<body>
<div style="max-width: 800px; margin: 0 auto;">
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
  <style>
    * { font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif !important; }
    body { margin: 0; padding: 20px; background: white; }
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

    // 로컬 폰트를 사용하여 스크린샷 캡처
    const options = type === 'label'
      ? { width: 800, height: 400, fullPage: true }
      : { width: 800, height: 1200, fullPage: true };

    const screenshot = await captureHtmlScreenshot(browser, html, options);

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

    // 개별 파일에서 최신 데이터 로드 (편집 체크는 프론트엔드에서 이미 수행됨)
    for (let i = 0; i < products.length; i++) {
      let product = products[i];

      // 새 구조: 개별 파일에서 최신 데이터 로드
      if (product.id) {
        const latestProduct = await loadProduct(userId, product.id);
        if (latestProduct) {
          product = latestProduct;
          products[i] = latestProduct; // 업데이트된 데이터로 교체
        }
      }

      // detailPageItems가 없으면 경고만 출력 (프론트엔드에서 이미 체크했으므로 에러로 중단하지 않음)
      if (!product.detailPageItems || product.detailPageItems.length === 0) {
        const productName = product.title || product.titleCn || `상품 ${i + 1}`;
        console.warn(`   ⚠️ [${productName}] detailPageItems 없음 - 기본 템플릿으로 진행`);
      }
    }

    const results = [];

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (let i = 0; i < products.length; i++) {
      // products[i]는 이미 위에서 loadProduct로 최신 데이터로 교체됨
      const product = products[i];

      // 디버깅: detailHtml 상태 확인
      console.log(`   [${i + 1}] ${(product.title || product.titleCn || '').substring(0, 30)}`);
      console.log(`       - detailHtml: ${product.detailHtml ? `있음 (${product.detailHtml.length}자)` : '없음 -> 기본 템플릿 사용'}`);
      console.log(`       - detailPageItems: ${product.detailPageItems ? `있음 (${product.detailPageItems.length}개)` : '없음'}`);

      const detailHtml = product.detailHtml || generateDetailPageHtml(product);
      const labelHtml = generateLabelHtml(product);

      // 상세페이지 이미지 (로컬 폰트 사용)
      const detailScreenshot = await captureHtmlScreenshot(browser, detailHtml, {
        width: 800,
        height: 1200,
        fullPage: true
      });

      // 라벨컷 이미지 (로컬 폰트 사용)
      const labelScreenshot = await captureHtmlScreenshot(browser, labelHtml, {
        width: 800,
        height: 400,
        fullPage: true
      });

      results.push({
        productIndex: i,
        detailImage: `data:image/png;base64,${detailScreenshot.toString('base64')}`,
        labelImage: `data:image/png;base64,${labelScreenshot.toString('base64')}`
      });

      console.log(`[Generate Images] ${i + 1}/${products.length} 완료`);
    }

    await browser.close();

    // 응답 크기 로깅
    const responseData = { success: true, images: results };
    const responseSize = JSON.stringify(responseData).length;
    console.log(`[Generate Images] 응답 크기: ${(responseSize / 1024 / 1024).toFixed(2)} MB`);

    res.json(responseData);

  } catch (error) {
    console.error('[Generate Images] 오류:', error);
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ success: false, message: '이미지 생성 실패', error: error.message });
  }
});

// ============================================
// AI 자동 제품 수정 API
// ============================================

// 이미지 URL을 Base64로 변환하는 헬퍼 함수 (이미 base64인 경우도 처리)
async function imageUrlToBase64(imageUrl) {
  try {
    // 이미 base64 데이터인 경우 그대로 반환
    if (imageUrl && imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return { base64: matches[2], mimeType: matches[1] };
      }
    }

    // URL인 경우 다운로드
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = response.headers['content-type'] || 'image/png';
    return { base64, mimeType };
  } catch (error) {
    console.error('[Image] URL to Base64 변환 실패:', error.message);
    return null;
  }
}

// Gemini로 이미지 변환하는 헬퍼 함수
async function transformImageWithGemini(genAI, imageBase64, mimeType, prompt) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        responseModalities: ['Text', 'Image']
      }
    });

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const candidates = response.candidates;

    if (!candidates || candidates.length === 0) {
      throw new Error('No candidates in response');
    }

    const parts = candidates[0].content?.parts;
    if (!parts || !Array.isArray(parts)) {
      throw new Error('No parts in response');
    }

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    throw new Error('No image in response');
  } catch (error) {
    console.error('[Gemini Image] 변환 실패:', error.message);
    return null;
  }
}

// AI 자동 제품 수정 (인증 필요)
router.post('/:id/ai-auto-edit', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAgVUOctLOaPiA87MdXrjLEbXDQCmWwvj0';
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    console.log(`[AI Auto Edit] 시작 (User: ${userId}, Product: ${productId})`);

    // 1. 상품 로드
    const product = await loadProduct(userId, productId);
    if (!product) {
      return res.status(404).json({ success: false, message: '상품을 찾을 수 없습니다.' });
    }

    // 사용자 설정 로드 (브랜드명 등)
    const userSettings = await loadUserSettings(userId);
    const brandName = userSettings.brandName || '';

    const textModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // 변경 내역 추적 (프론트엔드 표시용)
    const changes = {
      title: null,
      optionsConverted: 0,
      styledImageCreated: false,
      optionImagesProcessed: 0,
      detailImagesAdded: 0
    };

    // 2. AI 상품명 생성
    const originalTitle = product.title || product.titleCn || '';
    if (originalTitle) {
      try {
        const titlePrompt = `당신은 한국 쿠팡/네이버 쇼핑몰 상품명 전문가입니다.

다음 상품명을 한국 온라인 쇼핑몰에 최적화된 상품명으로 변환해주세요:

원본 상품명: ${originalTitle}
${product.titleCn ? `중국어 원본: ${product.titleCn}` : ''}

변환 규칙:
1. 한국어로 자연스럽게 변환
2. 검색에 잘 노출되도록 핵심 키워드 포함
3. 불필요한 중복 단어 제거
4. 50자 이내로 간결하게 작성
5. **중요: 상품명 맨 앞의 첫 번째 단어는 절대 수정하지 마세요 (브랜드명)**
6. 특수문자 최소화

중요: 상품명만 반환하세요. 따옴표나 설명 없이 상품명 텍스트만 출력하세요.`;

        const titleResult = await textModel.generateContent(titlePrompt);
        let newTitle = titleResult.response.text().trim().replace(/^["']|["']$/g, '');

        // 브랜드명 확인
        if (brandName && !newTitle.startsWith(brandName)) {
          newTitle = `${brandName} ${newTitle}`;
        }

        product.title = newTitle;
        changes.title = newTitle;
        console.log(`[AI Auto Edit] 상품명 변경: ${newTitle}`);
      } catch (titleError) {
        console.error('[AI Auto Edit] 상품명 생성 실패:', titleError.message);
      }
    }

    // 3. 옵션명 AI 변환
    if (product.results && product.results.length > 0) {
      try {
        // 유니크한 옵션1 값 추출
        const uniqueOption1 = [...new Set(product.results.map(r => r.optionName1 || r.optionName1Cn || '').filter(Boolean))];

        if (uniqueOption1.length > 0) {
          const optionPrompt = `당신은 중국어를 한국어로 변환하는 이커머스 옵션명 전문가입니다.

다음 옵션 값들을 자연스러운 한국어 쇼핑몰 옵션명으로 변환해주세요:
${uniqueOption1.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

변환 규칙:
1. 색상명: 중국어 색상을 간단한 한국어로 (예: 黑色 → 블랙, 白色 → 화이트, 灰色 → 그레이)
2. 의류 사이즈: 사이즈만 남기고 불필요한 정보 제거
   - "2XL 권장 155kg-180kg" → "2XL"
   - "L码 适合120-140斤" → "L"
   - 사이즈 뒤의 권장 체중/키 정보는 모두 삭제
3. 신발 사이즈: 중국 사이즈를 한국 사이즈(mm)로 변환, 5단위
   - 35 → 225, 36 → 230, 37 → 235, 38 → 240, 39 → 245
   - 40 → 250, 41 → 255, 42 → 260, 43 → 265, 44 → 270
   - 45 → 275, 46 → 280
4. 숫자/영문만 있는 경우: 그대로 유지
5. 이미 한국어인 경우: 그대로 유지하되 불필요한 설명은 제거

중요:
- 옵션명은 최대한 간결하게 (색상명 또는 사이즈만)
- 반드시 JSON 형식으로만 응답하세요
- 응답 형식: {"mapping": {"원본값1": "변환값1", "원본값2": "변환값2", ...}}`;

          const optionResult = await textModel.generateContent(optionPrompt);
          let optionText = optionResult.response.text().trim();

          // JSON 파싱
          if (optionText.includes('```json')) {
            optionText = optionText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          } else if (optionText.includes('```')) {
            optionText = optionText.replace(/```\n?/g, '');
          }

          const optionMapping = JSON.parse(optionText).mapping || {};

          // 옵션명1 적용
          let changedCount = 0;
          product.results.forEach(result => {
            const oldName = result.optionName1 || result.optionName1Cn || '';
            if (optionMapping[oldName]) {
              result.optionName1 = optionMapping[oldName];
              changedCount++;
            }
          });

          if (changedCount > 0) {
            changes.optionsConverted = changedCount;
            console.log(`[AI Auto Edit] 옵션명1 ${changedCount}개 변환`);
          }
        }

        // 옵션2도 처리
        const uniqueOption2 = [...new Set(product.results.map(r => r.optionName2 || r.optionName2Cn || '').filter(Boolean))];

        if (uniqueOption2.length > 0) {
          const option2Prompt = `당신은 중국어를 한국어로 변환하는 이커머스 옵션명 전문가입니다.

다음 옵션 값들을 자연스러운 한국어 쇼핑몰 옵션명으로 변환해주세요:
${uniqueOption2.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

변환 규칙:
1. 색상명: 중국어 색상을 간단한 한국어로 (예: 黑色 → 블랙, 白色 → 화이트, 灰色 → 그레이)
2. 의류 사이즈: 사이즈만 남기고 불필요한 정보 제거
   - "2XL 권장 155kg-180kg" → "2XL"
   - "XL 권장 130-155 캐티" → "XL"
   - "M은 80-105파운드를 권장합니다" → "M"
   - 사이즈 뒤의 권장 체중/키/파운드/캐티 정보는 모두 삭제
3. 신발 사이즈: 중국 사이즈를 한국 사이즈(mm)로 변환, 5단위
   - 35 → 225, 36 → 230, 37 → 235, 38 → 240, 39 → 245
   - 40 → 250, 41 → 255, 42 → 260, 43 → 265, 44 → 270
4. 숫자/영문만 있는 경우: 그대로 유지
5. 이미 한국어인 경우: 그대로 유지하되 불필요한 설명은 제거

중요:
- 옵션명은 최대한 간결하게 (색상명 또는 사이즈만, 예: "XL", "블랙", "250")
- 반드시 JSON 형식으로만 응답하세요
- 응답 형식: {"mapping": {"원본값1": "변환값1", "원본값2": "변환값2", ...}}`;

          const option2Result = await textModel.generateContent(option2Prompt);
          let option2Text = option2Result.response.text().trim();

          if (option2Text.includes('```json')) {
            option2Text = option2Text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          } else if (option2Text.includes('```')) {
            option2Text = option2Text.replace(/```\n?/g, '');
          }

          const option2Mapping = JSON.parse(option2Text).mapping || {};

          // 옵션명2 적용
          let changed2Count = 0;
          product.results.forEach(result => {
            const oldName = result.optionName2 || result.optionName2Cn || '';
            if (option2Mapping[oldName]) {
              result.optionName2 = option2Mapping[oldName];
              changed2Count++;
            }
          });

          if (changed2Count > 0) {
            changes.optionsConverted = (changes.optionsConverted || 0) + changed2Count;
            console.log(`[AI Auto Edit] 옵션명2 ${changed2Count}개 변환`);
          }
        }
      } catch (optionError) {
        console.error('[AI Auto Edit] 옵션명 변환 실패:', optionError.message);
      }
    }

    // 4. 첫 번째 추가이미지 → 연출 이미지로 변환
    let styledImageUrl = null;
    if (product.images && product.images.length > 0) {
      const firstImage = product.images[0];
      console.log(`[AI Auto Edit] 연출 이미지 생성 시작: ${firstImage.substring(0, 50)}...`);

      try {
        const imageData = await imageUrlToBase64(firstImage);
        if (imageData) {
          const styledPrompt = `Create a professional e-commerce styled/lifestyle product photo.
Transform this product image into a beautiful, aesthetically pleasing staged photo suitable for online shopping.
Add an elegant, simple background with soft lighting.
Make it look like a professional product photography for a fashion/lifestyle brand.
Keep the product as the main focus.
Return the generated image.`;

          const styledImage = await transformImageWithGemini(genAI, imageData.base64, imageData.mimeType, styledPrompt);
          if (styledImage) {
            styledImageUrl = styledImage;
            // 첫 번째 추가이미지를 연출 이미지로 교체
            product.images[0] = styledImage;
            changes.styledImageCreated = true;
            console.log('[AI Auto Edit] 연출 이미지 생성 성공');
          }
        }
      } catch (styledError) {
        console.error('[AI Auto Edit] 연출 이미지 생성 실패:', styledError.message);
      }
    }

    // 5. 옵션 이미지 → 흰 배경 제품 이미지로 변환
    if (product.results && product.results.length > 0) {
      // 유니크한 옵션 이미지 추출
      const uniqueOptionImages = new Map();
      product.results.forEach(result => {
        const imgSrc = result.imageLink || (result.titleImage && result.titleImage[0]) || '';
        if (imgSrc && !uniqueOptionImages.has(imgSrc)) {
          uniqueOptionImages.set(imgSrc, null);
        }
      });

      console.log(`[AI Auto Edit] 옵션 이미지 ${uniqueOptionImages.size}개 변환 시작`);

      let processedCount = 0;
      for (const [originalUrl, _] of uniqueOptionImages) {
        try {
          const imageData = await imageUrlToBase64(originalUrl);
          if (imageData) {
            const whiteBackgroundPrompt = `Create a clean, professional e-commerce product photo with a pure white background.

IMPORTANT RULES:
1. Keep the ENTIRE product intact - do NOT extract patterns, prints, or designs from the product
2. If a person is wearing/holding the product, REMOVE the person but KEEP the complete product
3. Show the product as a flat-lay or product display style (like hanging or laid flat)
4. The product should look like it's displayed in an online shopping mall

Example: If the image shows a person wearing a sweatshirt, remove the person and show only the complete sweatshirt on white background.

Replace any existing background with pure white (#FFFFFF).
Maintain the product's original colors, shape, and all details.
Return the generated image.`;

            const transformedImage = await transformImageWithGemini(genAI, imageData.base64, imageData.mimeType, whiteBackgroundPrompt);
            if (transformedImage) {
              uniqueOptionImages.set(originalUrl, transformedImage);
              processedCount++;
              console.log(`[AI Auto Edit] 옵션 이미지 변환 (${processedCount}/${uniqueOptionImages.size})`);
            }
          }
        } catch (imgError) {
          console.error(`[AI Auto Edit] 옵션 이미지 변환 실패:`, imgError.message);
        }

        // API 속도 제한 방지를 위한 딜레이
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 변환된 이미지 적용
      if (processedCount > 0) {
        product.results.forEach(result => {
          const originalUrl = result.imageLink || (result.titleImage && result.titleImage[0]) || '';
          const transformedUrl = uniqueOptionImages.get(originalUrl);
          if (transformedUrl) {
            result.imageLink = transformedUrl;
            if (result.titleImage && result.titleImage[0]) {
              result.titleImage[0] = transformedUrl;
            }
          }
        });
        changes.optionImagesProcessed = processedCount;
      }
    }

    // 6. 상세페이지 구성
    // 상세 이미지 필드 확인 (detailImages 또는 descriptionImages)
    const detailImgArray = product.detailImages || product.descriptionImages || [];
    console.log(`[AI Auto Edit] 상세 이미지 필드 확인 - detailImages: ${product.detailImages?.length || 0}, descriptionImages: ${product.descriptionImages?.length || 0}`);

    if (!product.detailPageItems || product.detailPageItems.length === 0) {
      // 상세페이지가 비어있으면 자동으로 구성
      product.detailPageItems = [];

      // 브랜드 이미지 추가 (사용자 설정에서)
      if (userSettings.brandImageUrl) {
        product.detailPageItems.push({
          id: `brand_${Date.now()}`,
          type: 'brand-image',
          src: userSettings.brandImageUrl,
          alt: '브랜드 이미지'
        });
      }

      // 연출 이미지 추가 (있는 경우)
      const imageToAdd = styledImageUrl || (product.images && product.images.length > 0 ? product.images[0] : null);
      if (imageToAdd) {
        product.detailPageItems.push({
          id: `styled_${Date.now()}`,
          type: 'image',  // 에디터에서 인식하는 타입
          imageSrc: imageToAdd,
          label: '연출 이미지'
        });
      }

      // 상세 이미지들 추가
      if (detailImgArray.length > 0) {
        detailImgArray.forEach((img, index) => {
          product.detailPageItems.push({
            id: `detail_${Date.now()}_${index}`,
            type: 'image',  // 에디터에서 인식하는 타입
            imageSrc: img,
            label: `상세 이미지 ${index + 1}`
          });
        });
        changes.detailImagesAdded = detailImgArray.length;
        console.log(`[AI Auto Edit] 상세 이미지 ${detailImgArray.length}개 추가`);
      }

      changes.detailPageUpdated = true;
      console.log('[AI Auto Edit] 상세페이지 자동 구성 완료');
    } else {
      // 기존 상세페이지가 있으면 연출 이미지만 추가/교체
      const imageToAdd = styledImageUrl || (product.images && product.images.length > 0 ? product.images[0] : null);

      if (imageToAdd) {
        // 브랜드 이미지 다음 위치 찾기 또는 맨 앞에 추가
        let insertIndex = 0;
        for (let i = 0; i < product.detailPageItems.length; i++) {
          if (product.detailPageItems[i].type === 'brand-image') {
            insertIndex = i + 1;
            break;
          }
        }

        // 기존 연출 이미지 (label로 구분) 제거 후 새로 추가
        product.detailPageItems = product.detailPageItems.filter(item => item.label !== '연출 이미지');

        product.detailPageItems.splice(insertIndex, 0, {
          id: `styled_${Date.now()}`,
          type: 'image',  // 에디터에서 인식하는 타입
          imageSrc: imageToAdd,
          label: '연출 이미지'
        });
        changes.detailPageUpdated = true;
        console.log('[AI Auto Edit] 상세페이지에 연출 이미지 추가됨');
      }
    }

    // 7. 상태 변경 및 저장
    product.status = 'ai_completed';
    product.aiProcessedAt = new Date().toISOString();
    product.isEdited = true;
    product.updatedAt = new Date().toISOString();

    await saveProduct(userId, product);

    console.log(`[AI Auto Edit] 완료 (User: ${userId}, Product: ${productId})`);
    console.log(`[AI Auto Edit] 변경 내역:`, JSON.stringify(changes));

    res.json({
      success: true,
      message: 'AI 자동 수정이 완료되었습니다.',
      changes: changes,
      product: {
        id: product.id,
        title: product.title,
        status: product.status
      }
    });

  } catch (error) {
    console.error('[AI Auto Edit] 오류:', error);
    res.status(500).json({
      success: false,
      message: 'AI 자동 수정 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});

module.exports = router;
