/**
 * Magic Eraser API
 * - Content-Aware Fill using OpenCV inpainting
 */

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

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

    // Python 스크립트 실행
    const pythonScript = path.join(__dirname, '../scripts/inpaint.py');
    const pythonCmd = '/opt/homebrew/bin/python3.11'; // OpenCV가 설치된 Python
    const python = spawn(pythonCmd, [pythonScript]);

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
    console.error('[Remove BG] 오류:', error.message);
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
  const pythonCmd = '/opt/homebrew/bin/python3.11';
  const python = spawn(pythonCmd, ['-c', 'import cv2; import numpy; print("OK")']);

  let output = '';
  python.stdout.on('data', (data) => {
    output += data.toString();
  });

  python.on('close', (code) => {
    if (code === 0 && output.includes('OK')) {
      res.json({
        success: true,
        message: 'Magic Eraser 준비 완료',
        pythonScript: pythonScript
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Python 패키지 설치 필요 (opencv-python, numpy, pillow)'
      });
    }
  });
});

module.exports = router;
