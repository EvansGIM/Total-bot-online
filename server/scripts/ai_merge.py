#!/usr/bin/env python3
"""
AI Image Merge - Combine multiple product images using Gemini AI
"""
import sys
import json
import base64
from io import BytesIO
from PIL import Image

def base64_to_pil(base64_string):
    """Base64 문자열을 PIL 이미지로 변환"""
    # data:image/png;base64, 제거
    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]

    img_data = base64.b64decode(base64_string)
    img = Image.open(BytesIO(img_data))
    return img

def pil_to_base64(img):
    """PIL 이미지를 Base64 문자열로 변환"""
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{img_base64}"

def get_prompt_for_mode(mode, products_list, num_images):
    """모드에 따른 프롬프트 반환"""

    if mode == 'ai_product':
        # 흰 배경 제품 이미지 모드
        return f"""IMPORTANT: This is for creating a PRODUCT-ONLY IMAGE for e-commerce/online shopping.

PRODUCT INFORMATION (for your reference):
{products_list}

Create a professional e-commerce product photo combining all the items from these {num_images} images into a single set photo.

CRITICAL REQUIREMENTS:
1. PURE WHITE BACKGROUND (#FFFFFF) - absolutely clean, no shadows, no gradients
2. PRODUCTS ONLY - NO PEOPLE, NO MODELS, NO MANNEQUINS
3. Extract only the products/items from each image
4. Arrange all {num_images} products together in a clean, professional flat-lay or arranged composition
5. Show all items clearly in the same frame with good lighting
6. Professional product photography style - like Amazon or high-end e-commerce

DO NOT ADD ANY EXTRA ITEMS:
- DO NOT add any products, accessories, or items that are not shown in the input images
- ONLY show the exact items from the input images, nothing more
- Keep the composition simple and focused on the provided items only

Create a high-quality, professional product-only photo with pure white background. All items from all {num_images} images must be visible in the final photo."""

    elif mode == 'ai_model':
        # 모델 이미지 모드
        return f"""IMPORTANT: This is for creating a MODEL/LIFESTYLE IMAGE for e-commerce/online shopping.

PRODUCT INFORMATION (for your reference):
{products_list}

Create a professional e-commerce photo with models wearing/using all the items from these {num_images} images.

CRITICAL REQUIREMENTS:
1. Generate {num_images} NEW attractive people/models (NOT the original models from the input images)
2. Each model should wear or hold ONE item from each input image
3. If the items are the same type in different colors (e.g., pants in blue, black, green), show {num_images} different models each wearing a different color
4. If the items are different types (e.g., shirt, pants, shoes), you may show them on the same person or different people as appropriate
5. All models should be stylish and look different from any people in the original images
6. Arrange the models together in one cohesive lifestyle photo
7. Use a clean, professional background (studio or simple lifestyle setting)

DO NOT ADD ANY EXTRA ITEMS:
- DO NOT add any products, accessories, or items that are not shown in the input images
- DO NOT place extra products on the floor, background, or anywhere else
- ONLY show the exact items from the input images being worn/held by the models
- Keep the scene simple and focused on the provided items only

Create a high-quality, professional lifestyle/model photo suitable for online shopping. All items from all {num_images} images must be visible on the models in the final photo."""

    else:
        # 기본 모드 (이전과 동일)
        return f"""IMPORTANT: This is for creating a PRODUCT SALES IMAGE for e-commerce/online shopping.

PRODUCT INFORMATION (for your reference):
{products_list}

Create a professional e-commerce product photo combining all the items from these {num_images} images into a single set photo.

IMPORTANT RULES:
1. If the images show people/models wearing products:
   - Generate {num_images} NEW people/models (NOT the original models from the input images)
   - Each new model should wear ONE item from each input image
   - If the items are the same type in different colors (e.g., pants in blue, black, green), show {num_images} different models each wearing a different color
   - If the items are different types (e.g., shirt, pants, shoes), you may show them on the same person or different people as appropriate
   - All new models should look different from the people in the original images
   - Arrange the models together in one cohesive photo

2. If the images show only products/objects without people:
   - Arrange all {num_images} products together in one clean, professional composition
   - Show all items clearly in the same frame
   - Create an attractive product layout suitable for e-commerce

3. DO NOT ADD ANY EXTRA ITEMS:
   - DO NOT add any products, accessories, or items that are not shown in the input images
   - DO NOT place extra products on the floor, background, or anywhere else
   - ONLY show the exact items from the input images, nothing more
   - Keep the scene simple and focused on the provided items only

Create a high-quality, professional product photo with clean background, good lighting, and suitable for online shopping. All items from all {num_images} images must be visible in the final photo. Do not add anything extra."""


def merge_images_with_ai(images_base64, product_names, mode='default'):
    """
    Gemini AI를 사용하여 여러 이미지를 하나로 합침

    Args:
        images_base64: 이미지들의 base64 리스트
        product_names: 상품명 리스트 (AI 컨텍스트용)
        mode: 'ai_product' (흰배경 제품), 'ai_model' (모델 이미지), 'default' (자동)

    Returns:
        합쳐진 이미지 (base64)
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError("google-genai 패키지가 필요합니다. pip install google-genai")

    # 이미지 로드
    images = []
    for img_b64 in images_base64:
        try:
            img = base64_to_pil(img_b64)
            images.append(img)
        except Exception as e:
            print(f"이미지 로드 실패: {e}", file=sys.stderr)

    if len(images) < 2:
        raise ValueError("최소 2개 이상의 이미지가 필요합니다.")

    # Gemini API 클라이언트 초기화
    client = genai.Client(api_key="AIzaSyAgVUOctLOaPiA87MdXrjLEbXDQCmWwvj0")

    # 상품 목록 프롬프트 생성
    products_list = "\n".join([f"- Image {i+1}: {name}" for i, name in enumerate(product_names)])

    # 모드에 따른 프롬프트 선택
    prompt = get_prompt_for_mode(mode, products_list, len(images))
    print(f"[AI Merge] 모드: {mode}", file=sys.stderr)

    # Gemini API 호출
    contents = [prompt] + images

    response = client.models.generate_content(
        model="gemini-2.0-flash-exp",
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        )
    )

    # 생성된 이미지 추출
    image_bytes = None
    for part in response.candidates[0].content.parts:
        if hasattr(part, 'inline_data') and part.inline_data is not None:
            try:
                if hasattr(part.inline_data, 'data'):
                    image_bytes = part.inline_data.data
                    break
            except Exception as e:
                print(f"inline_data 추출 실패: {e}", file=sys.stderr)

    if not image_bytes:
        raise ValueError("AI 이미지 생성에 실패했습니다.")

    # bytes를 PIL 이미지로 변환 후 base64로
    result_img = Image.open(BytesIO(image_bytes))
    return pil_to_base64(result_img)

if __name__ == '__main__':
    # stdin에서 JSON 입력 받기
    # Input: {"images": ["data:image/png;base64,...", ...], "productNames": ["상품1", "상품2"]}

    try:
        # stdin에서 JSON 읽기
        input_data = json.load(sys.stdin)

        images_base64 = input_data.get('images', [])
        product_names = input_data.get('productNames', [])
        mode = input_data.get('mode', 'default')

        if len(images_base64) < 2:
            print(json.dumps({"error": "최소 2개 이상의 이미지가 필요합니다."}), file=sys.stderr)
            sys.exit(1)

        # 상품명이 없으면 기본값 사용
        if len(product_names) < len(images_base64):
            product_names = [f"제품 {i+1}" for i in range(len(images_base64))]

        result = merge_images_with_ai(images_base64, product_names, mode)
        print(result)

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
