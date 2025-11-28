"""
쿠팡 쿠키 추출 및 설정 헬퍼
브라우저에서 쿠키를 복사해서 Python 딕셔너리로 변환
"""

def parse_cookie_string(cookie_string: str) -> dict:
    """
    브라우저에서 복사한 쿠키 문자열을 딕셔너리로 변환
    
    사용법:
    1. Chrome F12 → Application → Cookies → supplier.coupang.com
    2. 모든 쿠키를 선택해서 복사
    3. 아래 함수에 붙여넣기
    """
    cookies = {}
    
    # 세미콜론으로 분리
    for cookie in cookie_string.split(';'):
        cookie = cookie.strip()
        if '=' in cookie:
            key, value = cookie.split('=', 1)
            cookies[key.strip()] = value.strip()
    
    return cookies


def extract_essential_cookies(all_cookies: dict) -> dict:
    """필수 쿠키만 추출"""
    essential_keys = [
        'sid',
        'CSID', 
        'member_srl',
        'ILOGIN',
        'CT_AT',
        'JSESSIONID',
        '_abck',
        'bm_sz',
        'ak_bmsc'
    ]
    
    return {k: v for k, v in all_cookies.items() if k in essential_keys}


def generate_env_file(cookies: dict, output_file: str = '.env'):
    """
    .env 파일 생성
    """
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('# 쿠팡 세션 쿠키\n')
        f.write('# 주기적으로 업데이트 필요 (약 1-2주)\n\n')
        
        for key, value in cookies.items():
            f.write(f'COUPANG_{key.upper()}={value}\n')
        
        f.write('\n# API 설정\n')
        f.write('API_HOST=0.0.0.0\n')
        f.write('API_PORT=8000\n')
        f.write('CORS_ORIGINS=http://localhost:3000,https://likezone.co.kr\n')
    
    print(f'✅ .env 파일이 생성되었습니다: {output_file}')


# 사용 예시
if __name__ == '__main__':
    print("=" * 80)
    print("쿠팡 쿠키 설정 도구")
    print("=" * 80)
    print()
    print("📌 사용 방법:")
    print("1. Chrome에서 supplier.coupang.com 로그인")
    print("2. F12 → Application → Cookies → supplier.coupang.com")
    print("3. 아래에 쿠키 문자열 붙여넣기 (세미콜론으로 구분된 형태)")
    print()
    print("또는 직접 딕셔너리 형태로 입력:")
    print()
    
    # 예시 1: 쿠키 문자열에서 변환
    example_cookie_string = """
    sid=6ac3fcff14ac4d0a9a41207f9addf518cd45aa3e; 
    CSID=DUM_eNx520chtJPCNtm3eJp.55133fh5p; 
    member_srl=118662519; 
    ILOGIN=Y
    """
    
    print("예시 입력:")
    print(example_cookie_string)
    print()
    
    cookies = parse_cookie_string(example_cookie_string)
    print("변환 결과:")
    print(cookies)
    print()
    
    essential = extract_essential_cookies(cookies)
    print("필수 쿠키:")
    print(essential)
    print()
    
    # .env 파일 생성
    print("아래 내용을 .env 파일에 저장하세요:")
    print("-" * 80)
    for key, value in essential.items():
        print(f'COUPANG_{key.upper()}={value}')
