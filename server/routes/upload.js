/**
 * 이미지 업로드 API
 * - base64 이미지를 서버에 저장하고 URL 반환
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 업로드 디렉토리 확인/생성
const uploadsDir = path.join(__dirname, '../uploads/images');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * POST /api/upload/image
 * Body: { image: "data:image/png;base64,..." }
 * Returns: { success: true, url: "/uploads/images/xxx.png" }
 */
router.post('/image', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        message: '이미지 데이터가 필요합니다.'
      });
    }

    // base64 데이터 파싱
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 이미지 형식입니다.'
      });
    }

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 고유 파일명 생성
    const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const filepath = path.join(uploadsDir, filename);

    // 파일 저장
    fs.writeFileSync(filepath, buffer);

    const url = `/uploads/images/${filename}`;
    console.log('[Upload] 이미지 저장 완료:', url);

    res.json({
      success: true,
      url: url
    });

  } catch (error) {
    console.error('[Upload] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/upload/images
 * 여러 이미지 한번에 업로드
 * Body: { images: ["data:image/png;base64,...", ...] }
 * Returns: { success: true, urls: ["/uploads/images/xxx.png", ...] }
 */
router.post('/images', async (req, res) => {
  try {
    const { images } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: '이미지 배열이 필요합니다.'
      });
    }

    const urls = [];

    for (const image of images) {
      // base64 데이터 파싱
      const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        urls.push(null); // 실패한 경우 null
        continue;
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      // 고유 파일명 생성
      const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
      const filepath = path.join(uploadsDir, filename);

      // 파일 저장
      fs.writeFileSync(filepath, buffer);
      urls.push(`/uploads/images/${filename}`);
    }

    console.log('[Upload] 다중 이미지 저장 완료:', urls.length, '개');

    res.json({
      success: true,
      urls: urls
    });

  } catch (error) {
    console.error('[Upload] 오류:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
