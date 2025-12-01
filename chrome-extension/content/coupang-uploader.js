/**
 * 쿠팡 견적서 자동 업로드 Content Script
 * - 파일 업로드
 * - API를 통한 검증 상태 확인
 * - 견적서 ID 획득
 */

// ===== 청크 방식 데이터 로드 =====
async function requestDataChunk(type, index = 0) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'getUploadDataChunk', type, index },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || '데이터 요청 실패'));
        }
      }
    );
  });
}

async function loadUploadDataInChunks(dataInfo) {
  console.log('📦 청크 방식으로 데이터 로드 중...', dataInfo);

  // Excel 파일들
  const excelFiles = await requestDataChunk('excelFiles');
  console.log(`   ✅ Excel 파일 ${excelFiles.length}개 로드`);

  // 상품 이미지들 (하나씩)
  const productImages = [];
  for (let i = 0; i < dataInfo.productImageCount; i++) {
    const img = await requestDataChunk('productImage', i);
    productImages.push(img);
    if ((i + 1) % 20 === 0 || i === dataInfo.productImageCount - 1) {
      console.log(`   📷 상품 이미지 ${i + 1}/${dataInfo.productImageCount} 로드`);
    }
  }

  // 라벨컷 이미지들 (하나씩)
  const labelImages = [];
  for (let i = 0; i < dataInfo.labelImageCount; i++) {
    const img = await requestDataChunk('labelImage', i);
    labelImages.push(img);
  }
  console.log(`   ✅ 라벨컷 이미지 ${labelImages.length}개 로드`);

  // 상품 정보
  const products = await requestDataChunk('products');
  console.log(`   ✅ 상품 정보 ${products.length}개 로드`);

  return { excelFiles, productImages, labelImages, products };
}

// 중복 로드 방지
if (window._coupangUploaderLoaded) {
  console.log('⚠️ Coupang Uploader already loaded, skipping...');
} else {
  window._coupangUploaderLoaded = true;
  console.log('🚀 Coupang Uploader Content Script Loaded');

  // 업로드된 파일명 및 시간 저장 (상태 확인용) - window 객체 사용
  window.uploadedFilenames = window.uploadedFilenames || [];
  window.uploadStartTime = window.uploadStartTime || null;
}

// 메시지 리스너
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📩 Coupang Uploader received message:', message);

  if (message.action === 'uploadToCoupang') {
    // 청크 방식으로 데이터 로드 또는 직접 전달받은 데이터 사용
    (async () => {
      try {
        let data;
        if (message.useChunkedTransfer) {
          console.log('📦 청크 방식으로 대용량 데이터 로드 중...');
          data = await loadUploadDataInChunks(message.dataInfo);
          console.log('✅ 청크 데이터 로드 완료');
        } else {
          data = message.data;
        }
        const result = await handleCoupangUpload(data);
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답
  }

  if (message.action === 'checkUploadStatus') {
    checkUploadStatus()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * 쿠팡 업로드 메인 함수
 */
async function handleCoupangUpload(data) {
  try {
    console.log('📤 Starting Coupang upload process...', data);

    const { excelFiles, productImages, labelImages, products } = data;

    // 1. 페이지가 로드될 때까지 대기
    await waitForPageLoad();

    // 2. 언어를 한국어로 변경
    await changeLanguageToKorean();

    // 3. 파일 업로드
    const uploadResult = await uploadFiles(excelFiles, productImages, labelImages);
    if (!uploadResult.success) {
      return uploadResult;
    }

    // 4. 파일 검증 버튼 클릭
    const validationResult = await clickValidateButton();
    if (!validationResult.success) {
      return validationResult;
    }

    // 5. 검증 완료 팝업 대기 (팝업이 뜨면 업로드 성공!)
    const popupFound = await waitForSubmitPopup();

    // 6. 팝업 닫기 (DOM에서 제거)
    await closePopups();

    // 팝업이 감지되면 업로드 제출 성공
    if (popupFound) {
      console.log('✅ 견적서 제출 팝업 감지 - API에서 실제 ID 조회 중...');

      // 짧은 폴링으로 실제 견적서 ID와 상태 확인 (최대 30초)
      const quotationResult = await getLatestQuotationStatus(30000);

      if (quotationResult) {
        console.log('📋 견적서 정보:', quotationResult);
        if (quotationResult.rawData) {
          console.log('📋 원본 API 응답:', JSON.stringify(quotationResult.rawData, null, 2));
        }

        // 검증 완료까지 대기 (최대 2분 추가 폴링)
        const finalResult = await waitForFinalStatus(quotationResult.id, 120000);

        if (finalResult) {
          const status = (finalResult.status || '').toUpperCase();
          const result = finalResult.result || '';

          console.log(`📊 최종 상태 - status: "${status}", result: "${result}"`);
          console.log(`📊 성공 여부: ${finalResult.success}, 성공: ${finalResult.passedCount}, 실패: ${finalResult.failedCount}`);

          // 반려 확인 - API에서 validationStatus가 "REJECTED"
          const isRejected = status === 'REJECTED' || finalResult.success === false;

          if (isRejected) {
            // 반려된 경우 - 상세 내역 다운로드 URL과 함께 실패 반환
            console.log('❌ 견적서 반려됨:', finalResult);
            return {
              success: false,
              rejected: true,
              quoteId: finalResult.id,
              quotationName: finalResult.name,
              downloadUrl: `https://supplier.coupang.com/qvt/quotation/${finalResult.id}/inspection/result/file`,
              error: `견적서가 반려되었습니다. ${result}`
            };
          }

          // 완료 상태 확인 - API에서 validationStatus가 "APPROVED" 또는 success가 true
          const isCompleted = status === 'APPROVED' || finalResult.success === true;

          if (isCompleted) {
            saveQuotationData(finalResult.id, products, excelFiles);
            return {
              success: true,
              quoteId: finalResult.id,
              quotationName: finalResult.name,
              status: finalResult.status,
              message: `쿠팡 견적서 검증 완료!`
            };
          }
        }

        // 검증중 상태로 시간 초과 - 수동 확인 필요
        console.log('⚠️ 검증 진행 중 - 수동 확인 필요');
        return {
          success: false,
          pending: true,
          quoteId: quotationResult.id,
          quotationName: quotationResult.name,
          error: '검증이 아직 진행 중입니다. 쿠팡 사이트에서 결과를 확인해주세요.'
        };
      }

      // ID를 찾지 못한 경우
      console.log('⚠️ 견적서 ID를 찾지 못함');
      return {
        success: false,
        error: '견적서 ID를 찾지 못했습니다. 쿠팡 사이트에서 확인해주세요.'
      };
    }

    // 7. 팝업이 없으면 API를 통해 검증 상태 확인 (폴링)
    console.log('⚠️ 팝업 미감지 - API 폴링으로 상태 확인');
    const statusResult = await pollUploadStatus();
    if (!statusResult.success) {
      return statusResult;
    }

    // 8. 견적서 ID와 제품 정보 저장
    const quoteId = statusResult.quoteId;
    saveQuotationData(quoteId, products, excelFiles);

    return {
      success: true,
      quoteId: quoteId,
      message: '쿠팡 견적서 업로드 완료!'
    };

  } catch (error) {
    console.error('❌ Coupang upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 페이지 로드 대기
 */
function waitForPageLoad() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', resolve);
    }
  });
}

/**
 * 언어를 한국어로 변경
 */
async function changeLanguageToKorean() {
  try {
    console.log('🌐 언어를 한국어로 변경 중...');

    // 언어 드롭다운 버튼 찾기
    const languageButton = document.querySelector('.rs-locale button.rs-btn');
    if (languageButton) {
      languageButton.click();
      await sleep(500);

      // 한국어 옵션 클릭
      const koreanOption = document.querySelector("button[lang='ko']");
      if (koreanOption) {
        koreanOption.click();
        console.log('✅ 한국어로 변경 완료');
        await sleep(1000);
        return true;
      }
    }

    console.log('⚠️ 언어 드롭다운을 찾을 수 없습니다 (이미 한국어일 수 있음)');
    return true;
  } catch (error) {
    console.log('⚠️ 언어 변경 실패:', error);
    return true; // 계속 진행
  }
}

/**
 * Base64를 Blob으로 변환
 */
function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: mimeType });
}

/**
 * 파일 업로드
 */
async function uploadFiles(excelFilesData, productImagesData, labelImagesData) {
  try {
    console.log('📤 파일 업로드 시작...');
    console.log('   Excel 파일:', excelFilesData);
    console.log('   상품 이미지:', productImagesData?.length || 0, '개');
    console.log('   라벨컷 이미지:', labelImagesData?.length || 0, '개');

    // 업로드 시작 시간 및 파일명 저장 (상태 확인용)
    window.uploadStartTime = new Date();
    window.uploadedFilenames = excelFilesData?.map(f => f.filename) || [];
    console.log('⏰ 업로드 시작 시간:', window.uploadStartTime.toLocaleString());
    console.log('📋 업로드 파일명:', window.uploadedFilenames);

    // 페이지의 모든 file input 찾기
    await sleep(1000); // 페이지 로딩 대기
    const fileInputs = document.querySelectorAll("input[type='file']");
    console.log('   📋 페이지에서 찾은 file input:', fileInputs.length, '개');

    fileInputs.forEach((input, index) => {
      const label = input.closest('label') || input.parentElement;
      const labelText = label ? label.textContent.trim().substring(0, 50) : 'no label';
      console.log(`      [${index}] ${input.name || input.id || 'unnamed'}: ${labelText}`);
    });

    if (fileInputs.length < 3) {
      return {
        success: false,
        error: `파일 입력 필드를 충분히 찾을 수 없습니다 (${fileInputs.length}개)`
      };
    }

    // 1. 견적서 Excel 파일 업로드 (첫 번째 input)
    if (excelFilesData && excelFilesData.length > 0) {
      console.log('\n📋 1단계: 견적서 Excel 파일 업로드 중...');
      const excelInput = fileInputs[0];

      // Base64를 File 객체로 변환
      const excelFiles = [];
      for (const excelData of excelFilesData) {
        const blob = base64ToBlob(
          excelData.base64,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        const file = new File([blob], excelData.filename, {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        excelFiles.push(file);
        console.log(`   ✅ Excel 파일 준비: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
      }

      // DataTransfer로 input에 설정
      const dataTransfer = new DataTransfer();
      excelFiles.forEach(file => dataTransfer.items.add(file));
      excelInput.files = dataTransfer.files;

      // change 이벤트 트리거
      excelInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`   ✅ Excel 파일 ${excelFiles.length}개 업로드 완료`);
      await sleep(1000);
    }

    // 2. 상품 이미지 일괄 업로드 (두 번째 input) - 개별 이미지 파일
    if (productImagesData && productImagesData.length > 0) {
      console.log(`\n🖼️ 2단계: 상품 이미지 ${productImagesData.length}개 업로드 중...`);
      const imageInput = fileInputs[1];

      // Base64를 File 객체로 변환
      const productImageFiles = [];
      for (const imgData of productImagesData) {
        const mimeType = imgData.filename.endsWith('.png') ? 'image/png' :
                        imgData.filename.endsWith('.jpg') || imgData.filename.endsWith('.jpeg') ? 'image/jpeg' :
                        'image/png';
        const blob = base64ToBlob(imgData.base64, mimeType);
        const file = new File([blob], imgData.filename, { type: mimeType });
        productImageFiles.push(file);
      }
      console.log(`   ✅ 상품 이미지 ${productImageFiles.length}개 준비 완료`);

      // DataTransfer로 input에 설정
      const dataTransfer = new DataTransfer();
      productImageFiles.forEach(file => dataTransfer.items.add(file));
      imageInput.files = dataTransfer.files;

      // change 이벤트 트리거
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('   ✅ 상품 이미지 업로드 완료');
      await sleep(1000);
    }

    // 3. 제품 필수 표시사항 이미지 업로드 (세 번째 input) - 라벨컷 이미지만
    if (labelImagesData && labelImagesData.length > 0) {
      console.log(`\n🖼️ 3단계: 라벨컷 이미지 ${labelImagesData.length}개 업로드 중...`);
      const labelInput = fileInputs[2];

      // Base64를 File 객체로 변환
      const labelImageFiles = [];
      for (const imgData of labelImagesData) {
        const mimeType = imgData.filename.endsWith('.png') ? 'image/png' :
                        imgData.filename.endsWith('.jpg') || imgData.filename.endsWith('.jpeg') ? 'image/jpeg' :
                        'image/jpeg';
        const blob = base64ToBlob(imgData.base64, mimeType);
        const file = new File([blob], imgData.filename, { type: mimeType });
        labelImageFiles.push(file);
      }
      console.log(`   ✅ 라벨컷 이미지 ${labelImageFiles.length}개 준비 완료`);

      // DataTransfer로 input에 설정
      const dataTransfer = new DataTransfer();
      labelImageFiles.forEach(file => dataTransfer.items.add(file));
      labelInput.files = dataTransfer.files;

      // change 이벤트 트리거
      labelInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('   ✅ 라벨컷 이미지 업로드 완료');
      await sleep(1000);
    }

    // 4. 모든 "없음" 라디오 버튼 클릭 (법적 근거, 상품 개별법령 등)
    console.log('\n📄 4단계: 모든 "없음" 라디오 버튼 선택...');
    await sleep(1000);

    const allRadios = document.querySelectorAll('input[type="radio"]');
    console.log(`   📋 전체 라디오 버튼 ${allRadios.length}개 발견`);

    let clickedCount = 0;

    for (const radio of allRadios) {
      const radioId = radio.id;

      if (radioId) {
        const label = document.querySelector(`label[for="${radioId}"]`);
        if (label) {
          const labelText = label.textContent.trim();

          // "없음" 라벨 찾기
          if (labelText === '없음') {
            // 이미 선택되어 있으면 스킵
            if (radio.checked) {
              console.log(`   ⏭️ 이미 선택됨: "${labelText}"`);
              continue;
            }

            // 부모 요소에서 어떤 섹션인지 확인
            let parent = radio.closest('div');
            let sectionContext = '';

            // 가장 가까운 텍스트 컨텐츠 찾기
            while (parent && sectionContext.length < 50) {
              const textNodes = Array.from(parent.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
              const text = textNodes.map(n => n.textContent.trim()).join(' ');
              if (text) {
                sectionContext = text;
                break;
              }
              parent = parent.parentElement;
            }

            console.log(`   ✅ "없음" 라디오 버튼 클릭: ${radioId} (컨텍스트: ${sectionContext.substring(0, 30)}...)`);
            radio.click();
            clickedCount++;
            await sleep(300);
          }
        }
      }
    }

    console.log(`   📊 총 ${clickedCount}개의 "없음" 라디오 버튼 클릭됨`);

    if (clickedCount === 0) {
      console.log('   ⚠️ "없음" 라디오 버튼을 찾을 수 없습니다');
    }

    // 5. 약관 동의 체크
    console.log('\n📝 5단계: 약관 동의 체크...');
    await sleep(500);
    const agreementCheckbox = document.querySelector("input[name='msrpAgreement']");
    if (agreementCheckbox) {
      if (!agreementCheckbox.checked) {
        agreementCheckbox.click();
        console.log('   ✅ 약관 동의 체크 완료');
        await sleep(500);
      } else {
        console.log('   ✅ 이미 체크됨');
      }
    }

    console.log('\n✅ 파일 업로드 완료');
    return { success: true };

  } catch (error) {
    console.error('❌ 파일 업로드 오류:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 파일 검증 버튼 클릭
 */
async function clickValidateButton() {
  try {
    console.log('🔍 파일 검증 버튼 찾는 중...');

    // 여러 방법으로 버튼 찾기
    let validateButton = null;

    // 시도 1: 정확한 텍스트
    validateButton = Array.from(document.querySelectorAll('button')).find(
      btn => btn.textContent.trim() === '파일 검증하기'
    );

    // 시도 2: contains
    if (!validateButton) {
      validateButton = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent.includes('파일 검증하기')
      );
    }

    if (!validateButton) {
      return {
        success: false,
        error: '파일 검증 버튼을 찾을 수 없습니다'
      };
    }

    // 버튼이 보이도록 스크롤
    validateButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);

    // 클릭
    validateButton.click();
    console.log('✅ 파일 검증 버튼 클릭 완료');
    console.log('⏳ 파일 검증 중...');

    await sleep(5000); // 검증 시간 대기

    return { success: true };

  } catch (error) {
    console.error('❌ 파일 검증 오류:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 견적서 제출 완료 팝업 대기
 */
async function waitForSubmitPopup() {
  try {
    console.log('⏳ 견적서 제출 완료 팝업 대기 중...');

    // 최대 60초 대기
    const maxWait = 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const popup = Array.from(document.querySelectorAll('h4')).find(
        h4 => h4.textContent.includes('견적서가 제출되었습니다')
      );

      if (popup) {
        console.log('✅ 견적서 제출 완료 팝업 확인!');
        await sleep(2000);
        return true;
      }

      await sleep(1000);
    }

    console.log('⚠️ 완료 팝업을 찾을 수 없습니다 (계속 진행)');
    return true;

  } catch (error) {
    console.log('⚠️ 팝업 확인 오류:', error);
    return true; // 계속 진행
  }
}

/**
 * 팝업 닫기 (페이지 새로고침 없이 DOM에서 제거)
 */
async function closePopups() {
  try {
    console.log('🗑️ 팝업 닫기 시도...');

    // 모든 팝업/모달 요소 찾기
    const popupSelectors = [
      '.rs-modal',
      '.rs-drawer',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '.modal',
      '.popup'
    ];

    let closedCount = 0;

    for (const selector of popupSelectors) {
      const popups = document.querySelectorAll(selector);
      popups.forEach(popup => {
        if (popup && popup.parentNode) {
          popup.remove();
          closedCount++;
          console.log(`   ✅ 팝업 제거: ${selector}`);
        }
      });
    }

    // 백드롭/오버레이 제거
    const backdrops = document.querySelectorAll('.rs-modal-backdrop, .modal-backdrop, [class*="backdrop"]');
    backdrops.forEach(backdrop => {
      if (backdrop && backdrop.parentNode) {
        backdrop.remove();
        closedCount++;
        console.log('   ✅ 백드롭 제거');
      }
    });

    // body에서 overflow hidden 제거
    document.body.style.overflow = '';

    console.log(`✅ 총 ${closedCount}개의 팝업/백드롭 제거됨`);
    await sleep(500);

  } catch (error) {
    console.log('⚠️ 팝업 닫기 오류:', error);
  }
}

/**
 * API를 통해 업로드 상태 폴링 (파일명으로 매칭)
 */
async function pollUploadStatus() {
  try {
    console.log('🔄 검증 상태 확인 시작 (API 폴링)...');
    console.log('📋 업로드된 파일명:', window.uploadedFilenames);
    console.log('⏰ 업로드 시작 시간:', window.uploadStartTime?.toLocaleString());

    const maxWaitTime = 180000; // 3분
    const pollInterval = 3000; // 3초마다
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`🔄 검증 상태 확인 중... (${elapsed}초 경과 / 180초)`);

      // API 호출
      const statusData = await fetchUploadStatus();

      // 실제 API 구조: { uploadStatusDtos: [...] }
      const items = statusData?.uploadStatusDtos || statusData?.content || [];

      if (!items || items.length === 0) {
        console.log('   ⚠️ 상태 데이터를 가져올 수 없습니다');
        await sleep(pollInterval);
        continue;
      }

      console.log(`   📊 ${items.length}개 항목 확인`);

      // 첫 번째 항목 전체 구조 로깅 (디버깅용)
      if (items.length > 0) {
        console.log('   📄 첫 번째 항목 구조:', JSON.stringify(items[0], null, 2));
      }

      // 가장 최근 항목 찾기 (첫 번째가 가장 최근)
      const recentItems = items.slice(0, 5); // 최근 5개 확인

      for (const item of recentItems) {
        try {
          // 파일명 추출
          const itemFilename = item.fileName || '';
          const itemTime = new Date(item.submittedDate || item.timestamp);

          console.log(`   📋 항목: ${itemFilename}`);
          console.log(`   ⏰ 시간: ${itemTime.toLocaleString()}`);
          console.log(`   📊 상태: ${item.validationStatus}`);

          // 파일명 매칭 또는 시간 매칭 (5분 이내)
          let isMatch = false;

          // 1. 파일명으로 매칭 시도
          if (window.uploadedFilenames.length > 0 && itemFilename) {
            for (const uploadedName of window.uploadedFilenames) {
              // .xlsx 확장자 제거하고 비교
              const normalizedUploaded = uploadedName.replace('.xlsx', '').trim();
              const normalizedItem = itemFilename.replace('.xlsx', '').trim();

              if (normalizedItem.includes(normalizedUploaded) || normalizedUploaded.includes(normalizedItem)) {
                console.log(`   ✅ 파일명 매칭: ${uploadedName} ↔ ${itemFilename}`);
                isMatch = true;
                break;
              }
            }
          }

          // 2. 시간으로 매칭 (5분 이내)
          if (!isMatch && window.uploadStartTime) {
            const timeDiff = Math.abs((itemTime - window.uploadStartTime) / 1000 / 60);
            if (timeDiff <= 5) {
              console.log(`   ✅ 시간 매칭: ${timeDiff.toFixed(1)}분 차이`);
              isMatch = true;
            }
          }

          if (isMatch) {
            console.log('   📋 해당 견적서 발견!');

            // 검증 상태 확인
            const status = (item.validationStatus || '').toUpperCase();
            console.log(`   📊 검증 상태: ${status}`);

            // 실패/반려 상태 확인 - REJECTED
            if (status === 'REJECTED' || item.success === false) {
              const result = `총 ${item.count}개 (성공 ${item.passedItemCount}개 / 실패 ${item.failedItemCount}개)`;
              console.log(`❌ 검증 실패: ${result}`);
              return {
                success: false,
                rejected: true,
                quoteId: item.submittedId,
                quotationName: item.fileName,
                downloadUrl: `https://supplier.coupang.com/qvt/quotation/${item.submittedId}/inspection/result/file`,
                error: `견적서가 반려되었습니다. ${result}`
              };
            }

            // 성공 상태 확인 - APPROVED
            if (status === 'APPROVED' || item.success === true) {
              const quoteId = item.submittedId;
              console.log(`✅ 견적서 검증 완료! ID: ${quoteId}`);
              return {
                success: true,
                quoteId: quoteId
              };
            }

            // 진행 중 상태
            if (status.includes('VALIDAT') || status.includes('PENDING') || status.includes('PROGRESS')) {
              console.log(`   ⏳ 검증 진행 중... 상태: ${status}`);
            } else {
              console.log(`   ❓ 알 수 없는 상태: ${status}`);
            }
          }
        } catch (error) {
          console.log('   ⚠️ 항목 처리 오류:', error);
        }
      }

      // 다음 폴링까지 대기
      await sleep(pollInterval);
    }

    // 타임아웃
    console.log('⚠️ 검증 상태 확인 시간 초과 (3분)');
    return {
      success: false,
      error: '검증 상태 확인 시간 초과. 쿠팡 사이트에서 수동으로 확인하세요.'
    };

  } catch (error) {
    console.error('❌ 상태 확인 오류:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * API를 통해 업로드 상태 조회
 */
async function fetchUploadStatus() {
  try {
    const response = await fetch('https://supplier.coupang.com/qvt/quotation/upload/status', {
      method: 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      console.log('⚠️ API 응답 오류:', response.status);
      return null;
    }

    const data = await response.json();
    console.log('✅ API 응답:', data);
    return data;

  } catch (error) {
    console.error('❌ API 호출 오류:', error);
    return null;
  }
}

/**
 * 최신 견적서 상태 가져오기 (짧은 폴링)
 * - 업로드 직후 견적서 ID와 상태를 빠르게 확인
 */
async function getLatestQuotationStatus(maxWaitTime = 30000) {
  try {
    console.log('🔍 최신 견적서 상태 조회 중...');

    const pollInterval = 3000; // 3초마다
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`🔄 견적서 상태 확인 중... (${elapsed}초 / ${maxWaitTime / 1000}초)`);

      // API 호출
      const statusData = await fetchUploadStatus();

      // 실제 API 구조: { uploadStatusDtos: [...] }
      const items = statusData?.uploadStatusDtos || statusData?.content || [];

      if (!items || items.length === 0) {
        console.log('   ⚠️ 상태 데이터 없음');
        await sleep(pollInterval);
        continue;
      }

      // 업로드한 파일명과 일치하는 견적서 찾기
      const uploadedFilenames = window.uploadedFilenames || [];
      console.log('📋 업로드한 파일명:', uploadedFilenames);

      // 파일명이 일치하는 항목 찾기
      let matchedItem = null;
      for (const item of items) {
        const itemFileName = item.fileName || '';
        console.log(`   📄 API 견적서: ${itemFileName}`);

        // 업로드한 파일명 중 하나와 일치하는지 확인
        const isMatch = uploadedFilenames.some(uploadedName => {
          // 정확히 일치하거나, 업로드 파일명이 API 파일명에 포함되어 있는지 확인
          return itemFileName === uploadedName ||
                 itemFileName.includes(uploadedName.replace('.xlsx', '')) ||
                 uploadedName.includes(itemFileName.replace('.xlsx', ''));
        });

        if (isMatch) {
          console.log(`   ✅ 파일명 일치! ${itemFileName}`);
          matchedItem = item;
          break;
        }
      }

      if (!matchedItem) {
        console.log('   ⏳ 업로드한 견적서를 아직 찾지 못함, 대기 중...');
        await sleep(pollInterval);
        continue;
      }

      console.log('📋 일치하는 견적서:', JSON.stringify(matchedItem, null, 2));

      // 성공 여부 판단 (validationStatus 기준)
      const validationStatus = (matchedItem.validationStatus || '').toUpperCase();
      const failedCount = matchedItem.failedItemCount || 0;

      // 성공 조건: APPROVED 상태이고 실패 건수가 0
      // 실패 조건: REJECTED 상태이거나 실패 건수가 1 이상
      let isSuccess = false;
      if (validationStatus === 'APPROVED' && failedCount === 0) {
        isSuccess = true;
      } else if (validationStatus === 'REJECTED' || failedCount > 0) {
        isSuccess = false;
      } else if (validationStatus === 'VALIDATING' || validationStatus === '') {
        // 아직 검증 중 - 대기
        console.log('   ⏳ 아직 검증 중...');
        await sleep(pollInterval);
        continue;
      }

      // 견적서 정보 반환 (실제 API 필드명 사용)
      const itemTime = new Date(matchedItem.submittedDate || matchedItem.uploadedAt || matchedItem.timestamp);
      return {
        id: matchedItem.submittedId || matchedItem.qvtId || matchedItem.id,
        name: matchedItem.fileName,
        status: matchedItem.validationStatus,  // "REJECTED", "APPROVED", "VALIDATING" 등
        success: isSuccess,  // 명확한 성공/실패 판단
        passedCount: matchedItem.passedItemCount,
        failedCount: failedCount,
        result: `총 ${matchedItem.count}개 (성공 ${matchedItem.passedItemCount}개 / 실패 ${failedCount}개)`,
        uploadedAt: itemTime.toISOString(),
        rawData: matchedItem // 디버깅용 원본 데이터
      };
    }

    console.log('⚠️ 견적서 상태 확인 시간 초과');
    return null;

  } catch (error) {
    console.error('❌ 견적서 상태 조회 오류:', error);
    return null;
  }
}

/**
 * 검증 완료까지 대기 (최종 상태 확인)
 * - 반려 또는 완료 상태가 될 때까지 폴링
 */
async function waitForFinalStatus(quotationId, maxWaitTime = 120000) {
  try {
    console.log(`⏳ 검증 완료 대기 중... (최대 ${maxWaitTime / 1000}초)`);

    const pollInterval = 5000; // 5초마다 확인
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`🔄 검증 상태 확인 중... (${elapsed}초 / ${maxWaitTime / 1000}초)`);

      // API 호출
      const statusData = await fetchUploadStatus();

      // 실제 API 구조: { uploadStatusDtos: [...] }
      const items = statusData?.uploadStatusDtos || statusData?.content || [];

      if (!items || items.length === 0) {
        console.log('   ⚠️ 상태 데이터 없음');
        await sleep(pollInterval);
        continue;
      }

      // 해당 견적서 찾기
      const quotation = items.find(item => {
        const itemId = item.submittedId || item.qvtId || item.id;
        return itemId === quotationId;
      });

      if (!quotation) {
        console.log(`   ⚠️ 견적서 ID ${quotationId} 를 찾을 수 없음`);
        await sleep(pollInterval);
        continue;
      }

      const status = (quotation.validationStatus || '').toUpperCase();
      const result = `총 ${quotation.count}개 (성공 ${quotation.passedItemCount}개 / 실패 ${quotation.failedItemCount}개)`;

      console.log(`   📊 현재 상태: "${status}", 결과: "${result}"`);

      // 최종 상태 확인 - REJECTED, APPROVED 등은 최종 상태
      // VALIDATING, PENDING, PROCESSING 등은 진행 중
      const isPending =
        status.includes('VALIDAT') || status.includes('PENDING') ||
        status.includes('PROGRESS') || status.includes('PROCESSING') ||
        status === '';

      if (!isPending) {
        // 최종 상태 도달
        console.log(`✅ 최종 상태 확인: ${status}`);
        return {
          id: quotationId,
          name: quotation.fileName,
          status: quotation.validationStatus,
          success: quotation.success,
          passedCount: quotation.passedItemCount,
          failedCount: quotation.failedItemCount,
          result: result,
          rawData: quotation
        };
      }

      console.log('   ⏳ 아직 검증 중... 계속 대기');
      await sleep(pollInterval);
    }

    // 시간 초과 - 마지막 상태 반환
    console.log('⚠️ 검증 완료 대기 시간 초과');
    return null;

  } catch (error) {
    console.error('❌ 최종 상태 확인 오류:', error);
    return null;
  }
}

/**
 * 견적서 데이터 저장 (localStorage)
 */
function saveQuotationData(quoteId, products, excelFiles) {
  try {
    console.log('💾 견적서 데이터 저장 중...');

    const quotationData = {
      quoteId: quoteId,
      timestamp: new Date().toISOString(),
      skuCount: products.length,
      products: products.map(p => ({
        name: p.title || p.titleCn,
        category: p.category,
        supplyPrice: p.results?.[0]?.supplyPrice || 0,
        sellPrice: p.results?.[0]?.sellPrice || 0,
        options: p.results || []
      })),
      excelFiles: excelFiles
    };

    // localStorage에 저장
    localStorage.setItem(`quotation_${quoteId}`, JSON.stringify(quotationData));

    // 최근 견적서 ID 목록에 추가
    const recentQuotes = JSON.parse(localStorage.getItem('recentQuotations') || '[]');
    recentQuotes.unshift(quoteId);
    localStorage.setItem('recentQuotations', JSON.stringify(recentQuotes.slice(0, 10))); // 최근 10개만 유지

    console.log('✅ 견적서 데이터 저장 완료');
    console.log(`   📊 견적서 ID: ${quoteId}`);
    console.log(`   📊 SKU 수량: ${products.length}개`);

  } catch (error) {
    console.error('❌ 데이터 저장 오류:', error);
  }
}

/**
 * 단순 sleep 함수
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 수동으로 상태 확인 (디버깅용)
 */
window.checkCoupangUploadStatus = async function() {
  const status = await fetchUploadStatus();
  console.log('Current upload status:', status);
  return status;
};
