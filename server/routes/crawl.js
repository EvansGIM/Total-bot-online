/**
 * 크롤링 라우트
 * - 상품 데이터 저장
 * - 수집된 상품 조회
 */

const express = require('express');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 임시 상품 DB
const products = [];

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

    return text; // 번역 실패시 원본 반환
  } catch (error) {
    console.error('[번역 오류]', error.message);
    return text;
  }
}

// 배치 번역 헬퍼 함수
async function translateBatch(texts) {
  if (!texts || texts.length === 0) {
    return {};
  }

  // 중복 제거
  const uniqueTexts = [...new Set(texts.filter(t => t && t.trim()))];

  if (uniqueTexts.length === 0) {
    return {};
  }

  const results = {};

  for (const text of uniqueTexts) {
    results[text] = await translateText(text);
    // Rate limiting 방지
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

// 상품 데이터 저장
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({
        success: false,
        message: '상품 데이터가 없습니다.'
      });
    }

    console.log('[크롤링 저장] 번역 시작...');

    // 번역할 텍스트 수집
    const textsToTranslate = new Set();

    // 상품명 번역 대상
    if (data.titleCn && data.titleCn.trim()) {
      textsToTranslate.add(data.titleCn);
    }

    // 옵션명 번역 대상
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach(opt => {
        if (opt.optionName1Cn && opt.optionName1Cn.trim()) {
          textsToTranslate.add(opt.optionName1Cn);
        }
        if (opt.optionName2Cn && opt.optionName2Cn.trim()) {
          textsToTranslate.add(opt.optionName2Cn);
        }
      });
    }

    // 배치 번역 수행
    const translationMap = await translateBatch(Array.from(textsToTranslate));
    console.log(`[크롤링 저장] ${Object.keys(translationMap).length}개 항목 번역 완료`);

    // 번역 결과 적용
    if (data.titleCn && translationMap[data.titleCn]) {
      data.title = translationMap[data.titleCn];
    }

    if (data.results && Array.isArray(data.results)) {
      data.results.forEach(opt => {
        if (opt.optionName1Cn && translationMap[opt.optionName1Cn]) {
          opt.optionName1 = translationMap[opt.optionName1Cn];
        }
        if (opt.optionName2Cn && translationMap[opt.optionName2Cn]) {
          opt.optionName2 = translationMap[opt.optionName2Cn];
        }
      });
    }

    // 사용자 ID 추가
    const product = {
      ...data,
      userId: req.user.id,
      savedAt: new Date().toISOString(),
      id: products.length + 1
    };

    products.push(product);

    console.log('[크롤링 저장] 저장 완료');

    res.json({
      success: true,
      message: '상품이 저장되었습니다.',
      product
    });

  } catch (error) {
    console.error('상품 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '상품 저장 중 오류가 발생했습니다.'
    });
  }
});

// 수집된 상품 조회
router.get('/products', authMiddleware, (req, res) => {
  try {
    // 현재 사용자의 상품만 필터
    const userProducts = products.filter(p => p.userId === req.user.id);

    res.json({
      success: true,
      products: userProducts,
      count: userProducts.length
    });

  } catch (error) {
    console.error('상품 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '상품 조회 중 오류가 발생했습니다.'
    });
  }
});

// 상품 삭제
router.delete('/products/:id', authMiddleware, (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const index = products.findIndex(p => p.id === productId && p.userId === req.user.id);

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '상품을 찾을 수 없습니다.'
      });
    }

    products.splice(index, 1);

    res.json({
      success: true,
      message: '상품이 삭제되었습니다.'
    });

  } catch (error) {
    console.error('상품 삭제 오류:', error);
    res.status(500).json({
      success: false,
      message: '상품 삭제 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
