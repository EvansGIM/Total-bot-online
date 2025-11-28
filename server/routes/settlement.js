/**
 * 정산 API (완전 구현)
 * Python settlement_processor.py → JavaScript 변환
 *
 * 기능:
 * 1. 쿠팡 입고내역서 파싱
 * 2. 루트로지스 매입 데이터 파싱
 * 3. SKU 매칭 및 정산 계산
 * 4. 정산서 엑셀 생성
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// 파일 업로드 설정
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

/**
 * 숫자 정규화 (쉼표 제거, − → -, 숫자만 추출)
 */
function normalizeNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;

  const str = String(value)
    .replace(/\u2212/g, '-')  // − → -
    .replace(/,/g, '')         // 쉼표 제거
    .trim();

  const match = str.match(/[-+]?\d*\.?\d+/);
  return match ? parseFloat(match[0]) : 0;
}

/**
 * SKU 정규화
 */
function normalizeSKU(sku) {
  return String(sku).trim();
}

/**
 * 컬럼 찾기 (부분 매칭)
 */
function findColumn(columns, keywords) {
  for (const keyword of keywords) {
    const col = columns.find(c => String(c).includes(keyword));
    if (col) return col;
  }
  return null;
}

/**
 * 쿠팡 입고내역서 파싱
 */
function parseCoupangReceive(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  // SKU, 수량, 총단가 추출
  const skuQtyMap = {};
  let totalSales = 0;

  for (const row of data) {
    // SKU번호 컬럼 찾기
    const skuCol = findColumn(Object.keys(row), ['SKU번호', 'SKU', 'sku']);
    const qtyCol = findColumn(Object.keys(row), ['수량', 'qty']);
    const priceCol = findColumn(Object.keys(row), ['총단가', '총공급가액']);

    if (!skuCol || !qtyCol) continue;

    const sku = normalizeSKU(row[skuCol]);
    const qty = normalizeNumber(row[qtyCol]);
    const price = priceCol ? normalizeNumber(row[priceCol]) : 0;

    if (sku && qty) {
      skuQtyMap[sku] = (skuQtyMap[sku] || 0) + qty;
    }

    totalSales += price;
  }

  // 총 수량 계산
  const totalQty = Object.values(skuQtyMap).reduce((sum, qty) => sum + qty, 0);

  return {
    skuQtyMap,
    totalQty,
    totalSales
  };
}

/**
 * 루트로지스 폴더 파싱
 */
function parseRootLogisFolder(files) {
  const allData = [];
  const fileYuanMap = {};   // 파일별 위안가
  const fileSKUSet = {};    // 파일별 SKU Set

  for (const file of files) {
    try {
      const workbook = XLSX.readFile(file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet);

      if (data.length === 0) continue;

      // 컬럼 찾기
      const firstRow = data[0];
      const columns = Object.keys(firstRow);

      const yuanCol = findColumn(columns, ['위안']);
      const skuCol = findColumn(columns, ['상품코드', 'SKU']);
      const unitCol = findColumn(columns, ['구매1개단가', '구매단가']);
      const shipCol = findColumn(columns, ['중국배송비', '배송비']);
      const qtyCol = findColumn(columns, ['수량']);

      // 위안가 추출 (첫 번째 행)
      let yuanRate = null;
      if (yuanCol && data.length > 0) {
        const yuanValue = data[0][yuanCol];
        if (yuanValue) {
          const str = String(yuanValue).replace(/위안|,/g, '').trim();
          yuanRate = parseFloat(str);
        }
      }

      fileYuanMap[file.originalname] = yuanRate || NaN;

      // SKU Set 추출
      if (skuCol) {
        const skuSet = new Set();
        for (const row of data) {
          const sku = normalizeSKU(row[skuCol]);
          if (sku) skuSet.add(sku);
        }
        fileSKUSet[file.originalname] = skuSet;
      }

      // 데이터 저장
      for (const row of data) {
        allData.push({
          ...row,
          __srcfile__: file.originalname,
          __yuan__: yuanRate
        });
      }

    } catch (error) {
      console.error(`루트로지스 파일 처리 오류 (${file.originalname}):`, error);
    }
  }

  return { allData, fileYuanMap, fileSKUSet };
}

/**
 * 정산 계산 (zangsanbot.py 스타일)
 */
function calculateSettlement(coupangData, rootlogisData) {
  const { skuQtyMap, totalQty, totalSales } = coupangData;
  const { allData, fileYuanMap } = rootlogisData;

  const coupangSKUs = new Set(Object.keys(skuQtyMap));

  // 컬럼 찾기
  if (allData.length === 0) {
    throw new Error('루트로지스 데이터가 비어있습니다.');
  }

  const columns = Object.keys(allData[0]);
  const skuCol = findColumn(columns, ['상품코드', 'SKU']);
  const unitCol = findColumn(columns, ['구매1개단가', '구매단가']);
  const shipCol = findColumn(columns, ['중국배송비', '배송비']);

  if (!skuCol || !unitCol || !shipCol) {
    throw new Error(`필수 컬럼 없음: SKU=${skuCol}, 단가=${unitCol}, 배송비=${shipCol}`);
  }

  // SKU별 매입 계산
  let totalPurchase = 0;
  const skuPurchaseMap = {};
  const skuDetails = [];

  for (const sku of coupangSKUs) {
    const coupangQty = skuQtyMap[sku] || 0;

    // 루트로지스에서 해당 SKU 찾기
    const row = allData.find(r => normalizeSKU(r[skuCol]) === sku);

    if (row) {
      const unitPrice = normalizeNumber(row[unitCol]);
      const shipping = normalizeNumber(row[shipCol]);
      const yuanRate = row.__yuan__;
      const srcFile = row.__srcfile__;

      if (!isNaN(unitPrice) && !isNaN(shipping) && !isNaN(yuanRate) && yuanRate > 0) {
        // 매입 계산: (구매단가 × 입고수량 + 중국배송비) × 위안가
        const purchase = (unitPrice * coupangQty + shipping) * yuanRate;
        totalPurchase += purchase;
        skuPurchaseMap[sku] = purchase;

        skuDetails.push({
          SKU: sku,
          입고수량: coupangQty,
          구매단가: unitPrice,
          중국배송비: shipping,
          위안가: yuanRate,
          매입금액: purchase,
          파일: srcFile
        });

        console.log(`[정산] SKU:${sku} | 단가:${unitPrice} × 수량:${coupangQty} + 배송비:${shipping}) × 위안:${yuanRate} = ${purchase}원`);
      } else {
        skuPurchaseMap[sku] = 0;
        skuDetails.push({
          SKU: sku,
          입고수량: coupangQty,
          구매단가: unitPrice,
          중국배송비: shipping,
          위안가: yuanRate,
          매입금액: 0,
          파일: srcFile,
          오류: '데이터 누락'
        });
        console.log(`[정산] SKU:${sku} | 데이터 누락 (파일: ${srcFile})`);
      }
    } else {
      skuPurchaseMap[sku] = 0;
      skuDetails.push({
        SKU: sku,
        입고수량: coupangQty,
        구매단가: 0,
        중국배송비: 0,
        위안가: 0,
        매입금액: 0,
        파일: '-',
        오류: '상품정보 없음'
      });
      console.log(`[정산] SKU:${sku} | 루트로지스에 상품정보 없음`);
    }
  }

  // 입출고비용 계산: 총 수량 × 600
  const logisticsCost = totalQty * 600;

  // 최종 정산
  const profit = totalSales - totalPurchase - logisticsCost;
  const profitRate = totalSales > 0 ? (profit / totalSales * 100).toFixed(2) : 0;

  return {
    summary: {
      매출: totalSales,
      매입: totalPurchase,
      입출고비용: logisticsCost,
      순이익: profit,
      이익률: `${profitRate}%`,
      총수량: totalQty
    },
    skuDetails
  };
}

/**
 * POST /api/settlement/calculate
 * 정산 계산
 */
router.post('/calculate',
  upload.fields([
    { name: 'coupangFile', maxCount: 1 },
    { name: 'rootlogisFiles', maxCount: 50 }
  ]),
  async (req, res) => {
    try {
      if (!req.files || !req.files.coupangFile || !req.files.rootlogisFiles) {
        return res.status(400).json({
          success: false,
          message: '쿠팡 입고내역서와 루트로지스 파일을 모두 업로드해주세요.'
        });
      }

      console.log('[정산] 계산 시작');
      console.log('[정산] 쿠팡 파일:', req.files.coupangFile[0].originalname);
      console.log('[정산] 루트로지스 파일:', req.files.rootlogisFiles.length, '개');

      // 1. 쿠팡 입고내역서 파싱
      const coupangFile = req.files.coupangFile[0];
      const coupangWorkbook = XLSX.readFile(coupangFile.path);
      const coupangData = parseCoupangReceive(coupangWorkbook);

      console.log('[정산] 쿠팡 데이터:', Object.keys(coupangData.skuQtyMap).length, 'SKU');

      // 2. 루트로지스 파일 파싱
      const rootlogisData = parseRootLogisFolder(req.files.rootlogisFiles);

      console.log('[정산] 루트로지스 데이터:', rootlogisData.allData.length, '행');

      // 3. 정산 계산
      const result = calculateSettlement(coupangData, rootlogisData);

      // 4. 엑셀 생성
      const outputDir = path.join(__dirname, '../output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `정산서_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const filePath = path.join(outputDir, filename);

      const wb = XLSX.utils.book_new();

      // 요약 시트
      const summaryData = [
        ['항목', '금액'],
        ['매출', result.summary.매출],
        ['매입', result.summary.매입],
        ['입출고비용', result.summary.입출고비용],
        ['순이익', result.summary.순이익],
        ['이익률', result.summary.이익률],
        ['총수량', result.summary.총수량]
      ];
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, '정산 요약');

      // SKU별 상세 시트
      const detailWs = XLSX.utils.json_to_sheet(result.skuDetails);
      XLSX.utils.book_append_sheet(wb, detailWs, 'SKU 상세');

      XLSX.writeFile(wb, filePath);

      // 업로드된 파일 삭제
      fs.unlinkSync(coupangFile.path);
      for (const file of req.files.rootlogisFiles) {
        fs.unlinkSync(file.path);
      }

      res.json({
        success: true,
        data: result,
        filename
      });

      console.log('[정산] 완료:', result.summary);

    } catch (error) {
      console.error('[정산] 오류:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/**
 * GET /api/settlement/download/:filename
 * 정산서 다운로드
 */
router.get('/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../output', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    res.download(filePath, filename);
  } catch (error) {
    console.error('[정산서 다운로드] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
