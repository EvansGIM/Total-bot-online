/**
 * 인증 라우트
 * - 로그인
 * - 회원가입
 * - 사용자 정보 조회
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 임시 사용자 DB (실제로는 MongoDB나 MySQL 사용)
const users = [
  {
    id: 1,
    username: 'admin',
    password: '$2b$10$abcdefghijklmnopqrstuv', // bcrypt 해시 (실제로는 'admin123')
    name: '관리자',
    grade: 'premium',
    is_admin: true
  },
  {
    id: 2,
    username: 'user1',
    password: '$2b$10$abcdefghijklmnopqrstuv',
    name: '사용자1',
    grade: 'basic',
    is_admin: false
  }
];

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

    // 사용자 찾기
    const user = users.find(u => u.username === username);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '아이디 또는 비밀번호가 잘못되었습니다.'
      });
    }

    // 비밀번호 검증 (임시로 간단히 처리 - 실제로는 bcrypt 사용)
    const isPasswordValid = password === 'admin123' || password === 'user123';

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
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // 7일 유효
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

    // 새 사용자 생성
    const newUser = {
      id: users.length + 1,
      username,
      password: hashedPassword,
      name,
      grade: 'basic',
      is_admin: false
    };

    users.push(newUser);

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
router.get('/me', authMiddleware, (req, res) => {
  try {
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

module.exports = router;
