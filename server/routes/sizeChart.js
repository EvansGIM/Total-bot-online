/**
 * 사이즈 차트 이미지 생성 API
 * - 랜덤한 사이즈 값으로 표 이미지 생성
 * - 랜덤 파일명 생성
 */

const express = require('express');
const { createCanvas } = require('canvas');
const crypto = require('crypto');

const router = express.Router();

// 랜덤 값 생성 함수
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 랜덤 파일명 생성
function generateRandomFilename() {
  const randomStr = crypto.randomBytes(4).toString('hex');
  return `SC_${randomStr}.png`;
}

// 사이즈 차트 데이터 생성 (의류용)
function generateClothingSizeData() {
  const sizes = ['S', 'M', 'L', 'XL', '2XL'];
  const baseValues = {
    chest: randomInRange(86, 92),      // 가슴
    shoulder: randomInRange(38, 42),   // 어깨
    sleeve: randomInRange(58, 62),     // 소매
    length: randomInRange(65, 70),     // 총장
    waist: randomInRange(68, 74)       // 허리 (바지/치마)
  };

  const data = sizes.map((size, index) => ({
    size,
    chest: baseValues.chest + (index * randomInRange(3, 5)),
    shoulder: baseValues.shoulder + (index * randomInRange(1, 2)),
    sleeve: baseValues.sleeve + (index * randomInRange(1, 2)),
    length: baseValues.length + (index * randomInRange(2, 3))
  }));

  return data;
}

// 사이즈 차트 데이터 생성 (바지용)
function generatePantsSizeData() {
  const sizes = ['S', 'M', 'L', 'XL', '2XL'];
  const baseValues = {
    waist: randomInRange(66, 72),
    hip: randomInRange(88, 94),
    thigh: randomInRange(54, 58),
    length: randomInRange(98, 102),
    hem: randomInRange(16, 18)
  };

  const data = sizes.map((size, index) => ({
    size,
    waist: baseValues.waist + (index * randomInRange(3, 5)),
    hip: baseValues.hip + (index * randomInRange(3, 5)),
    thigh: baseValues.thigh + (index * randomInRange(2, 3)),
    length: baseValues.length + (index * randomInRange(1, 2))
  }));

  return data;
}

// 사이즈 차트 이미지 생성
function createSizeChartImage(type = 'clothing') {
  const width = 600;
  const height = 280;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 배경
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 테두리
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, height);

  // 표 설정
  const startX = 20;
  const startY = 50;
  const rowHeight = 36;
  const headers = type === 'pants'
    ? ['사이즈', '허리', '엉덩이', '허벅지', '총장']
    : ['사이즈', '가슴', '어깨', '소매', '총장'];
  const colWidths = [80, 100, 100, 100, 100];

  const data = type === 'pants' ? generatePantsSizeData() : generateClothingSizeData();

  // 제목
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SIZE CHART (단위: cm)', width / 2, 30);

  // 헤더 배경
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(startX, startY, colWidths.reduce((a, b) => a + b, 0), rowHeight);

  // 헤더 텍스트
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 13px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let currentX = startX;
  headers.forEach((header, i) => {
    ctx.fillText(header, currentX + colWidths[i] / 2, startY + rowHeight / 2);
    currentX += colWidths[i];
  });

  // 헤더 테두리
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  currentX = startX;
  headers.forEach((_, i) => {
    ctx.strokeRect(currentX, startY, colWidths[i], rowHeight);
    currentX += colWidths[i];
  });

  // 데이터 행
  ctx.font = '12px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#555555';

  data.forEach((row, rowIndex) => {
    const y = startY + rowHeight * (rowIndex + 1);

    // 행 배경 (줄무늬)
    if (rowIndex % 2 === 1) {
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight);
    }

    ctx.fillStyle = '#555555';
    currentX = startX;

    // 사이즈
    ctx.font = 'bold 12px "Noto Sans KR", sans-serif';
    ctx.fillText(row.size, currentX + colWidths[0] / 2, y + rowHeight / 2);
    currentX += colWidths[0];

    // 각 측정값
    ctx.font = '12px "Noto Sans KR", sans-serif';
    const values = type === 'pants'
      ? [row.waist, row.hip, row.thigh, row.length]
      : [row.chest, row.shoulder, row.sleeve, row.length];

    values.forEach((value, i) => {
      ctx.fillText(String(value), currentX + colWidths[i + 1] / 2, y + rowHeight / 2);
      currentX += colWidths[i + 1];
    });

    // 행 테두리
    currentX = startX;
    colWidths.forEach((w) => {
      ctx.strokeRect(currentX, y, w, rowHeight);
      currentX += w;
    });
  });

  // 주의사항
  ctx.fillStyle = '#999999';
  ctx.font = '10px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('* 측정 방법에 따라 1~3cm 오차가 있을 수 있습니다.', startX, height - 15);

  return canvas.toBuffer('image/png');
}

// 사이즈 차트 이미지 생성 API
router.get('/generate', (req, res) => {
  try {
    const type = req.query.type || 'clothing'; // clothing 또는 pants
    const filename = generateRandomFilename();

    const imageBuffer = createSizeChartImage(type);

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Filename': filename
    });

    res.send(imageBuffer);

    console.log(`✅ 사이즈 차트 이미지 생성: ${filename} (${type})`);
  } catch (error) {
    console.error('❌ 사이즈 차트 이미지 생성 오류:', error);
    res.status(500).json({
      success: false,
      message: '이미지 생성 실패'
    });
  }
});

// 사이즈 차트 이미지 생성 API (POST - 여러 개)
router.post('/generate-batch', (req, res) => {
  try {
    const { count = 1, type = 'clothing' } = req.body;
    const images = [];

    for (let i = 0; i < Math.min(count, 50); i++) { // 최대 50개
      const filename = generateRandomFilename();
      const imageBuffer = createSizeChartImage(type);

      images.push({
        filename,
        data: imageBuffer.toString('base64')
      });
    }

    res.json({
      success: true,
      images
    });

    console.log(`✅ 사이즈 차트 이미지 ${images.length}개 생성 (${type})`);
  } catch (error) {
    console.error('❌ 사이즈 차트 이미지 배치 생성 오류:', error);
    res.status(500).json({
      success: false,
      message: '이미지 생성 실패'
    });
  }
});

// 파일명만 생성 API (이미지 없이)
router.get('/filename', (req, res) => {
  const filename = generateRandomFilename();
  res.json({
    success: true,
    filename
  });
});

// 여러 파일명 생성 API
router.post('/filenames', (req, res) => {
  const { count = 1 } = req.body;
  const filenames = [];

  for (let i = 0; i < Math.min(count, 100); i++) {
    filenames.push(generateRandomFilename());
  }

  res.json({
    success: true,
    filenames
  });
});

module.exports = router;
