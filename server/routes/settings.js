/**
 * 유저별 설정 라우트
 * - 견적서 매핑 설정 저장/조회
 * - 기타 유저별 설정 관리
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 설정 데이터 디렉토리
const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_DIR = path.join(DATA_DIR, 'settings');

// 유저별 설정 파일 경로
function getUserSettingsPath(userId) {
  return path.join(SETTINGS_DIR, `user_${userId}.json`);
}

// 디렉토리 확인 및 생성
async function ensureSettingsDir() {
  try {
    await fs.mkdir(SETTINGS_DIR, { recursive: true });
  } catch (error) {
    console.error('설정 디렉토리 생성 오류:', error);
  }
}

// 유저 설정 로드
async function loadUserSettings(userId) {
  try {
    await ensureSettingsDir();
    const filePath = getUserSettingsPath(userId);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // 파일이 없으면 기본값 반환
    return {
      quotationMappings: [],
      priceSettings: {
        marginType: 'percentage',
        marginValue: 30,
        roundingUnit: 100
      },
      updatedAt: null
    };
  }
}

// 유저 설정 저장
async function saveUserSettings(userId, settings) {
  await ensureSettingsDir();
  const filePath = getUserSettingsPath(userId);
  settings.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2));
}

// 전체 설정 조회
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = await loadUserSettings(userId);

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('설정 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '설정 조회 중 오류가 발생했습니다.'
    });
  }
});

// 전체 설정 저장
router.put('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const newSettings = req.body;

    // 기존 설정 로드
    const currentSettings = await loadUserSettings(userId);

    // 새 설정으로 병합
    const mergedSettings = {
      ...currentSettings,
      ...newSettings
    };

    await saveUserSettings(userId, mergedSettings);

    res.json({
      success: true,
      message: '설정이 저장되었습니다.',
      settings: mergedSettings
    });
  } catch (error) {
    console.error('설정 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '설정 저장 중 오류가 발생했습니다.'
    });
  }
});

// 견적서 매핑 설정 조회
router.get('/quotation-mappings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = await loadUserSettings(userId);

    res.json({
      success: true,
      quotationMappings: settings.quotationMappings || []
    });
  } catch (error) {
    console.error('견적서 매핑 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '견적서 매핑 조회 중 오류가 발생했습니다.'
    });
  }
});

// 견적서 매핑 설정 저장
router.put('/quotation-mappings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { quotationMappings } = req.body;

    if (!Array.isArray(quotationMappings)) {
      return res.status(400).json({
        success: false,
        message: 'quotationMappings는 배열이어야 합니다.'
      });
    }

    // 기존 설정 로드
    const settings = await loadUserSettings(userId);

    // 견적서 매핑만 업데이트
    settings.quotationMappings = quotationMappings;

    await saveUserSettings(userId, settings);

    res.json({
      success: true,
      message: '견적서 매핑이 저장되었습니다.',
      quotationMappings
    });
  } catch (error) {
    console.error('견적서 매핑 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '견적서 매핑 저장 중 오류가 발생했습니다.'
    });
  }
});

// 견적서 매핑 추가 (기존 매핑에 새 매핑 추가)
router.post('/quotation-mappings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { mapping } = req.body;

    if (!mapping || !mapping.header) {
      return res.status(400).json({
        success: false,
        message: '유효한 매핑 정보가 필요합니다.'
      });
    }

    // 기존 설정 로드
    const settings = await loadUserSettings(userId);

    // 같은 header의 기존 매핑이 있으면 업데이트, 없으면 추가
    const existingIndex = settings.quotationMappings.findIndex(
      m => m.header === mapping.header
    );

    if (existingIndex >= 0) {
      settings.quotationMappings[existingIndex] = mapping;
    } else {
      settings.quotationMappings.push(mapping);
    }

    await saveUserSettings(userId, settings);

    res.json({
      success: true,
      message: '매핑이 추가되었습니다.',
      quotationMappings: settings.quotationMappings
    });
  } catch (error) {
    console.error('견적서 매핑 추가 오류:', error);
    res.status(500).json({
      success: false,
      message: '견적서 매핑 추가 중 오류가 발생했습니다.'
    });
  }
});

// 가격 설정 조회
router.get('/price', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = await loadUserSettings(userId);

    res.json({
      success: true,
      priceSettings: settings.priceSettings || {
        marginType: 'percentage',
        marginValue: 30,
        roundingUnit: 100
      }
    });
  } catch (error) {
    console.error('가격 설정 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '가격 설정 조회 중 오류가 발생했습니다.'
    });
  }
});

// 가격 설정 저장
router.put('/price', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { priceSettings } = req.body;

    // 기존 설정 로드
    const settings = await loadUserSettings(userId);

    // 가격 설정 업데이트
    settings.priceSettings = {
      ...settings.priceSettings,
      ...priceSettings
    };

    await saveUserSettings(userId, settings);

    res.json({
      success: true,
      message: '가격 설정이 저장되었습니다.',
      priceSettings: settings.priceSettings
    });
  } catch (error) {
    console.error('가격 설정 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '가격 설정 저장 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
