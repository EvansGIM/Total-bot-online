const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const { spawn } = require('child_process');
const os = require('os');
const multer = require('multer');

// 파일 업로드 설정 (임시 폴더에 저장)
const upload = multer({
  dest: path.join(os.tmpdir(), 'totalbot-excel'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB 제한
});

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

// 견적서 생성
router.post('/generate', async (req, res) => {
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

    // 견적서 생성
    const workbook = createQuoteWorkbook(selectedProducts);

    // 파일 저장
    const outputDir = path.join(__dirname, '../output');
    await fs.mkdir(outputDir, { recursive: true });

    const filename = `견적서_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now()}.xlsx`;
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

    console.log('[Quote API] 견적서 생성 완료:', filename);
  } catch (error) {
    console.error('견적서 생성 오류:', error);
    res.status(500).json({ success: false, message: '견적서 생성 실패' });
  }
});

// 견적서 워크북 생성
function createQuoteWorkbook(products) {
  const workbook = XLSX.utils.book_new();

  // 견적서 시트 생성
  const quoteData = [];

  // 헤더
  quoteData.push(['견적서']);
  quoteData.push([]);
  quoteData.push(['작성일:', new Date().toLocaleDateString('ko-KR')]);
  quoteData.push([]);
  quoteData.push(['번호', '상품명', '옵션1', '옵션2', '수량', '단가', '금액', '비고']);

  let totalAmount = 0;
  let rowNum = 1;

  // 상품별 데이터
  products.forEach(product => {
    const title = product.title || product.titleCn || '제목 없음';
    const options = product.results || [];

    if (options.length === 0) {
      // 옵션이 없는 경우
      const price = product.salePrice || product.basePrice || 0;
      quoteData.push([
        rowNum++,
        title,
        '-',
        '-',
        1,
        price,
        price,
        ''
      ]);
      totalAmount += price;
    } else {
      // 옵션이 있는 경우
      options.forEach(opt => {
        const option1 = opt.optionName1 || opt.optionName1Cn || '-';
        const option2 = opt.optionName2 || opt.optionName2Cn || '-';
        const price = opt.price || 0;
        const qty = 1;

        quoteData.push([
          rowNum++,
          title,
          option1,
          option2,
          qty,
          price,
          price * qty,
          opt.sku || ''
        ]);

        totalAmount += price * qty;
      });
    }
  });

  // 합계
  quoteData.push([]);
  quoteData.push(['', '', '', '', '합계', '', totalAmount, '']);

  const quoteSheet = XLSX.utils.aoa_to_sheet(quoteData);

  // 열 너비 설정
  quoteSheet['!cols'] = [
    { wch: 6 },   // 번호
    { wch: 30 },  // 상품명
    { wch: 20 },  // 옵션1
    { wch: 20 },  // 옵션2
    { wch: 8 },   // 수량
    { wch: 12 },  // 단가
    { wch: 12 },  // 금액
    { wch: 15 }   // 비고
  ];

  XLSX.utils.book_append_sheet(workbook, quoteSheet, '견적서');

  // 상세 정보 시트 생성
  const detailData = [];
  detailData.push(['상품 상세 정보']);
  detailData.push([]);
  detailData.push(['상품명', '플랫폼', '원본 URL', '대표 이미지', '옵션 수']);

  products.forEach(product => {
    detailData.push([
      product.title || product.titleCn || '제목 없음',
      getPlatformName(product.platform),
      product.url || product.sourceUrl || '',
      product.mainImage || '',
      (product.results || []).length
    ]);
  });

  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);

  detailSheet['!cols'] = [
    { wch: 30 },  // 상품명
    { wch: 15 },  // 플랫폼
    { wch: 50 },  // 원본 URL
    { wch: 50 },  // 대표 이미지
    { wch: 10 }   // 옵션 수
  ];

  XLSX.utils.book_append_sheet(workbook, detailSheet, '상세정보');

  return workbook;
}

// 플랫폼 이름 변환
function getPlatformName(platform) {
  const names = {
    '1688-product': '1688',
    'coupang-product': '쿠팡',
    'aliexpress-product': '알리익스프레스'
  };
  return names[platform] || platform || '알 수 없음';
}

// 쿠팡 견적서 자동 작성 API
router.post('/fill-coupang', async (req, res) => {
  try {
    console.log('\n📝 쿠팡 견적서 자동 작성 요청 받음');

    const { files, products, searchTags, size, weight } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '파일 정보가 필요합니다.'
      });
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: '선택한 상품 정보가 필요합니다.'
      });
    }

    console.log(`📊 파일 ${files.length}개 처리 예정`);
    console.log(`🛍️  상품 ${products.length}개 선택됨`);
    console.log('📋 데이터:', { searchTags, size, weight });

    // Python 스크립트 경로
    const pythonScript = path.join(__dirname, '../scripts/fill_quotation.py');

    // 다운로드 폴더 경로 (Chrome의 기본 Downloads 폴더)
    const downloadFolder = path.join(require('os').homedir(), 'Downloads', 'TotalBot');

    console.log(`📂 다운로드 폴더: ${downloadFolder}`);

    const results = [];

    // 각 파일 처리
    for (let i = 0; i < files.length; i++) {
      const fileInfo = files[i];
      const filePath = path.join(downloadFolder, fileInfo.filename);

      console.log(`\n처리 중 ${i + 1}/${files.length}: ${fileInfo.filename}`);
      console.log(`   파일 경로: ${filePath}`);
      console.log(`   선택 카테고리: ${fileInfo.category}`);

      // 파일 존재 확인
      try {
        await fs.access(filePath);
      } catch (err) {
        console.error(`   ❌ 파일을 찾을 수 없음: ${filePath}`);
        results.push({
          filename: fileInfo.filename,
          success: false,
          error: '파일을 찾을 수 없습니다.'
        });
        continue;
      }

      // Python 스크립트 실행
      const searchTagsStr = searchTags.join(', ');
      const sizeStr = `${size.width}x${size.height}x${size.depth}`;
      const weightStr = `${weight}g`;
      const productsJson = JSON.stringify(products);  // 상품 데이터를 JSON 문자열로

      const pythonArgs = [
        pythonScript,
        filePath,
        productsJson,
        fileInfo.category,
        searchTagsStr,
        sizeStr,
        weightStr
      ];

      console.log('   🐍 Python 실행');

      try {
        await new Promise((resolve, reject) => {
          const python = spawn('python3', pythonArgs);

          let stdout = '';
          let stderr = '';

          python.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log('      ', data.toString().trim());
          });

          python.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error('      ERR:', data.toString().trim());
          });

          python.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(`Python script failed (code ${code}): ${stderr}`));
            } else {
              resolve();
            }
          });
        });

        console.log(`   ✅ ${fileInfo.filename} 처리 완료`);
        results.push({
          filename: fileInfo.filename,
          success: true
        });

      } catch (error) {
        console.error(`   ❌ Python 스크립트 실행 오류:`, error.message);
        results.push({
          filename: fileInfo.filename,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`\n✅ 완료: ${successCount}/${files.length}개 파일 처리됨`);

    res.json({
      success: true,
      results: results,
      successCount: successCount,
      totalCount: files.length
    });

  } catch (error) {
    console.error('❌ 쿠팡 견적서 자동 작성 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Excel 파일 직접 편집 API (서식 보존)
router.post('/edit-excel', upload.single('file'), async (req, res) => {
  let tempFilePath = null;

  try {
    console.log('\n📝 Excel 파일 편집 요청 받음');

    // 파일 확인
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Excel 파일이 필요합니다.'
      });
    }

    tempFilePath = req.file.path;
    const originalName = req.file.originalname;
    console.log(`📄 파일 수신: ${originalName} (${req.file.size} bytes)`);

    // cell_updates 파싱
    let cellUpdates;
    try {
      cellUpdates = JSON.parse(req.body.cellUpdates || '[]');
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'cellUpdates JSON 파싱 오류'
      });
    }

    if (!Array.isArray(cellUpdates) || cellUpdates.length === 0) {
      return res.status(400).json({
        success: false,
        message: '수정할 셀 정보가 필요합니다.'
      });
    }

    console.log(`📊 수정할 셀: ${cellUpdates.length}개`);

    // 임시 파일에 원본 확장자 추가 (openpyxl이 xlsx 확인용)
    const xlsxPath = tempFilePath + '.xlsx';
    await fs.rename(tempFilePath, xlsxPath);
    tempFilePath = xlsxPath;

    // Python 스크립트 실행
    const pythonScript = path.join(__dirname, '../scripts/edit_excel.py');
    const cellUpdatesJson = JSON.stringify(cellUpdates);

    console.log('🐍 Python 스크립트 실행 중...');

    const result = await new Promise((resolve, reject) => {
      const python = spawn('python3', [pythonScript, xlsxPath, cellUpdatesJson]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error('   Python ERR:', data.toString().trim());
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script failed (code ${code}): ${stderr || stdout}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            resolve({ success: true, output: stdout });
          }
        }
      });
    });

    if (!result.success) {
      throw new Error(result.error || 'Python 스크립트 실행 실패');
    }

    console.log(`✅ ${result.updated}개 셀 수정 완료`);

    // 수정된 파일 전송
    const outputFilename = originalName.replace('.xlsx', '_edited.xlsx');
    res.download(xlsxPath, outputFilename, async (err) => {
      if (err) {
        console.error('파일 다운로드 오류:', err);
      }
      // 임시 파일 삭제
      try {
        await fs.unlink(xlsxPath);
      } catch (e) {
        // ignore
      }
    });

  } catch (error) {
    console.error('❌ Excel 편집 오류:', error);

    // 임시 파일 삭제
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        // ignore
      }
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
