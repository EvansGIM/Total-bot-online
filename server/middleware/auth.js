/**
 * 인증 미들웨어
 * JWT 토큰 검증
 */

const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    // Authorization 헤더에서 토큰 추출
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '인증 토큰이 없습니다.'
      });
    }

    const token = authHeader.split(' ')[1];

    // 토큰 검증
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 사용자 정보를 req에 추가
    req.user = decoded;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: '유효하지 않은 토큰입니다.'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '토큰이 만료되었습니다.'
      });
    }

    return res.status(500).json({
      success: false,
      message: '인증 처리 중 오류가 발생했습니다.'
    });
  }
};

module.exports = authMiddleware;
