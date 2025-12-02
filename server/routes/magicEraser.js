/**
 * Magic Eraser API
 * - Content-Aware Fill using OpenCV inpainting
 */

const express = require('express');
const router = express.Router();
const { spawn, execSync } = require('child_process');
const path = require('path');

// Python 경로 찾기 (여러 경로 시도)
function findPythonPath() {
  const possiblePaths = [
    '/opt/homebrew/bin/python3.11',  // macOS Homebrew
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
    'python'
  ];

  for (const pythonPath of possiblePaths) {
    try {
      execSync(`${pythonPath} -c "import cv2; import numpy; print('OK')"`, { stdio: 'pipe' });
      console.log('[Magic Eraser] Python 경로 발견:', pythonPath);
      return pythonPath;
    } catch (e) {
      // 이 경로는 안 됨, 다음 시도
    }
  }
  return null;
}

// 캐시된 Python 경로
let cachedPythonPath = null;

/**
 * POST /api/magic-erase
 * Body: {
 *   image: "data:image/png;base64,...",
 *   mask: "data:image/png;base64,...",
 *   method: "telea" | "ns" (optional, default: "telea")
 * }
 */
router.post('/magic-erase', async (req, res) => {
  try {
    const { image, mask, method = 'telea' } = req.body;

    if (!image || !mask) {
      return res.status(400).json({
        success: false,
        message: '이미지와 마스크가 필요합니다.'
      });
    }

    console.log('[Magic Eraser] 요청 받음, method:', method);

    // Python 경로 찾기 (캐시 사용)
    if (!cachedPythonPath) {
      cachedPythonPath = findPythonPath();
    }

    if (!cachedPythonPath) {
      console.error('[Magic Eraser] Python을 찾을 수 없습니다. opencv-python, numpy 패키지가 설치되어 있어야 합니다.');
      return res.status(500).json({
        success: false,
        message: 'Python 또는 필요한 패키지(opencv-python, numpy)가 설치되어 있지 않습니다.'
      });
    }

    // Python 스크립트 실행
    const pythonScript = path.join(__dirname, '../scripts/inpaint.py');
    console.log('[Magic Eraser] Python 경로:', cachedPythonPath);
    console.log('[Magic Eraser] 스크립트 경로:', pythonScript);
    const python = spawn(cachedPythonPath, [pythonScript]);

    let resultData = '';
    let errorData = '';

    // stdin으로 JSON 데이터 전달
    const inputData = JSON.stringify({ image, mask, method });
    python.stdin.write(inputData);
    python.stdin.end();

    python.stdout.on('data', (data) => {
      resultData += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorData += data.toString();
      console.error('[Magic Eraser Error]', data.toString());
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[Magic Eraser] Python 스크립트 실행 실패:', errorData);
        return res.status(500).json({
          success: false,
          message: 'Inpainting 실행 실패',
          error: errorData
        });
      }

      console.log('[Magic Eraser] 성공!');
      res.json({
        success: true,
        result: resultData.trim()
      });
    });

  } catch (error) {
    console.error('[Magic Eraser] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/remove-background
 * Pixian.ai API를 사용한 배경 제거 (누끼)
 * Body: { imageUrl: "https://..." } 또는 { imageBase64: "data:image/..." }
 */
router.post('/remove-background', async (req, res) => {
  try {
    const { imageUrl, imageBase64 } = req.body;

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({
        success: false,
        message: '이미지 URL 또는 Base64 데이터가 필요합니다.'
      });
    }

    console.log('[Remove BG] 배경 제거 요청 받음');

    const axios = require('axios');
    const FormData = require('form-data');

    // Pixian.ai API 설정
    const PIXIAN_API_URL = 'https://api.pixian.ai/api/v2/remove-background';
    const PIXIAN_USERNAME = 'pxshrb4abjc56ma';
    const PIXIAN_PASSWORD = '27796ibp17pm6ldg1tse0nbb6svefh6aeius61auk5732fumss2p';

    const form = new FormData();

    if (imageUrl) {
      // URL로 이미지 전달
      form.append('image.url', imageUrl);
    } else if (imageBase64) {
      // Base64를 버퍼로 변환하여 전달
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      form.append('image', imageBuffer, {
        filename: 'image.png',
        contentType: 'image/png'
      });
    }

    // Pixian API 호출
    const response = await axios.post(PIXIAN_API_URL, form, {
      headers: {
        ...form.getHeaders()
      },
      auth: {
        username: PIXIAN_USERNAME,
        password: PIXIAN_PASSWORD
      },
      responseType: 'arraybuffer',
      timeout: 60000 // 60초 타임아웃
    });

    if (response.status === 200) {
      // 결과를 Base64로 변환
      const resultBase64 = `data:image/png;base64,${Buffer.from(response.data).toString('base64')}`;
      console.log('[Remove BG] 배경 제거 성공');

      res.json({
        success: true,
        result: resultBase64
      });
    } else {
      console.error('[Remove BG] API 실패:', response.status);
      res.status(500).json({
        success: false,
        message: `Pixian API 오류: ${response.status}`
      });
    }

  } catch (error) {
    // Axios 에러인 경우 상세 정보 추출
    let errorMessage = error.message;
    let statusCode = 500;

    if (error.response) {
      // Pixian API에서 반환한 에러
      statusCode = error.response.status;
      const responseData = error.response.data;
      if (Buffer.isBuffer(responseData)) {
        errorMessage = responseData.toString('utf-8');
      } else if (typeof responseData === 'string') {
        errorMessage = responseData;
      } else if (responseData && responseData.error) {
        errorMessage = responseData.error;
      }
      console.error('[Remove BG] API 오류:', statusCode, errorMessage);
    } else {
      console.error('[Remove BG] 오류:', error.message);
    }

    res.status(statusCode).json({
      success: false,
      message: `배경 제거 실패: ${errorMessage}`
    });
  }
});

// AI Merge를 위한 Python 경로 찾기 (google-genai 패키지 필요)
let cachedAiPythonPath = null;

function findAiPythonPath() {
  const possiblePaths = [
    '/opt/homebrew/bin/python3.11',  // macOS Homebrew
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
    'python'
  ];

  for (const pythonPath of possiblePaths) {
    try {
      execSync(`${pythonPath} -c "from google import genai; from PIL import Image; print('OK')"`, { stdio: 'pipe' });
      console.log('[AI Merge] Python 경로 발견:', pythonPath);
      return pythonPath;
    } catch (e) {
      // 이 경로는 안 됨, 다음 시도
    }
  }
  return null;
}

/**
 * POST /api/ai-merge
 * Gemini AI를 사용한 이미지 합치기
 * Body: { images: ["data:image/png;base64,...", ...], productNames: ["상품1", "상품2"] }
 */
router.post('/ai-merge', async (req, res) => {
  try {
    const { images, productNames = [] } = req.body;

    if (!images || !Array.isArray(images) || images.length < 2) {
      return res.status(400).json({
        success: false,
        message: '최소 2개 이상의 이미지가 필요합니다.'
      });
    }

    console.log('[AI Merge] 요청 받음, 이미지 수:', images.length);

    // Python 경로 찾기 (캐시 사용)
    if (!cachedAiPythonPath) {
      cachedAiPythonPath = findAiPythonPath();
    }

    if (!cachedAiPythonPath) {
      console.error('[AI Merge] Python을 찾을 수 없습니다. google-genai, pillow 패키지가 설치되어 있어야 합니다.');
      return res.status(500).json({
        success: false,
        message: 'Python 또는 필요한 패키지(google-genai, pillow)가 설치되어 있지 않습니다. pip install google-genai pillow 명령으로 설치해주세요.'
      });
    }

    // Python 스크립트 실행
    const pythonScript = path.join(__dirname, '../scripts/ai_merge.py');
    console.log('[AI Merge] Python 경로:', cachedAiPythonPath);
    console.log('[AI Merge] 스크립트 경로:', pythonScript);
    const python = spawn(cachedAiPythonPath, [pythonScript]);

    let resultData = '';
    let errorData = '';

    // stdin으로 JSON 데이터 전달
    const inputData = JSON.stringify({ images, productNames });
    python.stdin.write(inputData);
    python.stdin.end();

    python.stdout.on('data', (data) => {
      resultData += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorData += data.toString();
      console.error('[AI Merge Error]', data.toString());
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[AI Merge] Python 스크립트 실행 실패:', errorData);
        return res.status(500).json({
          success: false,
          message: 'AI 이미지 합치기 실패',
          error: errorData
        });
      }

      console.log('[AI Merge] 성공!');
      res.json({
        success: true,
        result: resultData.trim()
      });
    });

  } catch (error) {
    console.error('[AI Merge] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/magic-erase/test
 * 설치 상태 확인
 */
router.get('/magic-erase/test', (req, res) => {
  const pythonScript = path.join(__dirname, '../scripts/inpaint.py');
  const pythonPath = findPythonPath();

  if (pythonPath) {
    res.json({
      success: true,
      message: 'Magic Eraser 준비 완료',
      pythonPath: pythonPath,
      pythonScript: pythonScript
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'Python 패키지 설치 필요 (opencv-python, numpy, pillow)'
    });
  }
});

module.exports = router;
