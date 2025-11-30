/**
 * 가격 수집 히스토리 라우트
 * - 사용자별 가격 수집 기록 저장/조회/삭제
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 히스토리 데이터 파일 경로
const DATA_DIR = path.join(__dirname, '../data/priceHistory');

// 디렉토리 초기화
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('디렉토리 생성 오류:', error);
  }
}

// 사용자별 히스토리 파일 경로
function getUserHistoryFile(userId) {
  return path.join(DATA_DIR, `user_${userId}.json`);
}

// 히스토리 로드
async function loadHistory(userId) {
  try {
    await ensureDataDir();
    const filePath = getUserHistoryFile(userId);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// 히스토리 저장
async function saveHistory(userId, history) {
  await ensureDataDir();
  const filePath = getUserHistoryFile(userId);
  await fs.writeFile(filePath, JSON.stringify(history, null, 2));
}

// 히스토리 목록 조회
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await loadHistory(userId);

    // 최신 순으로 정렬, 각 항목에서 결과 데이터 제외 (목록용)
    const historyList = history
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(item => ({
        id: item.id,
        keyword: item.keyword,
        productCount: item.productCount,
        minPrice: item.minPrice,
        avgPrice: item.avgPrice,
        maxPrice: item.maxPrice,
        createdAt: item.createdAt
      }));

    res.json({ success: true, history: historyList });
  } catch (error) {
    console.error('히스토리 조회 오류:', error);
    res.status(500).json({ success: false, message: '히스토리 조회 실패' });
  }
});

// 히스토리 상세 조회 (결과 데이터 포함)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const historyId = req.params.id;
    const history = await loadHistory(userId);

    const item = history.find(h => h.id === historyId);

    if (!item) {
      return res.status(404).json({ success: false, message: '히스토리를 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('히스토리 상세 조회 오류:', error);
    res.status(500).json({ success: false, message: '히스토리 상세 조회 실패' });
  }
});

// 히스토리 저장
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { keyword, results, stats } = req.body;

    if (!keyword || !results) {
      return res.status(400).json({ success: false, message: '키워드와 결과가 필요합니다.' });
    }

    const history = await loadHistory(userId);

    // 새 히스토리 항목 생성
    const newItem = {
      id: `ph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      keyword: keyword,
      results: results, // 상품 목록 데이터
      productCount: results.length,
      minPrice: stats?.minPrice || 0,
      avgPrice: stats?.avgPrice || 0,
      maxPrice: stats?.maxPrice || 0,
      midPrice: stats?.midPrice || 0,
      createdAt: new Date().toISOString()
    };

    // 최대 50개까지만 저장 (오래된 것 자동 삭제)
    history.unshift(newItem);
    if (history.length > 50) {
      history.splice(50);
    }

    await saveHistory(userId, history);

    res.json({ success: true, id: newItem.id, message: '히스토리가 저장되었습니다.' });
  } catch (error) {
    console.error('히스토리 저장 오류:', error);
    res.status(500).json({ success: false, message: '히스토리 저장 실패' });
  }
});

// 히스토리 삭제
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const historyId = req.params.id;
    let history = await loadHistory(userId);

    const initialLength = history.length;
    history = history.filter(h => h.id !== historyId);

    if (history.length === initialLength) {
      return res.status(404).json({ success: false, message: '히스토리를 찾을 수 없습니다.' });
    }

    await saveHistory(userId, history);

    res.json({ success: true, message: '히스토리가 삭제되었습니다.' });
  } catch (error) {
    console.error('히스토리 삭제 오류:', error);
    res.status(500).json({ success: false, message: '히스토리 삭제 실패' });
  }
});

// 히스토리 전체 삭제
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    await saveHistory(userId, []);

    res.json({ success: true, message: '모든 히스토리가 삭제되었습니다.' });
  } catch (error) {
    console.error('히스토리 전체 삭제 오류:', error);
    res.status(500).json({ success: false, message: '히스토리 전체 삭제 실패' });
  }
});

module.exports = router;
