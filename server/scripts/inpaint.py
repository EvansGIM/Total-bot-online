#!/usr/bin/env python3
"""
Magic Eraser - Content-Aware Fill using OpenCV inpainting
"""
import sys
import json
import cv2
import numpy as np
import base64
from io import BytesIO
from PIL import Image

def base64_to_image(base64_string):
    """Base64 문자열을 OpenCV 이미지로 변환"""
    # data:image/png;base64, 제거
    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]

    img_data = base64.b64decode(base64_string)
    img_array = np.frombuffer(img_data, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    return img

def image_to_base64(img):
    """OpenCV 이미지를 Base64 문자열로 변환"""
    _, buffer = cv2.imencode('.png', img)
    img_base64 = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/png;base64,{img_base64}"

def inpaint_image(image_base64, mask_base64, method='telea'):
    """
    이미지 inpainting 수행

    Args:
        image_base64: 원본 이미지 (base64)
        mask_base64: 마스크 이미지 (base64, 빨간색 영역이 제거할 부분)
        method: 'telea' or 'ns' (Navier-Stokes)

    Returns:
        결과 이미지 (base64)
    """
    # 이미지 디코딩
    img = base64_to_image(image_base64)
    mask = base64_to_image(mask_base64)

    # 마스크를 그레이스케일로 변환 (빨간색 영역 추출)
    # 빨간색 채널이 높고 다른 채널이 낮은 영역 찾기
    mask_gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
    _, mask_binary = cv2.threshold(mask_gray, 1, 255, cv2.THRESH_BINARY)

    # Inpainting 알고리즘 선택
    if method == 'telea':
        # Telea 알고리즘 (빠르고 깔끔)
        inpaint_method = cv2.INPAINT_TELEA
    else:
        # Navier-Stokes 알고리즘 (느리지만 더 자연스러움)
        inpaint_method = cv2.INPAINT_NS

    # Inpainting 수행 (inpaintRadius: 클수록 더 많은 주변 정보 사용)
    result = cv2.inpaint(img, mask_binary, inpaintRadius=3, flags=inpaint_method)

    # Base64로 변환하여 반환
    return image_to_base64(result)

if __name__ == '__main__':
    # stdin에서 JSON 입력 받기
    # Input: {"image": "data:image/png;base64,...", "mask": "...", "method": "telea"}

    try:
        # stdin에서 JSON 읽기
        input_data = json.load(sys.stdin)

        image_base64 = input_data.get('image')
        mask_base64 = input_data.get('mask')
        method = input_data.get('method', 'telea')

        if not image_base64 or not mask_base64:
            print(json.dumps({"error": "이미지와 마스크가 필요합니다."}), file=sys.stderr)
            sys.exit(1)

        result = inpaint_image(image_base64, mask_base64, method)
        print(result)

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
