/**
 * Localhost Content Script
 * Background script와 localhost 페이지 간의 메시지를 중계합니다
 */

console.log('🔌 Localhost Content Script 로드됨');

// Extension ID를 페이지에 알림 (TotalbotExtensionReady 이벤트 발생)
const extensionId = chrome.runtime.id;
console.log('📌 Extension ID:', extensionId);

// localStorage에 저장
localStorage.setItem('totalbotExtensionId', extensionId);

// CustomEvent로 페이지에 알림
window.dispatchEvent(new CustomEvent('TotalbotExtensionReady', {
  detail: { extensionId: extensionId }
}));

console.log('✅ TotalbotExtensionReady 이벤트 발생됨');

// Background script로부터 메시지를 받아 페이지로 전달
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Content script received from background:', message);

  // 필수 칸 입력 요청인 경우 특별 처리
  if (message.action === 'showRequiredFieldModal') {
    console.log('📋 필수 칸 입력 모달 요청:', message.fields);

    const messageId = 'required_' + Date.now();

    // 응답 대기 핸들러
    const responseHandler = (event) => {
      if (event.data && event.data.type === 'REQUIRED_FIELD_RESPONSE' && event.data.messageId === messageId) {
        window.removeEventListener('message', responseHandler);
        console.log('📋 필수 칸 입력 응답:', event.data.result);
        sendResponse(event.data.result);
      }
    };

    window.addEventListener('message', responseHandler);

    // 페이지에 모달 표시 요청
    window.postMessage({
      type: 'SHOW_REQUIRED_FIELD_MODAL',
      messageId: messageId,
      fields: message.fields
    }, '*');

    return true; // 비동기 응답 대기
  }

  // 페이지로 메시지 전달
  window.postMessage({
    source: 'totalbot-extension',
    type: 'TOTALBOT_NOTIFICATION',
    ...message
  }, '*');

  sendResponse({ success: true });
  return true;
});

// 페이지로부터 메시지를 받아 background script로 전달
window.addEventListener('message', (event) => {
  // 같은 origin만 허용
  if (event.origin !== window.location.origin) {
    return;
  }

  const data = event.data;
  if (!data) return;

  // 새로운 형식: TOTALBOT_REQUEST (orders.html 등에서 사용)
  if (data.type === 'TOTALBOT_REQUEST' && data.message) {
    const messageId = data.messageId;
    const message = data.message;

    console.log('📤 TOTALBOT_REQUEST 수신:', message.action, messageId);

    // ping 요청은 바로 응답
    if (message.action === 'ping') {
      console.log('🏓 Ping 요청 처리');
      window.postMessage({
        type: 'TOTALBOT_RESPONSE',
        messageId: messageId,
        response: { pong: true, extensionConnected: true }
      }, '*');
      return;
    }

    // 쿠팡 탭 열기 요청
    if (message.action === 'openCoupangOrderPage') {
      console.log('🔗 쿠팡 발주 페이지 열기 요청');
      chrome.runtime.sendMessage({
        action: 'openTab',
        url: 'https://supplier.coupang.com/scm/purchase/order/list'
      }, (response) => {
        window.postMessage({
          type: 'TOTALBOT_RESPONSE',
          messageId: messageId,
          response: response || { success: true }
        }, '*');
      });
      return;
    }

    // 발주서 다운로드, 목록 조회 등은 쿠팡 탭에서 처리 필요
    if (message.action === 'downloadOrders' || message.action === 'getOrderList') {
      console.log('📋 쿠팡 관련 요청 - 쿠팡 탭으로 전달 필요:', message.action);

      // Background script를 통해 쿠팡 탭에 메시지 전달
      chrome.runtime.sendMessage({
        action: 'sendToCoupangTab',
        targetAction: message.action,
        settings: message.settings
      }, (response) => {
        console.log('✅ 쿠팡 탭 응답:', response);
        window.postMessage({
          type: 'TOTALBOT_RESPONSE',
          messageId: messageId,
          response: response || { success: false, error: '쿠팡 탭 응답 없음' }
        }, '*');
      });
      return;
    }

    // 발주 확정 업로드, 쉽먼트 업로드 등도 쿠팡 탭에서 처리
    if (message.action === 'uploadOrderConfirmation' || message.action === 'uploadShipment') {
      console.log('📤 쿠팡 업로드 요청 - 쿠팡 탭으로 전달:', message.action);

      chrome.runtime.sendMessage({
        action: 'sendToCoupangTab',
        targetAction: message.action,
        orderData: message.orderData,
        shipmentData: message.shipmentData
      }, (response) => {
        console.log('✅ 쿠팡 업로드 응답:', response);
        window.postMessage({
          type: 'TOTALBOT_RESPONSE',
          messageId: messageId,
          response: response || { success: false, error: '쿠팡 탭 응답 없음' }
        }, '*');
      });
      return;
    }

    // 쿠팡 가격 수집 요청
    if (message.action === 'collectCoupangPrices') {
      console.log('💰 쿠팡 가격 수집 요청:', message.keyword);

      chrome.runtime.sendMessage({
        action: 'collectCoupangPrices',
        keyword: message.keyword,
        options: message.options || {}
      }, (response) => {
        console.log('✅ 가격 수집 응답:', response);
        window.postMessage({
          type: 'TOTALBOT_RESPONSE',
          messageId: messageId,
          response: response || { success: false, error: '가격 수집 실패' }
        }, '*');
      });
      return;
    }

    // 기타 요청은 Background로 전달
    chrome.runtime.sendMessage(message, (response) => {
      console.log('✅ Background 응답:', response);
      window.postMessage({
        type: 'TOTALBOT_RESPONSE',
        messageId: messageId,
        response: response || { success: false, error: '응답 없음' }
      }, '*');
    });
    return;
  }

  // 기존 형식: source === 'totalbot-page'
  if (data.source === 'totalbot-page') {
    console.log('📤 Page message (legacy format):', data);

    // Background script로 전달
    chrome.runtime.sendMessage(data, (response) => {
      console.log('✅ Extension response:', response);

      // 응답을 페이지로 다시 전달
      window.postMessage({
        source: 'totalbot-extension-response',
        originalAction: data.action,
        response: response
      }, '*');
    });
  }
});

console.log('✅ Localhost Content Script 초기화 완료');
