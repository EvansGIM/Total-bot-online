/**
 * 엑셀 처리 라우트
 * - 엑셀 생성
 * - 엑셀 업로드
 * - 엑셀 파싱
 */

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 파일 업로드 설정
const upload = multer({
  dest: 'uploads/temp/',
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('엑셀 파일만 업로드 가능합니다.'));
    }
  }
});

// 엑셀 생성 및 다운로드
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: '데이터가 없습니다.'
      });
    }

    // 데이터를 워크시트로 변환
    const worksheet = XLSX.utils.json_to_sheet(data);

    // 워크북 생성
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '상품목록');

    // 엑셀 파일을 버퍼로 생성
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx'
    });

    // 파일명 생성
    const filename = `상품목록_${new Date().toISOString().slice(0, 10)}.xlsx`;

    // 다운로드 헤더 설정
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    res.send(buffer);

  } catch (error) {
    console.error('엑셀 생성 오류:', error);
    res.status(500).json({
      success: false,
      message: '엑셀 생성 중 오류가 발생했습니다.'
    });
  }
});

// 엑셀 업로드 및 파싱
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '파일이 없습니다.'
      });
    }

    const filePath = req.file.path;

    // 엑셀 파일 읽기
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // JSON으로 변환
    const data = XLSX.utils.sheet_to_json(worksheet);

    // 임시 파일 삭제
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: '파일 업로드 완료',
      data: data,
      rowCount: data.length
    });

  } catch (error) {
    console.error('엑셀 업로드 오류:', error);

    // 임시 파일 삭제 시도
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('임시 파일 삭제 실패:', e);
      }
    }

    res.status(500).json({
      success: false,
      message: '파일 업로드 중 오류가 발생했습니다.'
    });
  }
});

// 엑셀 파일 파싱 (특정 헤더 찾기 - 발주서용)
router.post('/parse', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '파일이 없습니다.'
      });
    }

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // 특정 셀 찾기 (예: "주문번호", "상품명" 등)
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const headers = {};

    // 첫 40행에서 헤더 찾기
    for (let row = 0; row < Math.min(40, range.e.r); row++) {
      for (let col = 0; col <= Math.min(15, range.e.c); col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];

        if (cell && cell.v) {
          const value = String(cell.v).replace(/\s/g, '');

          // 주요 헤더 찾기
          if (value.includes('주문번호') && !headers.orderNumber) {
            headers.orderNumber = { row, col };
          } else if (value.includes('상품명') && !headers.productName) {
            headers.productName = { row, col };
          } else if (value.includes('수량') && !headers.quantity) {
            headers.quantity = { row, col };
          } else if (value.includes('가격') && !headers.price) {
            headers.price = { row, col };
          }
        }
      }
    }

    // 데이터 추출
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // 임시 파일 삭제
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      headers,
      data,
      rowCount: data.length
    });

  } catch (error) {
    console.error('엑셀 파싱 오류:', error);

    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('임시 파일 삭제 실패:', e);
      }
    }

    res.status(500).json({
      success: false,
      message: '파일 파싱 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
