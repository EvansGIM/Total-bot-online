/**
 * 발주 관련 API 라우트
 * Python totalbot의 order_processor.py, balzu_order.py 참고
 */

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * 발주 확정 양식 생성 API
 * Python totalbot 구조에 맞춤 (22개 컬럼)
 */
router.post('/generate-confirmation', async (req, res) => {
  try {
    const { orders, settings } = req.body;

    if (!orders || orders.length === 0) {
      return res.status(400).json({ success: false, error: '발주 데이터가 없습니다' });
    }

    console.log(`📝 발주 확정 양식 생성 시작: ${orders.length}건`);

    // 첫 번째 주문 데이터 로깅 (디버깅용)
    if (orders.length > 0) {
      console.log('📋 첫 번째 주문 데이터 샘플:', JSON.stringify(orders[0], null, 2));
    }

    // Excel 워크북 생성
    const wb = XLSX.utils.book_new();

    // Python totalbot 발주 확정 양식 구조 (22개 컬럼)
    const headers = [
      '발주번호',
      '물류센터',
      '입고유형',
      '발주상태',
      '상품번호',
      '상품바코드',
      '상품이름',
      '발주수량',
      '확정수량',
      '유통(소비기한)',
      '제조일자',
      '생산년도',
      '납품부족사유',
      '회송담당자',
      '회송담당자 연락처',
      '회송지주소',
      '매입가',
      '공급가',
      '부가세',
      '총발주매입금',
      '입고예정일',
      '발주등록일시'
    ];

    const wsData = [headers];

    // 이상 데이터 필터링
    const invalidKeywords = ['메시지 카테고리', '카테고리 코드', '유형', '필수', '선택', 'SKU ID', '운송장', '차량번호'];
    const validOrders = orders.filter(order => {
      const productCode = order.productCode || order.productId || '';
      const productName = order.productName || '';
      const isValid = !invalidKeywords.some(keyword =>
        productCode.includes(keyword) || productName.includes(keyword)
      );
      if (!isValid) {
        console.log(`⚠️ 이상 데이터 필터링: 상품코드="${productCode}", 상품명="${productName}"`);
      }
      return isValid;
    });

    console.log(`📝 필터링 후 발주 건수: ${validOrders.length}건 (원본: ${orders.length}건)`);

    validOrders.forEach(order => {
      const quantity = parseInt(order.quantity) || 0;
      const confirmedQty = parseInt(order.confirmedQuantity) || quantity;
      const purchasePrice = parseFloat(order.purchasePrice) || 0;
      const supplyPrice = parseFloat(order.supplyPrice) || 0;
      const vat = supplyPrice * 0.1;
      const totalAmount = purchasePrice * quantity;

      // 입고예정일 포맷 (YYYY-MM-DD)
      let expectedDate = order.expectedDate || '';
      if (expectedDate.length === 8 && /^\d+$/.test(expectedDate)) {
        // YYYYMMDD -> YYYY-MM-DD
        expectedDate = `${expectedDate.substring(0, 4)}-${expectedDate.substring(4, 6)}-${expectedDate.substring(6, 8)}`;
      }

      wsData.push([
        order.poNumber || order.orderNumber || '',           // 발주번호
        order.center || order.fulfillmentCenter || '',       // 물류센터
        '쉽먼트',                                             // 입고유형 (항상 쉽먼트)
        '거래처확인요청',                                      // 발주상태
        order.productCode || order.productId || '',          // 상품번호
        order.barcode || order.sku || '',                    // 상품바코드
        order.productName || '',                             // 상품이름
        quantity,                                            // 발주수량
        confirmedQty,                                        // 확정수량
        order.expirationDate || '',                          // 유통(소비기한)
        order.manufacturingDate || '',                       // 제조일자
        '',                                                  // 생산년도
        order.shortageReason || '',                          // 납품부족사유
        order.returnManager || '',                           // 회송담당자
        order.returnManagerPhone || '',                      // 회송담당자 연락처
        order.returnAddress || '',                           // 회송지주소
        purchasePrice,                                       // 매입가
        supplyPrice,                                         // 공급가
        vat,                                                 // 부가세
        totalAmount,                                         // 총발주매입금
        expectedDate,                                        // 입고예정일
        ''                                                   // 발주등록일시
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 열 너비 설정
    ws['!cols'] = [
      { wch: 15 },  // 발주번호
      { wch: 12 },  // 물류센터
      { wch: 10 },  // 입고유형
      { wch: 15 },  // 발주상태
      { wch: 12 },  // 상품번호
      { wch: 15 },  // 상품바코드
      { wch: 40 },  // 상품이름
      { wch: 10 },  // 발주수량
      { wch: 10 },  // 확정수량
      { wch: 12 },  // 유통기한
      { wch: 12 },  // 제조일자
      { wch: 10 },  // 생산년도
      { wch: 25 },  // 납품부족사유
      { wch: 12 },  // 회송담당자
      { wch: 15 },  // 회송담당자 연락처
      { wch: 30 },  // 회송지주소
      { wch: 12 },  // 매입가
      { wch: 12 },  // 공급가
      { wch: 10 },  // 부가세
      { wch: 15 },  // 총발주매입금
      { wch: 12 },  // 입고예정일
      { wch: 18 }   // 발주등록일시
    ];

    // Python uses pandas.to_excel() which defaults to 'Sheet1' sheet name
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    // 파일 저장
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `발주 확정 양식_${timestamp}.xlsx`;
    const outputDir = path.join(__dirname, '../output');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, filename);
    XLSX.writeFile(wb, filePath);

    // Base64로 인코딩
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');

    console.log(`✅ 발주 확정 양식 생성 완료: ${filename}`);

    res.json({
      success: true,
      filename: filename,
      filePath: filePath,
      fileData: base64Data,
      orderCount: orders.length
    });

  } catch (error) {
    console.error('❌ 발주 확정 양식 생성 오류:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 쉽먼트 일괄 양식 생성 API
 * Python totalbot 구조에 맞춤 (12개 컬럼 + 3개 시트)
 */
router.post('/generate-shipments', async (req, res) => {
  try {
    const { ordersByCenter, settings } = req.body;

    if (!ordersByCenter || Object.keys(ordersByCenter).length === 0) {
      return res.status(400).json({ success: false, error: '센터별 발주 데이터가 없습니다' });
    }

    console.log(`📝 쉽먼트 양식 생성 시작: ${Object.keys(ordersByCenter).length}개 센터`);

    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const outputDir = path.join(__dirname, '../output');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const results = [];

    // Python totalbot 쉽먼트 양식 구조 (12개 컬럼)
    const headers = [
      '발주번호(PO ID)',
      '물류센터(FC)',
      '입고유형(Transport Type)',
      '입고예정일(EDD)',
      '상품번호(SKU ID)',
      '상품바코드(SKU Barcode)',
      '상품이름(SKU Name)',
      '확정수량(Confirmed Qty)',
      '송장번호(Invoice Number)',
      '납품수량(Shipped Qty)',
      '',  // Unnamed: 10
      '주의사항'
    ];

    // 센터별로 쉽먼트 파일 생성
    for (const [center, orders] of Object.entries(ordersByCenter)) {
      // 입고예정일 추출 (첫 번째 주문의 expectedDate)
      let expectedDate = orders[0]?.expectedDate || '';
      if (expectedDate.includes('-')) {
        expectedDate = expectedDate.replace(/-/g, '');
      }

      // 12자리 랜덤 송장번호 생성 (센터+입고예정일 그룹당 동일)
      const invoiceNumber = generateInvoiceNumber();

      // Excel 워크북 생성
      const wb = XLSX.utils.book_new();

      // 시트 1: 상품목록
      const wsData = [headers];

      orders.forEach(order => {
        const confirmedQty = parseInt(order.confirmedQuantity) || parseInt(order.quantity) || 0;

        // 확정수량이 0이면 제외
        if (confirmedQty === 0) return;

        // 입고예정일 포맷 (YYYYMMDD)
        let orderEdd = order.expectedDate || expectedDate || '';
        if (orderEdd.includes('-')) {
          orderEdd = orderEdd.replace(/-/g, '');
        }

        wsData.push([
          order.poNumber || order.orderNumber || '',           // 발주번호(PO ID)
          center,                                              // 물류센터(FC)
          '쉽먼트',                                             // 입고유형(Transport Type)
          orderEdd,                                            // 입고예정일(EDD)
          order.productCode || order.productId || '',          // 상품번호(SKU ID)
          order.barcode || order.sku || '',                    // 상품바코드(SKU Barcode)
          order.productName || '',                             // 상품이름(SKU Name)
          confirmedQty,                                        // 확정수량(Confirmed Qty)
          invoiceNumber,                                       // 송장번호(Invoice Number)
          confirmedQty,                                        // 납품수량(Shipped Qty)
          '',                                                  // Unnamed: 10
          ''                                                   // 주의사항
        ]);
      });

      // 데이터가 헤더만 있으면 스킵
      if (wsData.length <= 1) {
        console.log(`⚠️ ${center} 센터: 확정 수량이 있는 주문이 없어 스킵`);
        continue;
      }

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // 열 너비 설정
      ws['!cols'] = [
        { wch: 15 },  // 발주번호
        { wch: 12 },  // 물류센터
        { wch: 18 },  // 입고유형
        { wch: 12 },  // 입고예정일
        { wch: 15 },  // 상품번호
        { wch: 18 },  // 상품바코드
        { wch: 40 },  // 상품이름
        { wch: 15 },  // 확정수량
        { wch: 18 },  // 송장번호
        { wch: 15 },  // 납품수량
        { wch: 10 },  // Unnamed
        { wch: 15 }   // 주의사항
      ];

      // 송장번호 열을 텍스트 형식으로 설정 (열 I, 인덱스 8)
      // SheetJS에서는 셀 포맷을 개별적으로 설정해야 함
      for (let row = 2; row <= wsData.length; row++) {
        const cellAddress = `I${row}`;
        if (ws[cellAddress]) {
          ws[cellAddress].t = 's';  // 문자열 타입으로 강제
          ws[cellAddress].z = '@';  // 텍스트 형식
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, '상품목록');

      // 시트 2: 송장번호입력 (빈 시트)
      const ws2 = XLSX.utils.aoa_to_sheet([['']]);
      XLSX.utils.book_append_sheet(wb, ws2, '송장번호입력');

      // 시트 3: 입력방법 (빈 시트)
      const ws3 = XLSX.utils.aoa_to_sheet([['']]);
      XLSX.utils.book_append_sheet(wb, ws3, '입력방법');

      // 파일 저장
      const filename = `쉽먼트 일괄 양식_${center}_${timestamp}.xlsx`;
      const filePath = path.join(outputDir, filename);
      XLSX.writeFile(wb, filePath);

      // Base64로 인코딩
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      results.push({
        center: center,
        filename: filename,
        filePath: filePath,
        fileData: base64Data,
        orderCount: wsData.length - 1,  // 헤더 제외
        expectedDate: expectedDate,
        invoiceNumber: invoiceNumber
      });

      console.log(`✅ 쉽먼트 양식 생성 완료: ${filename} (${wsData.length - 1}건)`);
    }

    res.json({
      success: true,
      files: results.map(r => r.filename),
      shipments: results
    });

  } catch (error) {
    console.error('❌ 쉽먼트 양식 생성 오류:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 12자리 랜덤 송장번호 생성
 */
function generateInvoiceNumber() {
  let invoice = '';
  for (let i = 0; i < 12; i++) {
    invoice += Math.floor(Math.random() * 10).toString();
  }
  return invoice;
}

/**
 * 재고 데이터 조회 API
 */
router.get('/stock', async (req, res) => {
  try {
    // TODO: 실제 재고 데이터 연동
    res.json({});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 쉽먼트 PDF 저장 API
 * 라벨/내역서 PDF를 서버에 저장
 */
router.post('/save-pdf', async (req, res) => {
  try {
    const { fileData, fileName, type, poNumber, parcelShipmentSeq } = req.body;

    if (!fileData || !fileName) {
      return res.status(400).json({ success: false, error: 'fileData와 fileName이 필요합니다' });
    }

    // 타입별 디렉토리 설정
    const subDir = type === 'label' ? 'labels' : type === 'manifest' ? 'manifests' : 'shipments';
    const outputDir = path.join(__dirname, '../output', subDir);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Base64 디코딩 후 파일 저장
    const buffer = Buffer.from(fileData, 'base64');
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, buffer);

    console.log(`✅ PDF 저장 완료: ${filePath}`);

    res.json({
      success: true,
      filePath: filePath,
      fileName: fileName,
      type: type,
      size: buffer.length
    });

  } catch (error) {
    console.error('❌ PDF 저장 오류:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 쉽먼트 문서 일괄 저장 API
 * 여러 PDF를 한 번에 저장
 */
router.post('/save-pdfs', async (req, res) => {
  try {
    const { documents } = req.body;

    if (!documents || documents.length === 0) {
      return res.status(400).json({ success: false, error: '저장할 문서가 없습니다' });
    }

    const results = [];
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');

    for (const doc of documents) {
      try {
        const { label, manifest, poNumber, parcelShipmentSeq } = doc;

        // 라벨 저장
        if (label && label.data) {
          const labelDir = path.join(__dirname, '../output/labels');
          if (!fs.existsSync(labelDir)) {
            fs.mkdirSync(labelDir, { recursive: true });
          }
          const labelFileName = `라벨_${poNumber || parcelShipmentSeq}_${timestamp}.pdf`;
          const labelPath = path.join(labelDir, labelFileName);
          const labelBuffer = Buffer.from(label.data, 'base64');
          fs.writeFileSync(labelPath, labelBuffer);
          results.push({ type: 'label', fileName: labelFileName, success: true });
          console.log(`✅ 라벨 저장: ${labelFileName}`);
        }

        // 내역서 저장
        if (manifest && manifest.data) {
          const manifestDir = path.join(__dirname, '../output/manifests');
          if (!fs.existsSync(manifestDir)) {
            fs.mkdirSync(manifestDir, { recursive: true });
          }
          const manifestFileName = `내역서_${poNumber || parcelShipmentSeq}_${timestamp}.pdf`;
          const manifestPath = path.join(manifestDir, manifestFileName);
          const manifestBuffer = Buffer.from(manifest.data, 'base64');
          fs.writeFileSync(manifestPath, manifestBuffer);
          results.push({ type: 'manifest', fileName: manifestFileName, success: true });
          console.log(`✅ 내역서 저장: ${manifestFileName}`);
        }

      } catch (docError) {
        console.error('문서 저장 오류:', docError);
        results.push({ poNumber: doc.poNumber, error: docError.message, success: false });
      }
    }

    res.json({
      success: true,
      savedCount: results.filter(r => r.success).length,
      results: results
    });

  } catch (error) {
    console.error('❌ PDF 일괄 저장 오류:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
