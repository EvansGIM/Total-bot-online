/**
 * 번역 라우트
 * - 중국어 → 한국어 번역
 * - 구글 번역 API 사용
 */

const express = require('express');
const axios = require('axios');

const router = express.Router();

// 단일 텍스트 번역 (인증 불필요 - 에디터에서 사용)
router.post('/single', async (req, res) => {
  try {
    const { text, sourceLang = 'zh-CN', targetLang = 'ko' } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: '번역할 텍스트가 없습니다.'
      });
    }

    const translated = await translateText(text, sourceLang, targetLang);

    res.json({
      success: true,
      original: text,
      translated
    });

  } catch (error) {
    console.error('번역 오류:', error);
    res.status(500).json({
      success: false,
      message: '번역 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 배치 번역 (인증 불필요 - 에디터에서 사용)
router.post('/batch', async (req, res) => {
  try {
    const { texts, sourceLang = 'zh-CN', targetLang = 'ko' } = req.body;

    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({
        success: false,
        message: '번역할 텍스트 배열이 없습니다.'
      });
    }

    const results = await translateBatch(texts, sourceLang, targetLang);

    res.json({
      success: true,
      results
    });

  } catch (error) {
    console.error('배치 번역 오류:', error);
    res.status(500).json({
      success: false,
      message: '배치 번역 중 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 번역 헬퍼 함수
async function translateText(text, sourceLang, targetLang) {
  if (!text || !text.trim()) {
    return '';
  }

  try {
    // 구글 번역 HTTP API 직접 호출 (무료, 가장 안정적)
    const url = 'https://translate.googleapis.com/translate_a/single';
    const params = {
      client: 'gtx',
      sl: sourceLang,
      tl: targetLang,
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

    // 번역 실패 시 원본 반환
    console.warn('번역 실패 - 원본 반환:', text.substring(0, 50));
    return text;

  } catch (error) {
    console.error('번역 오류:', error.message);
    return text; // 오류 시 원본 반환
  }
}

// 배치 번역 함수
async function translateBatch(texts, sourceLang, targetLang) {
  if (!texts || texts.length === 0) {
    return {};
  }

  // 중복 제거
  const uniqueTexts = [...new Set(texts.filter(t => t && t.trim()))];

  if (uniqueTexts.length === 0) {
    return {};
  }

  const results = {};

  // 개별 번역 (API 제한 방지를 위해 순차 처리)
  for (const text of uniqueTexts) {
    results[text] = await translateText(text, sourceLang, targetLang);

    // Rate limit 방지 대기
    await sleep(100);
  }

  return results;
}

// 대기 함수
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
