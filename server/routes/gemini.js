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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAgVUOctLOaPiA87MdXrjLEbXDQCmWwvj0';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

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

    // 이미지 생성용 모델 사용 (gemini-2.0-flash-exp - 이미지 생성 지원)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        responseModalities: ['Text', 'Image']
      }
    });

    // 프롬프트 개선: 상품 판매용 이미지임을 강조
    const productInfo = productName ? `\nPRODUCT: ${productName}\n` : '';
    const fullPrompt = `IMPORTANT: This is for creating a PRODUCT SALES IMAGE for e-commerce/online shopping.${productInfo}

Using the provided image, ${prompt}

IMPORTANT INSTRUCTIONS:
1. Generate a NEW image based on the input image
2. Keep the product as the main focus
3. Make it professional and suitable for e-commerce
4. Return the generated image`;

    // Base64 이미지 데이터 처리
    let imageBase64 = imageData;
    let mimeType = 'image/png';
    if (imageData.startsWith('data:image')) {
      const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (matches) {
        mimeType = `image/${matches[1]}`;
        imageBase64 = matches[2];
      } else {
        imageBase64 = imageData.split(',')[1];
      }
    }

    // 이미지 파트 생성
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
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
        console.log('[Gemini API] 응답 구조:', JSON.stringify({
          hasCandidates: !!response.candidates,
          candidatesLength: response.candidates?.length,
          hasContent: !!response.candidates?.[0]?.content,
          partsLength: response.candidates?.[0]?.content?.parts?.length
        }));

        // 응답에서 이미지 추출
        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('응답에 후보가 없습니다.');
        }

        const content = candidates[0].content;
        if (!content || !content.parts) {
          throw new Error('응답에 콘텐츠가 없습니다.');
        }

        const parts = content.parts;
        let generatedImageData = null;
        let responseText = '';

        // parts 배열 순회하며 이미지 찾기
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.text) {
              responseText += part.text;
            }
            if (part.inlineData && part.inlineData.data) {
              generatedImageData = part.inlineData.data;
              console.log('[Gemini API] 이미지 데이터 발견');
              break;
            }
          }
        }

        if (!generatedImageData) {
          // 텍스트 응답만 있는 경우 로그
          if (responseText) {
            console.log('[Gemini API] 텍스트 응답:', responseText.substring(0, 200));
          }
          throw new Error('응답에서 이미지를 찾을 수 없습니다. 모델이 이미지 생성을 지원하지 않을 수 있습니다.');
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
        console.error(`[Gemini API] 시도 ${attempt + 1} 실패:`, errorMessage);

        // 500 에러 또는 INTERNAL 에러인 경우에만 재시도
        if ((errorMessage.includes('500') || errorMessage.includes('INTERNAL') || errorMessage.includes('parts is not iterable')) && attempt < maxRetries - 1) {
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
    } else if (errorMessage.includes('이미지를 찾을 수 없습니다')) {
      userMessage = '이 모델은 이미지 생성을 지원하지 않습니다. 배경 제거 기능을 대신 사용해주세요.';
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

/**
 * POST /api/gemini/rename-options
 * AI를 사용하여 옵션명 일괄 변환
 *
 * Body:
 * - optionValues: 변환할 옵션 값 배열
 * - mode: 'auto' (자동 중국어→한국어) 또는 'custom' (커스텀 프롬프트)
 * - customPrompt: 커스텀 모드일 때 사용자 프롬프트
 */
router.post('/rename-options', async (req, res) => {
  try {
    const { optionValues, mode, customPrompt } = req.body;

    if (!optionValues || !Array.isArray(optionValues) || optionValues.length === 0) {
      return res.status(400).json({
        success: false,
        message: '변환할 옵션 값이 필요합니다.'
      });
    }

    console.log('[Gemini API] 옵션명 변환 요청:', {
      count: optionValues.length,
      mode,
      hasCustomPrompt: !!customPrompt
    });

    // Gemini Flash 모델 사용 (빠른 텍스트 처리)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    let prompt;

    if (mode === 'custom' && customPrompt) {
      // 커스텀 프롬프트 모드
      prompt = `당신은 한국 이커머스 상품 옵션명 전문가입니다.

다음은 사용자의 요청입니다:
${customPrompt}

변환해야 할 옵션 값 목록:
${optionValues.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

중요 규칙:
1. 각 옵션 값을 사용자 요청에 맞게 변환하세요
2. 반드시 JSON 형식으로만 응답하세요
3. 응답 형식: {"mapping": {"원본값1": "변환값1", "원본값2": "변환값2", ...}}
4. 변환이 불필요한 값은 원본 그대로 유지
5. JSON 외의 다른 텍스트는 포함하지 마세요`;
    } else {
      // 자동 변환 모드 (중국어 → 한국어)
      prompt = `당신은 중국어를 한국어로 변환하는 이커머스 옵션명 전문가입니다.

다음 옵션 값들을 자연스러운 한국어 쇼핑몰 옵션명으로 변환해주세요:
${optionValues.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

변환 규칙:
1. 색상명: 중국어 색상을 간단한 한국어로 (예: 黑色 → 블랙, 白色 → 화이트, 粉色 → 핑크)
2. 사이즈: 표준 사이즈로 통일 (예: 大码 → XL, 均码 → Free)
3. 숫자/영문: 그대로 유지
4. 불필요한 기호나 중복 제거
5. 이미 한국어인 경우 그대로 유지

중요:
- 반드시 JSON 형식으로만 응답하세요
- 응답 형식: {"mapping": {"원본값1": "변환값1", "원본값2": "변환값2", ...}}
- JSON 외의 다른 텍스트는 포함하지 마세요`;
    }

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let responseText = response.text().trim();

    console.log('[Gemini API] 응답:', responseText.substring(0, 200) + '...');

    // JSON 파싱 시도
    let mapping = {};

    try {
      // JSON 블록 추출 (```json ... ``` 형식 처리)
      if (responseText.includes('```json')) {
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (responseText.includes('```')) {
        responseText = responseText.replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(responseText);
      mapping = parsed.mapping || parsed;
    } catch (parseError) {
      console.error('[Gemini API] JSON 파싱 실패, 수동 파싱 시도:', parseError.message);

      // 수동으로 매핑 추출 시도
      const lines = responseText.split('\n');
      optionValues.forEach((original, index) => {
        // 원본과 동일하게 유지 (파싱 실패 시)
        mapping[original] = original;
      });
    }

    // 변환되지 않은 값은 원본 유지
    optionValues.forEach(original => {
      if (!mapping[original]) {
        mapping[original] = original;
      }
    });

    console.log('[Gemini API] 옵션명 변환 완료:', Object.keys(mapping).length + '개');

    res.json({
      success: true,
      mapping,
      message: `${Object.keys(mapping).length}개 옵션이 변환되었습니다.`
    });

  } catch (error) {
    console.error('[Gemini API] 옵션명 변환 오류:', error);

    let userMessage = '옵션명 변환 중 오류가 발생했습니다.';
    const errorMessage = error.message || String(error);

    if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      userMessage = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
    }

    res.status(500).json({
      success: false,
      message: userMessage,
      error: errorMessage
    });
  }
});

/**
 * POST /api/gemini/generate-title
 * AI를 사용하여 상품명 생성
 *
 * Body:
 * - originalTitle: 현재 상품명 (필수)
 * - titleCn: 중국어 원본 상품명 (선택)
 */
router.post('/generate-title', async (req, res) => {
  try {
    const { originalTitle, titleCn } = req.body;

    if (!originalTitle) {
      return res.status(400).json({
        success: false,
        message: '상품명이 필요합니다.'
      });
    }

    console.log('[Gemini API] 상품명 생성 요청:', {
      originalTitle: originalTitle.substring(0, 50) + '...',
      hasTitleCn: !!titleCn
    });

    // Gemini Flash 모델 사용 (빠른 텍스트 처리)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `당신은 한국 쿠팡/네이버 쇼핑몰 상품명 전문가입니다.

다음 상품명을 한국 온라인 쇼핑몰에 최적화된 상품명으로 변환해주세요:

원본 상품명: ${originalTitle}
${titleCn ? `중국어 원본: ${titleCn}` : ''}

변환 규칙:
1. 한국어로 자연스럽게 변환
2. 검색에 잘 노출되도록 핵심 키워드 포함
3. 불필요한 중복 단어 제거
4. 50자 이내로 간결하게 작성
5. 브랜드명이 있다면 앞에 배치
6. 특수문자 최소화 (쉼표, 슬래시 정도만 사용)
7. "여성용", "남성용" 등 타겟 정보는 유지
8. 시즌(봄/여름/가을/겨울) 정보 유지
9. 중국어나 일본어 문자는 한글로 번역

예시:
- 입력: "여성용 하프 터틀넥 밑단 셔츠, 여성용 슬림 핏 및 활용도 높은 탑, 가을 겨울 한식 학생 시크 이너 티셔츠"
- 출력: "여성 하프넥 이너 티셔츠 슬림핏 가을겨울 기본 레이어드"

중요:
- 상품명만 반환하세요. 따옴표나 설명 없이 상품명 텍스트만 출력하세요.
- 줄바꿈 없이 한 줄로 출력하세요.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let generatedTitle = response.text().trim();

    // 따옴표 제거
    generatedTitle = generatedTitle.replace(/^["']|["']$/g, '');

    console.log('[Gemini API] 상품명 생성 완료:', generatedTitle);

    res.json({
      success: true,
      title: generatedTitle,
      message: '상품명이 생성되었습니다.'
    });

  } catch (error) {
    console.error('[Gemini API] 상품명 생성 오류:', error);

    let userMessage = '상품명 생성 중 오류가 발생했습니다.';
    const errorMessage = error.message || String(error);

    if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      userMessage = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
    }

    res.status(500).json({
      success: false,
      message: userMessage,
      error: errorMessage
    });
  }
});

module.exports = router;
