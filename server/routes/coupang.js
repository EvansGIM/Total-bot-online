const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');

// 상품 데이터 로드 함수
async function loadProducts() {
  const PRODUCTS_FILE = path.join(__dirname, '../data/products/products.json');
  try {
    const data = await fs.readFile(PRODUCTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// 쿠팡 업로드용 엑셀 생성
router.post('/prepare-upload', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '상품 ID가 필요합니다.' });
    }

    // 상품 데이터 로드
    const allProducts = await loadProducts();
    const selectedProducts = allProducts.filter(p => ids.includes(p.id));

    if (selectedProducts.length === 0) {
      return res.status(404).json({ success: false, message: '선택한 상품을 찾을 수 없습니다.' });
    }

    // 쿠팡 업로드용 엑셀 생성
    const workbook = createCoupangUploadWorkbook(selectedProducts);

    // 파일 저장
    const outputDir = path.join(__dirname, '../output');
    await fs.mkdir(outputDir, { recursive: true });

    const filename = `쿠팡업로드_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now()}.xlsx`;
    const filepath = path.join(outputDir, filename);

    XLSX.writeFile(workbook, filepath);

    // 파일 전송
    res.download(filepath, filename, (err) => {
      if (err) {
        console.error('파일 다운로드 오류:', err);
      }

      // 다운로드 후 파일 삭제
      fs.unlink(filepath).catch(console.error);
    });

    console.log('[Coupang API] 업로드용 엑셀 생성 완료:', filename);
  } catch (error) {
    console.error('엑셀 생성 오류:', error);
    res.status(500).json({ success: false, message: '엑셀 생성 실패' });
  }
});

// 쿠팡 업로드용 워크북 생성
function createCoupangUploadWorkbook(products) {
  const workbook = XLSX.utils.book_new();

  // 쿠팡 업로드 형식에 맞춘 데이터 생성
  const uploadData = [];

  // 헤더 (쿠팡 양식)
  uploadData.push([
    '상품명',
    '판매가',
    '옵션1',
    '옵션2',
    '재고',
    'SKU',
    '대표이미지',
    '추가이미지1',
    '추가이미지2',
    '추가이미지3',
    '추가이미지4',
    '상세설명'
  ]);

  // 상품 데이터
  products.forEach(product => {
    const title = product.title || product.titleCn || '제목 없음';
    const mainImage = product.mainImage || '';
    const images = product.images || [];
    const detailHtml = product.detailHtml || '';
    const options = product.results || [];

    if (options.length === 0) {
      // 옵션이 없는 경우
      const price = product.salePrice || product.basePrice || 0;

      uploadData.push([
        title,
        price,
        '-',
        '-',
        999,
        '',
        mainImage,
        images[0] || '',
        images[1] || '',
        images[2] || '',
        images[3] || '',
        detailHtml
      ]);
    } else {
      // 옵션이 있는 경우
      options.forEach(opt => {
        const option1 = opt.optionName1 || opt.optionName1Cn || '-';
        const option2 = opt.optionName2 || opt.optionName2Cn || '-';
        const price = opt.price || 0;
        const stock = opt.stock || 999;
        const sku = opt.sku || '';

        uploadData.push([
          title,
          price,
          option1,
          option2,
          stock,
          sku,
          mainImage,
          images[0] || '',
          images[1] || '',
          images[2] || '',
          images[3] || '',
          detailHtml
        ]);
      });
    }
  });

  const uploadSheet = XLSX.utils.aoa_to_sheet(uploadData);

  // 열 너비 설정
  uploadSheet['!cols'] = [
    { wch: 40 },  // 상품명
    { wch: 12 },  // 판매가
    { wch: 20 },  // 옵션1
    { wch: 20 },  // 옵션2
    { wch: 10 },  // 재고
    { wch: 15 },  // SKU
    { wch: 50 },  // 대표이미지
    { wch: 50 },  // 추가이미지1
    { wch: 50 },  // 추가이미지2
    { wch: 50 },  // 추가이미지3
    { wch: 50 },  // 추가이미지4
    { wch: 100 }  // 상세설명
  ];

  XLSX.utils.book_append_sheet(workbook, uploadSheet, '쿠팡 상품 업로드');

  return workbook;
}

// 쿠팡 자동 업로드 (Selenium 필요 - 추후 구현)
router.post('/auto-upload', async (req, res) => {
  try {
    // TODO: Selenium을 사용한 자동 업로드 구현
    // 현재는 엑셀 다운로드만 지원

    res.status(501).json({
      success: false,
      message: '자동 업로드 기능은 준비 중입니다. 수동으로 엑셀 파일을 다운로드하여 쿠팡에 업로드해주세요.'
    });
  } catch (error) {
    console.error('자동 업로드 오류:', error);
    res.status(500).json({ success: false, message: '자동 업로드 실패' });
  }
});

/**
 * POST /api/coupang/collect-prices
 * 가격 수집은 Chrome 확장 프로그램에서 처리
 * 서버는 확장 프로그램을 사용하라는 안내만 반환
 */
router.post('/collect-prices', async (req, res) => {
  // 가격 수집은 Chrome 확장 프로그램에서 직접 처리
  // 서버에서 스크래핑하면 봇 감지에 걸리므로 브라우저 탭에서 직접 수행
  res.json({
    success: false,
    useExtension: true,
    message: '가격 수집은 Chrome 확장 프로그램에서 처리됩니다.'
  });
});

module.exports = router;
