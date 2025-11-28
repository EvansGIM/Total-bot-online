/**
 * 발주 처리 API (완전 구현)
 * Python order_processor.py → JavaScript 변환
 *
 * 기능:
 * 1. 발주서 엑셀 파일 파싱
 * 2. 발주 확정 양식 생성
 * 3. 쉽먼트 일괄 양식 생성 (FC/EDD별)
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
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * 송장번호 생성 (12자리 랜덤)
 */
function generateInvoiceNumber() {
  return String(Math.floor(Math.random() * (999999999999 - 100000000000 + 1)) + 100000000000);
}

/**
 * 워크시트에서 라벨로 셀 찾기
 * Python: _find_cell_by_label
 */
function findCellByLabel(worksheet, label, maxRow = 40, maxCol = 15) {
  const target = label.replace(/\s/g, '');
  const range = XLSX.utils.decode_range(worksheet['!ref']);

  for (let r = 0; r <= Math.min(maxRow, range.e.r); r++) {
    for (let c = 0; c <= Math.min(maxCol, range.e.c); c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellAddress];

      if (cell && typeof cell.v === 'string' && cell.v.replace(/\s/g, '').includes(target)) {
        const nextCellAddress = XLSX.utils.encode_cell({ r, c: c + 1 });
        const nextCell = worksheet[nextCellAddress];
        return nextCell ? nextCell.v : null;
      }
    }
  }
  return null;
}

/**
 * 날짜 포맷팅 (YYYYMMDD)
 */
function formatDate(val) {
  if (!val) return '';

  // Date 객체인 경우
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // 숫자 추출
  const str = String(val).replace(/[-./]/g, '');
  const digits = str.replace(/\D/g, '');
  return digits.slice(0, 8);
}

/**
 * 셀 값 가져오기
 */
function getCellValue(worksheet, row, col) {
  const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = worksheet[cellAddress];
  return cell ? cell.v : null;
}

/**
 * 발주서 파싱
 * Python: parse_orders
 */
function parseOrders(files) {
  const orderRecords = [];
  const shipRecords = [];
  const invMap = {};
  const failures = [];

  for (const file of files) {
    try {
      const workbook = XLSX.readFile(file.path);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // 필수 정보 추출
      const po = findCellByLabel(worksheet, '발주번호') || getCellValue(worksheet, 9, 2); // C10
      const fc = getCellValue(worksheet, 12, 2); // C13
      const eddRaw = findCellByLabel(worksheet, '입고예정일') || getCellValue(worksheet, 12, 5); // F13

      if (!po || !fc || !eddRaw) {
        failures.push(file.originalname);
        continue;
      }

      const edd = formatDate(eddRaw);
      if (edd.length !== 8) {
        failures.push(file.originalname);
        continue;
      }

      // 송장번호 생성 (FC + EDD 조합별로 하나)
      const key = `${edd}_${fc}`;
      if (!invMap[key]) {
        invMap[key] = generateInvoiceNumber();
      }
      const fileInv = invMap[key];

      // 회송 정보
      const returnMgr = findCellByLabel(worksheet, '회송담당자') || getCellValue(worksheet, 13, 2);
      const returnTel = findCellByLabel(worksheet, '연락처') || getCellValue(worksheet, 13, 6);
      const returnAddr = findCellByLabel(worksheet, '회송지') || getCellValue(worksheet, 14, 2);

      // 헤더 행 찾기 (상품명이 있는 행)
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      let headerRow = null;

      for (let r = 0; r <= range.e.r; r++) {
        const cellVal = getCellValue(worksheet, r, 2); // C열
        if (typeof cellVal === 'string' && cellVal.includes('상품명')) {
          headerRow = r;
          break;
        }
      }

      if (headerRow === null) {
        failures.push(file.originalname);
        continue;
      }

      // 상품 데이터 추출
      let lastIdx = null;
      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const firstCol = getCellValue(worksheet, r, 0); // A열
        const cellVal = getCellValue(worksheet, r, 2); // C열 (상품명)

        // "합계" 행을 만나면 상품 데이터 추출 종료
        if (firstCol === '합계' || (typeof cellVal === 'string' && cellVal.includes('합계'))) {
          break;
        }

        // 바코드 행인지 확인 (R로 시작하는 숫자)
        if (typeof cellVal === 'string' && /^R\d+$/.test(cellVal.trim())) {
          if (lastIdx !== null) {
            const barcode = cellVal.trim();
            orderRecords[lastIdx]['상품바코드'] = barcode;
            shipRecords[lastIdx]['상품바코드(SKU Barcode)'] = barcode;
          }
          continue;
        }

        const sku = getCellValue(worksheet, r, 1); // B열
        if (!sku) continue;

        // 숫자가 아닌 SKU는 건너뛰기 (헤더 행 등 방지)
        if (typeof sku === 'string' && !/^\d+$/.test(sku.trim())) continue;

        const productName = cellVal ? String(cellVal).trim() : '';
        const qty = getCellValue(worksheet, r, 6); // G열
        const cost = getCellValue(worksheet, r, 9); // J열
        const supply = getCellValue(worksheet, r, 10); // K열
        const vat = getCellValue(worksheet, r, 11); // L열
        const total = getCellValue(worksheet, r, 12); // M열

        // 제조일자/유통기한 정보
        const mfgFlag = getCellValue(worksheet, r, 16); // Q열 (17번째)
        const mfgDate = getCellValue(worksheet, r, 17); // R열 (18번째)
        const expFlag = getCellValue(worksheet, r + 1, 16); // 다음 행 Q열
        const expDate = getCellValue(worksheet, r + 1, 17); // 다음 행 R열

        const mfgDateVal = String(mfgFlag).trim().toUpperCase() === 'Y' ? formatDate(mfgDate) : '';
        const expDateVal = String(expFlag).trim().toUpperCase() === 'Y' ? formatDate(expDate) : '';

        orderRecords.push({
          '발주번호': String(po).trim(),
          '물류센터': String(fc).trim(),
          '입고유형': '쉽먼트',
          '발주상태': '거래처확인요청',
          '상품번호': sku,
          '상품바코드': '',
          '상품이름': productName,
          '발주수량': qty,
          '확정수량': qty,
          '유통(소비기한)': expDateVal,
          '제조일자': mfgDateVal,
          '생산년도': '',
          '납품부족사유': '',
          '회송담당자': returnMgr,
          '회송담당자 연락처': returnTel,
          '회송지주소': returnAddr,
          '매입가': cost,
          '공급가': supply,
          '부가세': vat,
          '총발주매입금': total,
          '입고예정일': edd,
          '발주등록일시': ''
        });

        shipRecords.push({
          '발주번호(PO ID)': String(po).trim(),
          '물류센터(FC)': String(fc).trim(),
          '입고유형(Transport Type)': '쉽먼트',
          '입고예정일(EDD)': edd,
          '상품번호(SKU ID)': sku,
          '상품바코드(SKU Barcode)': '',
          '상품이름(SKU Name)': productName,
          '확정수량(Confirmed Qty)': qty,
          '송장번호(Invoice Number)': fileInv,
          '납품수량(Shipped Qty)': qty
        });

        lastIdx = orderRecords.length - 1;
      }

    } catch (error) {
      console.error(`파일 처리 오류 (${file.originalname}):`, error);
      failures.push(file.originalname);
    }
  }

  return { orderRecords, shipRecords, failures };
}

/**
 * 쉽먼트 양식 저장
 * Python: save_shipments
 */
function saveShipments(shipRecords, outputDir) {
  const cols = [
    '발주번호(PO ID)', '물류센터(FC)', '입고유형(Transport Type)', '입고예정일(EDD)',
    '상품번호(SKU ID)', '상품바코드(SKU Barcode)', '상품이름(SKU Name)',
    '확정수량(Confirmed Qty)', '송장번호(Invoice Number)', '납품수량(Shipped Qty)',
    'Unnamed: 10', '주의사항'
  ];

  const filePaths = [];

  // FC + EDD별로 그룹화
  const groups = {};
  for (const record of shipRecords) {
    const key = `${record['물류센터(FC)']}_${record['입고예정일(EDD)']}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(record);
  }

  // 각 그룹별로 파일 생성
  for (const [key, records] of Object.entries(groups)) {
    const [fc, edd] = key.split('_');
    const filename = `쉽먼트 일괄 양식_${fc}_${edd}.xlsx`;
    const filePath = path.join(outputDir, filename);

    const wb = XLSX.utils.book_new();

    // 상품목록 시트
    const wsData = [cols];
    for (const record of records) {
      wsData.push([
        record['발주번호(PO ID)'],
        record['물류센터(FC)'],
        record['입고유형(Transport Type)'],
        record['입고예정일(EDD)'],
        record['상품번호(SKU ID)'],
        record['상품바코드(SKU Barcode)'],
        record['상품이름(SKU Name)'],
        record['확정수량(Confirmed Qty)'],
        record['송장번호(Invoice Number)'],
        record['납품수량(Shipped Qty)'],
        '', // Unnamed: 10
        '' // 주의사항
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 송장번호 열을 텍스트 형식으로 설정
    const invColIdx = cols.indexOf('송장번호(Invoice Number)');
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = 1; r <= range.e.r; r++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c: invColIdx });
      if (ws[cellAddress]) {
        ws[cellAddress].t = 's'; // 문자열 타입
        ws[cellAddress].z = '@'; // 텍스트 포맷
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, '상품목록');

    // 빈 시트 추가
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '송장번호입력');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '입력방법');

    XLSX.writeFile(wb, filePath);
    filePaths.push({ filename, path: filePath });
  }

  return filePaths;
}

/**
 * POST /api/order/process
 * 발주서 처리 (메인 엔드포인트)
 */
router.post('/process', upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: '파일이 업로드되지 않았습니다.'
      });
    }

    console.log(`[발주 처리] ${req.files.length}개 파일 처리 시작`);

    // 발주서 파싱
    const { orderRecords, shipRecords, failures } = parseOrders(req.files);

    // 출력 디렉토리
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. 발주 확정 양식 생성
    const orderFilename = '발주 확정 양식.xlsx';
    const orderPath = path.join(outputDir, orderFilename);

    const orderCols = [
      '발주번호', '물류센터', '입고유형', '발주상태', '상품번호', '상품바코드',
      '상품이름', '발주수량', '확정수량', '유통(소비기한)', '제조일자', '생산년도',
      '납품부족사유', '회송담당자', '회송담당자 연락처', '회송지주소',
      '매입가', '공급가', '부가세', '총발주매입금', '입고예정일', '발주등록일시'
    ];

    const orderWsData = [orderCols];
    for (const record of orderRecords) {
      orderWsData.push(orderCols.map(col => record[col]));
    }

    const orderWb = XLSX.utils.book_new();
    const orderWs = XLSX.utils.aoa_to_sheet(orderWsData);
    XLSX.utils.book_append_sheet(orderWb, orderWs, 'Sheet1');
    XLSX.writeFile(orderWb, orderPath);

    // 2. 쉽먼트 양식 생성
    const shipmentFiles = saveShipments(shipRecords, outputDir);

    // 업로드된 파일 삭제
    for (const file of req.files) {
      fs.unlinkSync(file.path);
    }

    res.json({
      success: true,
      data: {
        orderCount: orderRecords.length,
        shipmentCount: shipRecords.length,
        shipmentFiles: shipmentFiles.length,
        failures: failures
      },
      files: {
        order: orderFilename,
        shipments: shipmentFiles.map(f => f.filename)
      }
    });

    console.log(`[발주 처리] 완료: 발주 ${orderRecords.length}건, 쉽먼트 ${shipmentFiles.length}개 파일`);

  } catch (error) {
    console.error('[발주 처리] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/order/download/:filename
 * 생성된 파일 다운로드
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
    console.error('[파일 다운로드] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
