/**
 * 인증 라우트
 * - 로그인
 * - 회원가입
 * - 사용자 정보 조회
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 유저 데이터 파일 경로
const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// 디렉토리 및 파일 초기화
async function ensureDataExists() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(USERS_FILE);
    } catch {
      // 파일이 없으면 기본 유저로 초기화
      const adminPassword = await bcrypt.hash('admin123', 10);
      const testPassword = await bcrypt.hash('test123', 10);
      const defaultUsers = [
        {
          id: 1,
          username: 'admin',
          password: adminPassword,
          name: '관리자',
          grade: 'premium',
          is_admin: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 2,
          username: 'test',
          password: testPassword,
          name: '테스트',
          grade: 'basic',
          is_admin: false,
          createdAt: new Date().toISOString()
        }
      ];
      await fs.writeFile(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    }
  } catch (error) {
    console.error('데이터 초기화 오류:', error);
  }
}

// 유저 목록 로드
async function loadUsers() {
  try {
    await ensureDataExists();
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    let users = JSON.parse(data);

    // test 계정이 없으면 자동 추가
    const hasTestUser = users.some(u => u.username === 'test');
    if (!hasTestUser) {
      const testPassword = await bcrypt.hash('test123', 10);
      const maxId = users.reduce((max, u) => Math.max(max, u.id), 0);
      users.push({
        id: maxId + 1,
        username: 'test',
        password: testPassword,
        name: '테스트',
        grade: 'basic',
        is_admin: false,
        createdAt: new Date().toISOString()
      });
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
      console.log('[Auth] test 계정 자동 추가됨');
    }

    return users;
  } catch (error) {
    console.error('유저 로드 오류:', error);
    return [];
  }
}

// 유저 목록 저장
async function saveUsers(users) {
  await ensureDataExists();
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// 로그인
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '아이디와 비밀번호를 입력하세요.'
      });
    }

    // 유저 목록 로드
    const users = await loadUsers();

    // 사용자 찾기
    const user = users.find(u => u.username === username);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '아이디 또는 비밀번호가 잘못되었습니다.'
      });
    }

    // 비밀번호 검증
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '아이디 또는 비밀번호가 잘못되었습니다.'
      });
    }

    // JWT 토큰 생성
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        grade: user.grade
      },
      process.env.JWT_SECRET || 'totalbot_secret_key',
      { expiresIn: '7d' }
    );

    // 비밀번호 제외하고 응답
    const { password: _, ...userInfo } = user;

    res.json({
      success: true,
      token,
      user: userInfo
    });

  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({
      success: false,
      message: '로그인 처리 중 오류가 발생했습니다.'
    });
  }
});

// 회원가입
router.post('/register', async (req, res) => {
  try {
    const { username, password, name } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({
        success: false,
        message: '모든 필드를 입력하세요.'
      });
    }

    // 유저 목록 로드
    const users = await loadUsers();

    // 중복 확인
    const existingUser = users.find(u => u.username === username);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '이미 사용 중인 아이디입니다.'
      });
    }

    // 비밀번호 해시
    const hashedPassword = await bcrypt.hash(password, 10);

    // 새 사용자 ID 생성
    const maxId = users.reduce((max, u) => Math.max(max, u.id), 0);

    // 새 사용자 생성
    const newUser = {
      id: maxId + 1,
      username,
      password: hashedPassword,
      name,
      grade: 'basic',
      is_admin: false,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await saveUsers(users);

    // 유저별 상품 폴더 생성
    const userProductDir = path.join(DATA_DIR, 'products', String(newUser.id));
    await fs.mkdir(userProductDir, { recursive: true });
    await fs.writeFile(path.join(userProductDir, 'products.json'), '[]');

    // 비밀번호 제외하고 응답
    const { password: _, ...userInfo } = newUser;

    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      user: userInfo
    });

  } catch (error) {
    console.error('회원가입 오류:', error);
    res.status(500).json({
      success: false,
      message: '회원가입 처리 중 오류가 발생했습니다.'
    });
  }
});

// 사용자 정보 조회 (인증 필요)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const users = await loadUsers();
    const user = users.find(u => u.id === req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    const { password: _, ...userInfo } = user;

    res.json({
      success: true,
      user: userInfo
    });

  } catch (error) {
    console.error('사용자 정보 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '사용자 정보 조회 중 오류가 발생했습니다.'
    });
  }
});

// 유저 목록 내보내기 (다른 라우트에서 사용)
module.exports = router;
module.exports.loadUsers = loadUsers;
module.exports.saveUsers = saveUsers;
