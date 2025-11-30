/**
 * 사이즈 차트 이미지 생성 API
 * - 다양한 의류 종류 (상의, 바지, 치마, 원피스 등)
 * - 랜덤 UI 스타일 (색상, 폰트, 레이아웃)
 * - 랜덤 사이즈 값 (논리적 순서 유지)
 * - 랜덤 파일명
 */

const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// canvas 모듈 옵셔널 로드 (설치되지 않은 경우 서버 시작 실패 방지)
let createCanvas = null;
try {
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  console.log('[SizeChart] canvas 모듈 로드 성공');
} catch (e) {
  console.warn('[SizeChart] canvas 모듈을 로드할 수 없습니다. 사이즈 차트 생성 기능이 비활성화됩니다.');
}

// ===== 유틸리티 함수 =====

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomFilename() {
  const prefixes = ['SC', 'SZ', 'SIZE', 'CHART', 'TBL', 'SPEC'];
  const prefix = randomChoice(prefixes);
  const randomStr = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${randomStr}.png`;
}

// ===== 의류 종류별 설정 =====

// 의류 종류별 설정 (영어로만 - 서버 폰트 호환성)
const CLOTHING_TYPES = {
  top: {
    name: 'Top',
    headers: ['SIZE', 'CHEST', 'SHOULDER', 'SLEEVE', 'LENGTH'],
    baseValues: { a: [86, 94], b: [38, 44], c: [58, 64], d: [62, 70] },
    increments: { a: [3, 5], b: [1, 2], c: [1, 2], d: [2, 3] }
  },
  pants: {
    name: 'Pants',
    headers: ['SIZE', 'WAIST', 'HIP', 'THIGH', 'LENGTH'],
    baseValues: { a: [66, 74], b: [88, 96], c: [54, 60], d: [96, 104] },
    increments: { a: [3, 5], b: [3, 5], c: [2, 3], d: [1, 2] }
  },
  skirt: {
    name: 'Skirt',
    headers: ['SIZE', 'WAIST', 'HIP', 'LENGTH', 'HEM'],
    baseValues: { a: [64, 72], b: [86, 94], c: [40, 50], d: [38, 46] },
    increments: { a: [3, 5], b: [3, 5], c: [2, 4], d: [2, 4] }
  },
  dress: {
    name: 'Dress',
    headers: ['SIZE', 'BUST', 'WAIST', 'SHOULDER', 'LENGTH'],
    baseValues: { a: [84, 92], b: [66, 74], c: [36, 42], d: [80, 92] },
    increments: { a: [3, 5], b: [3, 5], c: [1, 2], d: [3, 5] }
  },
  outer: {
    name: 'Outer',
    headers: ['SIZE', 'CHEST', 'SHOULDER', 'SLEEVE', 'LENGTH'],
    baseValues: { a: [108, 118], b: [44, 50], c: [60, 66], d: [68, 78] },
    increments: { a: [4, 6], b: [2, 3], c: [1, 2], d: [2, 4] }
  },
  shorts: {
    name: 'Shorts',
    headers: ['SIZE', 'WAIST', 'HIP', 'THIGH', 'LENGTH'],
    baseValues: { a: [66, 74], b: [90, 98], c: [56, 64], d: [28, 38] },
    increments: { a: [3, 5], b: [3, 5], c: [2, 4], d: [2, 3] }
  }
};

// ===== 사이즈 라벨 종류 =====

const SIZE_LABELS = [
  ['S', 'M', 'L', 'XL', '2XL'],
  ['S', 'M', 'L', 'XL', 'XXL'],
  ['85', '90', '95', '100', '105'],
  ['FREE', '', '', '', ''],  // 프리사이즈 (1개만)
  ['44', '55', '66', '77', '88'],
  ['XS', 'S', 'M', 'L', 'XL'],
  ['90', '95', '100', '105', '110'],
];

// ===== UI 스타일 종류 =====

const UI_STYLES = [
  {
    name: 'modern',
    bgColor: '#ffffff',
    headerBg: '#333333',
    headerText: '#ffffff',
    rowBg1: '#ffffff',
    rowBg2: '#f9f9f9',
    textColor: '#333333',
    borderColor: '#e0e0e0',
    titleColor: '#333333',
    accentColor: '#2196F3'
  },
  {
    name: 'warm',
    bgColor: '#fffaf5',
    headerBg: '#e67e22',
    headerText: '#ffffff',
    rowBg1: '#fffaf5',
    rowBg2: '#fff5eb',
    textColor: '#5d4037',
    borderColor: '#ddd',
    titleColor: '#e67e22',
    accentColor: '#e67e22'
  },
  {
    name: 'cool',
    bgColor: '#f5f9ff',
    headerBg: '#3498db',
    headerText: '#ffffff',
    rowBg1: '#f5f9ff',
    rowBg2: '#eef5fc',
    textColor: '#2c3e50',
    borderColor: '#d0e3f0',
    titleColor: '#2980b9',
    accentColor: '#3498db'
  },
  {
    name: 'minimal',
    bgColor: '#ffffff',
    headerBg: '#f5f5f5',
    headerText: '#333333',
    rowBg1: '#ffffff',
    rowBg2: '#fafafa',
    textColor: '#555555',
    borderColor: '#eeeeee',
    titleColor: '#333333',
    accentColor: '#757575'
  },
  {
    name: 'dark',
    bgColor: '#2d2d2d',
    headerBg: '#1a1a1a',
    headerText: '#ffffff',
    rowBg1: '#2d2d2d',
    rowBg2: '#383838',
    textColor: '#e0e0e0',
    borderColor: '#444444',
    titleColor: '#ffffff',
    accentColor: '#4fc3f7'
  },
  {
    name: 'pink',
    bgColor: '#fff5f8',
    headerBg: '#e91e63',
    headerText: '#ffffff',
    rowBg1: '#fff5f8',
    rowBg2: '#ffeef3',
    textColor: '#880e4f',
    borderColor: '#f8bbd9',
    titleColor: '#c2185b',
    accentColor: '#e91e63'
  },
  {
    name: 'green',
    bgColor: '#f1f8e9',
    headerBg: '#4caf50',
    headerText: '#ffffff',
    rowBg1: '#f1f8e9',
    rowBg2: '#e8f5e9',
    textColor: '#33691e',
    borderColor: '#c5e1a5',
    titleColor: '#388e3c',
    accentColor: '#4caf50'
  },
  {
    name: 'elegant',
    bgColor: '#fafafa',
    headerBg: '#6d4c41',
    headerText: '#ffffff',
    rowBg1: '#fafafa',
    rowBg2: '#f5f5f5',
    textColor: '#4e342e',
    borderColor: '#d7ccc8',
    titleColor: '#5d4037',
    accentColor: '#8d6e63'
  }
];

// ===== 제목 스타일 종류 (영어만) =====

const TITLE_STYLES = [
  { text: 'SIZE CHART', subText: '(cm)' },
  { text: 'SIZE GUIDE', subText: '(Unit: cm)' },
  { text: 'SIZE INFO', subText: 'cm' },
  { text: 'MEASUREMENTS', subText: '(cm)' },
  { text: 'SIZE SPECIFICATION', subText: '' },
  { text: 'PRODUCT DIMENSIONS', subText: '(cm)' },
  { text: 'SIZING TABLE', subText: '' },
  { text: 'FIT GUIDE', subText: '(cm)' },
];

// ===== 주의사항 문구 종류 (영어만) =====

const DISCLAIMERS = [
  '* Measurements may vary by 1-3cm depending on how they are taken.',
  '* Please allow 1-3cm difference due to manual measurement.',
  '* All measurements are in centimeters (cm).',
  '* Size tolerance: +/- 2cm due to manual measuring.',
  '* Actual product may vary slightly from measurements shown.',
  '* Flat lay measurement, slight deviation possible.',
  '',  // 없는 경우도
];

// ===== 데이터 생성 함수 =====

function generateSizeData(clothingType, sizeLabels) {
  const config = CLOTHING_TYPES[clothingType];
  const activeSizes = sizeLabels.filter(s => s !== '');

  // 프리사이즈인 경우 1행만
  if (activeSizes.length === 1 && activeSizes[0] === 'FREE') {
    return [{
      size: 'FREE',
      a: randomInRange(config.baseValues.a[0], config.baseValues.a[1]) + randomInRange(4, 8),
      b: randomInRange(config.baseValues.b[0], config.baseValues.b[1]) + randomInRange(2, 4),
      c: randomInRange(config.baseValues.c[0], config.baseValues.c[1]) + randomInRange(2, 4),
      d: randomInRange(config.baseValues.d[0], config.baseValues.d[1]) + randomInRange(4, 8)
    }];
  }

  // 기본 값 (가장 작은 사이즈)
  const base = {
    a: randomInRange(config.baseValues.a[0], config.baseValues.a[1]),
    b: randomInRange(config.baseValues.b[0], config.baseValues.b[1]),
    c: randomInRange(config.baseValues.c[0], config.baseValues.c[1]),
    d: randomInRange(config.baseValues.d[0], config.baseValues.d[1])
  };

  // 각 사이즈별 증가량 (일관성 유지를 위해 미리 계산)
  const incA = randomInRange(config.increments.a[0], config.increments.a[1]);
  const incB = randomInRange(config.increments.b[0], config.increments.b[1]);
  const incC = randomInRange(config.increments.c[0], config.increments.c[1]);
  const incD = randomInRange(config.increments.d[0], config.increments.d[1]);

  return activeSizes.map((size, index) => ({
    size,
    a: base.a + (index * incA) + randomInRange(-1, 1), // 약간의 변동
    b: base.b + (index * incB) + randomInRange(0, 1),
    c: base.c + (index * incC) + randomInRange(0, 1),
    d: base.d + (index * incD) + randomInRange(-1, 1)
  }));
}

// ===== 이미지 생성 함수 =====

function createSizeChartImage() {
  // 랜덤 선택
  const clothingType = randomChoice(Object.keys(CLOTHING_TYPES));
  const clothingConfig = CLOTHING_TYPES[clothingType];
  const sizeLabels = randomChoice(SIZE_LABELS);
  const style = randomChoice(UI_STYLES);
  const titleStyle = randomChoice(TITLE_STYLES);
  const disclaimer = randomChoice(DISCLAIMERS);

  // 헤더 (영어만 사용 - 서버 폰트 호환성)
  const headers = clothingConfig.headers;

  // 데이터 생성
  const data = generateSizeData(clothingType, sizeLabels);

  // 캔버스 크기 (최소 600x600 이상 - 쿠팡 이미지 규격)
  const width = randomInRange(650, 750);
  const rowCount = data.length;
  const baseHeight = 100 + (rowCount + 1) * 50 + (disclaimer ? 50 : 20);
  const height = Math.max(600, baseHeight); // 최소 600px 보장

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 배경
  ctx.fillStyle = style.bgColor;
  ctx.fillRect(0, 0, width, height);

  // 테두리 (랜덤하게 있거나 없거나)
  if (Math.random() > 0.3) {
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);
  }

  // 표 설정 (더 큰 해상도에 맞게 조정)
  const startX = randomInRange(25, 40);
  const startY = randomInRange(60, 80);
  const rowHeight = randomInRange(45, 55);

  // 컬럼 너비 계산
  const tableWidth = width - (startX * 2);
  const colCount = headers.length;
  const colWidths = headers.map((_, i) => {
    if (i === 0) return Math.floor(tableWidth * 0.15); // 사이즈 컬럼
    return Math.floor(tableWidth * 0.85 / (colCount - 1));
  });

  // 제목
  ctx.fillStyle = style.titleColor;
  ctx.font = `bold ${randomInRange(18, 24)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let titleY = 35;
  if (titleStyle.subText) {
    ctx.fillText(`${titleStyle.text} ${titleStyle.subText}`, width / 2, titleY);
  } else {
    ctx.fillText(titleStyle.text, width / 2, titleY);
  }

  // 헤더 배경
  ctx.fillStyle = style.headerBg;
  const headerRadius = Math.random() > 0.5 ? 4 : 0; // 둥근 모서리 랜덤
  if (headerRadius > 0) {
    roundRect(ctx, startX, startY, colWidths.reduce((a, b) => a + b, 0), rowHeight, headerRadius);
    ctx.fill();
  } else {
    ctx.fillRect(startX, startY, colWidths.reduce((a, b) => a + b, 0), rowHeight);
  }

  // 헤더 텍스트
  ctx.fillStyle = style.headerText;
  ctx.font = `bold ${randomInRange(14, 18)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let currentX = startX;
  headers.forEach((header, i) => {
    ctx.fillText(header, currentX + colWidths[i] / 2, startY + rowHeight / 2);
    currentX += colWidths[i];
  });

  // 헤더 테두리
  ctx.strokeStyle = style.borderColor;
  ctx.lineWidth = 1;
  currentX = startX;
  headers.forEach((_, i) => {
    ctx.strokeRect(currentX, startY, colWidths[i], rowHeight);
    currentX += colWidths[i];
  });

  // 데이터 행
  data.forEach((row, rowIndex) => {
    const y = startY + rowHeight * (rowIndex + 1);

    // 행 배경 (줄무늬)
    ctx.fillStyle = rowIndex % 2 === 0 ? style.rowBg1 : style.rowBg2;
    ctx.fillRect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight);

    currentX = startX;

    // 사이즈 라벨
    ctx.fillStyle = style.accentColor;
    ctx.font = `bold ${randomInRange(14, 17)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.size, currentX + colWidths[0] / 2, y + rowHeight / 2);
    currentX += colWidths[0];

    // 측정값
    ctx.fillStyle = style.textColor;
    ctx.font = `${randomInRange(14, 17)}px sans-serif`;

    const values = [row.a, row.b, row.c, row.d];
    values.forEach((value, i) => {
      ctx.fillText(String(value), currentX + colWidths[i + 1] / 2, y + rowHeight / 2);
      currentX += colWidths[i + 1];
    });

    // 행 테두리
    ctx.strokeStyle = style.borderColor;
    currentX = startX;
    colWidths.forEach((w) => {
      ctx.strokeRect(currentX, y, w, rowHeight);
      currentX += w;
    });
  });

  // 주의사항
  if (disclaimer) {
    ctx.fillStyle = style.textColor;
    ctx.globalAlpha = 0.6;
    ctx.font = `${randomInRange(12, 14)}px sans-serif`;
    ctx.textAlign = randomChoice(['left', 'center']);
    const disclaimerX = ctx.textAlign === 'center' ? width / 2 : startX;
    ctx.fillText(disclaimer, disclaimerX, height - 20);
    ctx.globalAlpha = 1;
  }

  return canvas.toBuffer('image/png');
}

// 둥근 사각형 그리기 헬퍼
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ===== API 엔드포인트 =====

// 단일 이미지 생성
router.get('/generate', (req, res) => {
  if (!createCanvas) {
    return res.status(503).json({ success: false, message: 'canvas 모듈이 설치되지 않아 사이즈 차트를 생성할 수 없습니다.' });
  }

  try {
    const filename = generateRandomFilename();
    const imageBuffer = createSizeChartImage();

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Filename': filename
    });

    res.send(imageBuffer);
    console.log(`✅ 사이즈 차트 이미지 생성: ${filename}`);
  } catch (error) {
    console.error('❌ 사이즈 차트 이미지 생성 오류:', error);
    res.status(500).json({ success: false, message: '이미지 생성 실패' });
  }
});

// 여러 이미지 생성
router.post('/generate-batch', (req, res) => {
  if (!createCanvas) {
    return res.status(503).json({ success: false, message: 'canvas 모듈이 설치되지 않아 사이즈 차트를 생성할 수 없습니다.' });
  }

  try {
    const { count = 1 } = req.body;
    const images = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      const filename = generateRandomFilename();
      const imageBuffer = createSizeChartImage();

      images.push({
        filename,
        data: imageBuffer.toString('base64')
      });
    }

    res.json({ success: true, images });
    console.log(`✅ 사이즈 차트 이미지 ${images.length}개 생성`);
  } catch (error) {
    console.error('❌ 사이즈 차트 이미지 배치 생성 오류:', error);
    res.status(500).json({ success: false, message: '이미지 생성 실패' });
  }
});

// 파일명만 생성
router.get('/filename', (req, res) => {
  res.json({ success: true, filename: generateRandomFilename() });
});

// 여러 파일명 생성
router.post('/filenames', (req, res) => {
  const { count = 1 } = req.body;
  const filenames = [];
  for (let i = 0; i < Math.min(count, 100); i++) {
    filenames.push(generateRandomFilename());
  }
  res.json({ success: true, filenames });
});

module.exports = router;
