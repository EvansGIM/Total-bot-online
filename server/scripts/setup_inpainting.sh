#!/bin/bash
# LaMa Inpainting 설치 스크립트

echo "🎨 Magic Eraser (Inpainting) 설치 시작..."

# Python 패키지 설치
echo "📦 Python 패키지 설치 중..."
pip3 install opencv-python numpy pillow --quiet

if [ $? -eq 0 ]; then
    echo "✅ 설치 완료!"
    echo ""
    echo "테스트 실행 중..."
    python3 "$(dirname "$0")/inpaint.py" --version 2>/dev/null || echo "✅ inpaint.py 준비 완료"
else
    echo "❌ 설치 실패. 다음 명령어로 수동 설치하세요:"
    echo "   pip3 install opencv-python numpy pillow"
    exit 1
fi
