/**
 * Gemini API 라우트
 * - 이미지 생성 (Image-to-Image)
 * - 옵션명 자동 편집
 */

const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');

// Gemini API 클라이언트 초기화
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyAgVUOctLOaPiA87MdXrjLEbXDQCmWwvj0');

/**
 * POST /api/gemini/generate-image
 * Gemini를 사용하여 이미지 생성 (Image-to-Image)
 *
 * Body:
 * - imageData: Base64 인코딩된 이미지 데이터
 * - prompt: 이미지 생성 프롬프트
 * - productName: 제품명 (옵션)
 */
router.post('/generate-image', async (req, res) => {
  try {
    const { imageData, prompt, productName } = req.body;

    if (!imageData || !prompt) {
      return res.status(400).json({
        success: false,
        message: 'imageData와 prompt는 필수입니다.'
      });
    }

    console.log('[Gemini API] 이미지 생성 요청:', {
      hasImage: !!imageData,
      prompt: prompt.substring(0, 50) + '...',
      productName
    });

    // Gemini 2.5 Flash 모델 사용
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 프롬프트 개선: 상품 판매용 이미지임을 강조
    const productInfo = productName ? `\nPRODUCT: ${productName}\n` : '';
    const fullPrompt = `IMPORTANT: This is for creating a PRODUCT SALES IMAGE for e-commerce/online shopping.${productInfo}Using the provided image, ${prompt}`;

    // Base64 이미지 데이터 처리
    let imageBase64 = imageData;
    if (imageData.startsWith('data:image')) {
      // data:image/png;base64, 부분 제거
      imageBase64 = imageData.split(',')[1];
    }

    // 이미지 파트 생성
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: 'image/png'
      }
    };

    // 재시도 로직 (500 에러 대응)
    const maxRetries = 3;
    const retryDelay = 2000; // 2초
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[Gemini API] 시도 ${attempt + 1}/${maxRetries}...`);

        const result = await model.generateContent([
          fullPrompt,
          imagePart
        ]);

        const response = await result.response;

        // 응답에서 이미지 추출
        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('응답에 이미지가 없습니다.');
        }

        const parts = candidates[0].content.parts;
        let generatedImageData = null;

        for (const part of parts) {
          if (part.inlineData) {
            generatedImageData = part.inlineData.data;
            break;
          }
        }

        if (!generatedImageData) {
          throw new Error('응답에서 이미지를 찾을 수 없습니다.');
        }

        console.log('[Gemini API] 이미지 생성 성공');

        return res.json({
          success: true,
          imageData: `data:image/png;base64,${generatedImageData}`,
          message: '이미지 생성 성공'
        });

      } catch (error) {
        lastError = error;
        const errorMessage = error.message || String(error);

        // 500 에러 또는 INTERNAL 에러인 경우에만 재시도
        if ((errorMessage.includes('500') || errorMessage.includes('INTERNAL')) && attempt < maxRetries - 1) {
          console.log(`[Gemini API] 서버 오류 발생, ${retryDelay / 1000}초 후 재시도...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // 재시도 불가능한 에러이거나 최대 재시도 횟수 초과
        break;
      }
    }

    // 모든 재시도 실패
    console.error('[Gemini API] 이미지 생성 실패:', lastError);

    const errorMessage = lastError?.message || String(lastError);
    let userMessage = '이미지 생성 중 오류가 발생했습니다.';

    if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      userMessage = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
    } else if (errorMessage.includes('404') || errorMessage.includes('NOT_FOUND')) {
      userMessage = '모델을 찾을 수 없습니다. API 키를 확인해주세요.';
    }

    res.status(500).json({
      success: false,
      message: userMessage,
      error: errorMessage
    });

  } catch (error) {
    console.error('[Gemini API] 치명적 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

/**
 * POST /api/gemini/edit-option-names
 * 옵션명 일괄 편집
 *
 * Body:
 * - productId: 제품 ID
 * - optionType: 'option1' 또는 'option2'
 * - action: 'find-replace' 또는 'rename-sequential'
 * - findText: 찾을 텍스트 (find-replace 모드)
 * - replaceText: 바꿀 텍스트 (find-replace 모드)
 * - prefix: 접두사 (rename-sequential 모드)
 * - numberingType: '123' 또는 'ABC' (rename-sequential 모드)
 */
router.post('/edit-option-names', async (req, res) => {
  try {
    const {
      productId,
      optionType,
      action,
      findText,
      replaceText,
      prefix,
      numberingType
    } = req.body;

    if (!productId || !optionType || !action) {
      return res.status(400).json({
        success: false,
        message: 'productId, optionType, action은 필수입니다.'
      });
    }

    // 제품 데이터 로드
    const productsFilePath = path.join(__dirname, '../data/products/products.json');
    const productsData = JSON.parse(await fs.readFile(productsFilePath, 'utf-8'));

    const product = productsData.products.find(p => p.id === productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '제품을 찾을 수 없습니다.'
      });
    }

    if (!product.options || product.options.length === 0) {
      return res.status(400).json({
        success: false,
        message: '옵션이 없습니다.'
      });
    }

    let updatedCount = 0;
    const optionField = optionType === 'option1' ? 'option1' : 'option2';

    if (action === 'find-replace') {
      // 찾기 및 바꾸기
      if (findText === undefined) {
        return res.status(400).json({
          success: false,
          message: 'findText는 필수입니다.'
        });
      }

      product.options.forEach(option => {
        if (option[optionField] && option[optionField].includes(findText)) {
          option[optionField] = option[optionField].replace(new RegExp(findText, 'g'), replaceText || '');
          updatedCount++;
        }
      });

    } else if (action === 'rename-sequential') {
      // 순차적 이름 변경
      if (!prefix) {
        return res.status(400).json({
          success: false,
          message: 'prefix는 필수입니다.'
        });
      }

      // 고유한 옵션 값 추출
      const uniqueValues = [...new Set(product.options.map(opt => opt[optionField]))];
      const valueMap = {};

      // 번호 매핑 생성
      uniqueValues.forEach((value, index) => {
        let number;
        if (numberingType === 'ABC') {
          // A, B, C, ... Z, AA, AB, ...
          number = indexToLetter(index);
        } else {
          // 1, 2, 3, ...
          number = String(index + 1);
        }
        valueMap[value] = `${prefix}${number}`;
      });

      // 옵션 값 변경
      product.options.forEach(option => {
        if (option[optionField] && valueMap[option[optionField]]) {
          option[optionField] = valueMap[option[optionField]];
          updatedCount++;
        }
      });

    } else {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 action입니다.'
      });
    }

    // 제품 데이터 저장
    await fs.writeFile(productsFilePath, JSON.stringify(productsData, null, 2), 'utf-8');

    res.json({
      success: true,
      updatedCount,
      message: `${updatedCount}개 옵션이 업데이트되었습니다.`
    });

  } catch (error) {
    console.error('[옵션명 편집] 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

/**
 * 인덱스를 알파벳으로 변환 (0 = A, 25 = Z, 26 = AA, ...)
 */
function indexToLetter(index) {
  let result = '';
  while (index >= 0) {
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  }
  return result;
}

module.exports = router;
