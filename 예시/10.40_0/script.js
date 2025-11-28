async function fetchAdDataInScript(t,a,o){try{var n=[],s=1,r=!0,i=null;for(console.log("script.js에서 광고 데이터 수집 시작");r;){console.log(`광고 데이터 수집 중... ${s}페이지`);let e;var d=await(e=1===s?await fetch("https://advertising.coupang.com/marketing-reporting/v2/graphql",{headers:{accept:"*/*","accept-language":"ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7","content-type":"application/json",priority:"u=1, i","sec-ch-ua":'"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',"sec-ch-ua-mobile":"?0","sec-ch-ua-platform":'"Windows"',"sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin"},referrer:"https://advertising.coupang.com/marketing-reporting/billboard/custom-report",body:JSON.stringify([{variables:{columns:["price_type","vendor_type","campaign_name","campaign_start_datetime","campaign_end_datetime","goal_type","bid_type","ad_group_name","ad_name","placement","advertised_vendor_item_id","advertised_vendor_item_name","vendor_item_id","vendor_item_name","impressions_count","clicks_count","ctr","ad_cost_sum","billable_event_count","video_watch_3s_count","cost_per_video_watch_3s_count","avg_watch_time","video_first_quartile","video_midpoint","video_third_quartile","video_complete","total_order_24_hours","direct_order_24_hours","halo_order_24_hours","total_sale_24_hours","direct_sale_24_hours","halo_sale_24_hours","total_roas_24_hours","direct_roas_24_hours","halo_roas_24_hours","total_unit_24_hours","direct_unit_24_hours","halo_unit_24_hours","total_order_14_days","direct_order_14_days","halo_order_14_days","total_sale_14_days","direct_sale_14_days","halo_sale_14_days","total_roas_14_days","direct_roas_14_days","halo_roas_14_days","total_unit_14_days","direct_unit_14_days","halo_unit_14_days","ltv_gmv","ltv_roas","ad_type","objective"],page:s,pageSize:500,reportType:"product_conversion",templateId:null,lang:"KO",campaigns:t,startDate:a,endDate:o},query:`fragment customReport on CustomReport {
                            id
                            reportColumns: columns
                            totalCount
                            rows: items {
                                ad_cost_sum
                                ad_group_name
                                ad_name
                                advertised_vendor_item_id
                                advertised_vendor_item_name
                                bpa_ad_type
                                campaign_end_datetime
                                campaign_name
                                campaign_start_datetime
                                category
                                clicks_count
                                cost_per_new_to_brand_customer_12mo
                                cost_per_reach
                                cost_per_video_watch_3s_count
                                creative_id
                                ctr
                                direct_order_14_days
                                direct_order_24_hours
                                direct_roas_14_days
                                direct_roas_24_hours
                                direct_sale_14_days
                                direct_sale_24_hours
                                direct_unit_14_days
                                direct_unit_24_hours
                                dt
                                frequency
                                halo_order_14_days
                                halo_order_24_hours
                                halo_roas_14_days
                                halo_roas_24_hours
                                halo_sale_14_days
                                halo_sale_24_hours
                                halo_unit_14_days
                                halo_unit_24_hours
                                impressions_count
                                keyword
                                landing_page_id
                                landing_page_name
                                landing_page_type
                                match_type
                                new_to_brand_sales_12mo
                                new_to_brand_sales_rate_12mo
                                new_to_brand_users_12mo
                                new_to_brand_users_rate_12mo
                                bid_type
                                original_keywords
                                price_type
                                reach
                                reach_new_customer
                                reach_old_customer
                                total_order_14_days
                                total_order_24_hours
                                total_roas_14_days
                                total_roas_24_hours
                                total_sale_14_days
                                total_sale_24_hours
                                total_unit_14_days
                                total_unit_24_hours
                                vendor_item_id
                                vendor_item_name
                                vendor_type
                                video_watch_3s_count
                                goal_type
                                placement
                                billable_event_count
                                avg_watch_time
                                video_first_quartile
                                video_midpoint
                                video_third_quartile
                                video_complete
                                ltv_gmv
                                ltv_roas
                                ad_type
                                objective
                                __typename
                            }
                            __typename
                        }

                        query ($startDate: String!, $endDate: String!, $campaigns: [CustomReportCampaignsInput!]!, $reportType: CustomReportType!, $columns: [CustomColumn!]!, $templateId: ID, $page: Int, $pageSize: Int) {
                            report: generateCustomReport(
                                params: {startDate: $startDate, endDate: $endDate, campaigns: $campaigns, reportType: $reportType, templateId: $templateId, columns: $columns, page: $page, pageSize: $pageSize}
                            ) {
                                ...customReport
                                __typename
                            }
                        }`}]),method:"POST",mode:"cors",credentials:"include"}):await fetch("https://advertising.coupang.com/marketing-reporting/v2/graphql",{headers:{accept:"*/*","accept-language":"ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7","content-type":"application/json",priority:"u=1, i","sec-ch-ua":'"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',"sec-ch-ua-mobile":"?0","sec-ch-ua-platform":'"Windows"',"sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin"},referrer:"https://advertising.coupang.com/marketing-reporting/billboard/custom-report",body:JSON.stringify([{variables:{reportId:i,page:s,pageSize:500,lang:"KO"},query:`fragment customReport on CustomReport {
                            id
                            reportColumns: columns
                            totalCount
                            rows: items {
                                ad_cost_sum
                                ad_group_name
                                ad_name
                                advertised_vendor_item_id
                                advertised_vendor_item_name
                                bpa_ad_type
                                campaign_end_datetime
                                campaign_name
                                campaign_start_datetime
                                category
                                clicks_count
                                cost_per_new_to_brand_customer_12mo
                                cost_per_reach
                                cost_per_video_watch_3s_count
                                creative_id
                                ctr
                                direct_order_14_days
                                direct_order_24_hours
                                direct_roas_14_days
                                direct_roas_24_hours
                                direct_sale_14_days
                                direct_sale_24_hours
                                direct_unit_14_days
                                direct_unit_24_hours
                                dt
                                frequency
                                halo_order_14_days
                                halo_order_24_hours
                                halo_roas_14_days
                                halo_roas_24_hours
                                halo_sale_14_days
                                halo_sale_24_hours
                                halo_unit_14_days
                                halo_unit_24_hours
                                impressions_count
                                keyword
                                landing_page_id
                                landing_page_name
                                landing_page_type
                                match_type
                                new_to_brand_sales_12mo
                                new_to_brand_sales_rate_12mo
                                new_to_brand_users_12mo
                                new_to_brand_users_rate_12mo
                                bid_type
                                original_keywords
                                price_type
                                reach
                                reach_new_customer
                                reach_old_customer
                                total_order_14_days
                                total_order_24_hours
                                total_roas_14_days
                                total_roas_24_hours
                                total_sale_14_days
                                total_sale_24_hours
                                total_unit_14_days
                                total_unit_24_hours
                                vendor_item_id
                                vendor_item_name
                                vendor_type
                                video_watch_3s_count
                                goal_type
                                placement
                                billable_event_count
                                avg_watch_time
                                video_first_quartile
                                video_midpoint
                                video_third_quartile
                                video_complete
                                ltv_gmv
                                ltv_roas
                                ad_type
                                objective
                                __typename
                            }
                            __typename
                        }

                        query ($reportId: ID!, $page: Int, $pageSize: Int, $lang: ExportLanguage!) {
                            report: customReportWithPaging(
                                params: {reportId: $reportId, page: $page, pageSize: $pageSize, lang: $lang}
                            ) {
                                ...customReport
                                __typename
                            }
                        }`}]),method:"POST",mode:"cors",credentials:"include"})).json(),c=(console.log(`페이지 ${s} 광고 성과 데이터 조회 결과:`,d),1===s&&(i=d[0]?.data?.report?.id,console.log("리포트 ID: "+i)),d[0]?.data?.report?.rows||[]),n=n.concat(c);console.log(`페이지 ${s}: ${c.length}개 데이터 수집`),c.length<500?r=!1:s++}return console.log(`총 ${n.length}개의 광고 데이터 수집 완료`),n}catch(e){throw console.error("script.js 광고 데이터 수집 오류:",e),e}}async function getProductTrafficDetail(e,t,a){console.log("script.js - getProductTrafficDetail 호출:",e,t,a);var o=document.cookie.split("; ").find(e=>e.includes("XSRF-TOKEN"))?.split("=")[1];try{var n=await(await fetch("https://wing.coupang.com/tenants/rfm-ss/api/business-insight/vi-detail-search",{headers:{accept:"application/json, text/plain, */*","accept-language":"ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7","content-type":"application/json",priority:"u=1, i","sec-ch-ua":'"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',"sec-ch-ua-mobile":"?0","sec-ch-ua-platform":'"Windows"',"sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin",withcredentials:"true","x-xsrf-token":o},referrer:"https://wing.coupang.com/tenants/business-insight/sales-analysis?startDate="+e+"&endDate="+t,referrerPolicy:"strict-origin-when-cross-origin",body:'{"startDate":"'+e+'","endDate":"'+t+'","registrationTypes":["RFM"],"pageNumber":'+a+',"pageSize":100,"sortBy":"GMV","sortOrder":"DESC","vendorItemIds":[],"productName":"","includeSoldVICount":true}',method:"POST",mode:"cors",credentials:"include"})).text(),s=(console.log("API 응답:",n),JSON.parse(n));return console.log("파싱된 결과:",s),s}catch(e){return console.error("getProductTrafficDetail 오류:",e),null}}async function getProductSales(e,t,a){e=parseInt(e);var o=document.cookie.split("; ").find(e=>e.includes("XSRF-TOKEN"))?.split("=")[1];console.log("script.js - getProductSales 호출:",e,t,a);try{var n=await(await fetch("https://wing.coupang.com/tenants/rfm-ss/api/business-insight/vendor-item-summary",{headers:{accept:"application/json, text/plain, */*","accept-language":"ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7","content-type":"application/json",priority:"u=1, i","sec-ch-ua":'"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',"sec-ch-ua-mobile":"?0","sec-ch-ua-platform":'"Windows"',"sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin",withcredentials:"true","x-xsrf-token":o},referrer:"https://wing.coupang.com/",referrerPolicy:"strict-origin-when-cross-origin",body:'{"startDate":"'+t+'","endDate":"'+a+'","vendorItemId":'+e+"}",method:"POST",mode:"cors",credentials:"include"})).json();return console.log("getProductSales 결과:",n),n.saleSummaryByDate?n:null}catch(e){return console.error("getProductSales 오류:",e),null}}async function handleAIResponse(e){var t=document.getElementById("ai-response-field"),t=(t&&(t.value=e.aiReply),document.getElementById("request-ai-btn"));t&&(t.disabled=!1,t.textContent="AI 응답 요청"),UIManager.addMessage("판매자",e.originalMessage),UIManager.addMessage("AI 응답",e.aiReply),await ConversationManager.addMessage("seller",e.originalMessage),await ConversationManager.addMessage("ai",e.aiReply)}async function handleAIError(e){UIManager.addMessage("시스템","오류가 발생했습니다: "+e.error,"error");e=document.getElementById("request-ai-btn");e&&(e.disabled=!1,e.textContent="AI 응답 요청")}console.log("script.js connected"),chrome.runtime.onMessage.addListener(function(e,t,a){var o,n;return console.log(e),"login"==e.result&&window.postMessage({res:"login"},"*"),e.result&&(console.log(e.result),window.postMessage({res:"importpurchaseinfo",result:e.result},"*")),"keywordanalysisstatus"==e.response&&window.postMessage({res:"keywordanalysisstatus",status:e.status},"*"),"keywordanalysisstatusratio"==e.response&&window.postMessage({res:"keywordanalysisstatusratio",status:e.status,text:e.text},"*"),"datalabKeywordStatus"==e.response&&window.postMessage({res:"datalabKeywordStatus",status:e.status,text:e.text},"*"),"addRankSuccess"==e.response&&window.postMessage({res:"addRankSuccess"},"*"),"collectRankResult"==e.response&&window.postMessage({res:"collectRankResult",result:e.result},"*"),"collectKeyword"==e.response&&window.postMessage({res:"collectKeyword",keywords:e.keywords},"*"),"keywordanalysis"==e.response&&window.postMessage({res:"keywordanalysis",coupang:e.coupang,naver:e.naver,cpc:e.cpc},"*"),"storeparsing"==e.response&&window.postMessage({res:"storeparsing",storeparsing:e.storeparsing},"*"),"relatedkeywords"==e.response&&window.postMessage({res:"relatedkeywords",relatedkeywords:e.relatedkeywords},"*"),"totalrelatedkeywords"==e.response&&window.postMessage({res:"totalrelatedkeywords",relatedkeywords:e.relatedkeywords},"*"),"addrelkeywords"==e.response&&window.postMessage({res:"addrelkeywords",relatedkeywords:e.relatedkeywords},"*"),"relkeywordsrate"==e.response&&window.postMessage({res:"relkeywordsrate",n:e.n,rate:e.rate},"*"),"fetchAdData"===e.action?(fetchAdDataInScript(e.campaigns,e.startDate,e.endDate).then(e=>{a({success:!0,data:e})}).catch(e=>{console.error("광고 데이터 수집 오류:",e),a({success:!1,error:e.message})}),!0):("tracking"==e.msg&&window.postMessage({res:"tracking",cnt:e.cnt,msg:e.res},"*"),"growthDb"==e.msg&&window.postMessage({msg:e.msg,res:e.res,growthdb:e.growthdb,suppliercode:e.suppliercode,sizeInfo:e.sizeInfo,companyid:e.companyid,stockInfo:e.stockInfo,NoBadgeInfo:e.NoBadgeInfo,coupons:e.coupons},"*"),"growthSales"==e.msg&&window.postMessage({msg:e.msg,res:e.res,suppliercode:e.suppliercode,companyid:e.companyid,stockInfo:e.stockInfo},"*"),"getCommission"==e.msg&&window.postMessage({msg:e.msg,res:e.res,suppliercode:e.suppliercode,commission:e.commission},"*"),"growthDbRatio"==e.msg&&window.postMessage({res:"growthdbratio",ratio:e.ratio,text:e.text},"*"),"trackingratio"==e.msg&&window.postMessage({res:"trackingratio",ratio:e.ratio},"*"),"coupangLoginTest"==e.response&&window.postMessage({res:"coupangLoginTest",result:e.result,msg:e.msg},"*"),"changeHTML"===e.action&&makepage((o=e.data).total,o.data,o.product_num,o.product_name,o.option1_kr),"changeHTML2"===e.action&&makepage2((o=e.data).total,o.data,o.product_num,o.product_name,o.option1_kr),"resImportShipment"==e.msg&&window.postMessage({msg:e.msg,res:e.res,shipment:e.shipment,suppliercode:e.suppliercode},"*"),"alert"==e.response&&window.postMessage({res:"alert",alert:e.alert},"*"),"autoCollectStatus"===e.type&&window.postMessage({type:"autoCollectStatus",message:e.message},"*"),"ANALYZE_PROGRESS"==e.response&&window.postMessage({type:"ANALYZE_PROGRESS",payload:e.payload},"*"),"ANALYZE_DONE"==e.response&&window.postMessage({type:"ANALYZE_DONE",result:e.result},"*"),"ANALYZE_LAYOUT_PROGRESS"==e.response&&window.postMessage({type:"ANALYZE_LAYOUT_PROGRESS",payload:e.payload},"*"),"ANALYZE_LAYOUT_DONE"==e.response&&window.postMessage({type:"ANALYZE_LAYOUT_DONE",result:e.result},"*"),"openSidePanel"===e.action&&(console.log("Opening side panel with data:",e.negotiationData),initializeSidePanel(e.negotiationData)),"aiResponseReady"===e.action&&(console.log("AI Response ready:",e),NegotiationManager.handleAIResponse(e.aiReply).catch(e=>{console.error("AI Response handling error:",e),UIManager.addMessage("시스템","에러 발생: "+e.message,"error")})),"aiError"===e.action&&handleAIError(e),e.data&&"AiRocketRegResult"===e.data.type&&window.postMessage({type:"AiRocketRegResult",...e.data},"*"),e.data&&"detailHtmlGenerated"===e.action&&window.postMessage({type:"AiRocketRegResult",id:e.data.id,workType:"DETAIL_HTML_GENERATE",productId:e.data.productId,result:e.data.result},"*"),e.data&&"getAttributeInfoResult"===e.data.type&&window.postMessage({type:"getAttributeInfoResult",...e.data},"*"),e.data&&"AI_TRANSLATE_RESPONSE"===e.data.type&&(console.log("[DEBUG] script.js - AI 번역 응답:",e.data),o=e.data.data||{},console.log("[DEBUG] script.js - 응답 데이터 내용:",o),n=e.data.success||!1,console.log("[DEBUG] script.js - 응답 성공 여부:",n),window.postMessage({type:"AI_TRANSLATE_RESPONSE",id:e.data.id||"unknown",requestId:e.data.requestId||"unknown",success:n,data:o},"*")),e.data&&"AiRocketRegProgress"===e.data.type&&window.postMessage({type:"AiRocketRegProgress",text:e.data.text},"*"),e.data&&"PRODUCT_INFO_RESPONSE"===e.data.type&&(console.log("script.js: PRODUCT_INFO_RESPONSE 전달 - request.data:",e.data),console.log(`script.js: 전달할 ID: ${e.data.id||"없음"}, 옵션 인덱스: `+(void 0!==e.data.data?.optionIndex?e.data.data.optionIndex:"없음")),window.postMessage({type:"PRODUCT_INFO_RESPONSE",...e.data},"*")),e.data&&"UPDATE_ROCKET_REG_RESPONSE"===e.data.type&&window.postMessage({type:"UPDATE_ROCKET_REG_RESPONSE",...e.data},"*"),e.data&&"DELETE_ROCKET_REG_RESPONSE"===e.data.type&&window.postMessage({type:"DELETE_ROCKET_REG_RESPONSE",...e.data},"*"),e.data&&"UPDATE_DOC_ID"===e.data.type&&window.postMessage({type:"UPDATE_DOC_ID",originalDocId:e.data.originalDocId,newDocId:e.data.newDocId},"*"),"CoupangRegAlert"===e.msg&&window.postMessage({...e},"*"),e.data&&"GET_CATEGORY_INFO_RESPONSE"==e.data.type&&window.postMessage({type:"GET_CATEGORY_INFO_RESPONSE",...e.data},"*"),e.data&&"SEARCH_CATEGORIES_RESPONSE"===e.data.type&&window.postMessage({type:"SEARCH_CATEGORIES_RESPONSE",results:e.data.results},"*"),e.data&&"AiRocketRegResult"===e.data.type&&"SIZE_CHART"===e.data.workType&&window.postMessage({type:"AiRocketRegResult",id:e.data.id,productId:e.data.productId,workType:"SIZE_CHART",result:e.data.result},"*"),e.data&&"AiRocketRegError"===e.data.type&&"SIZE_CHART"===e.data.workType&&window.postMessage({type:"AiRocketRegError",id:e.data.id,workType:"SIZE_CHART",message:e.data.message},"*"),"adkeywords"==e.response&&window.postMessage({res:"adkeywords",id:e.id,relatedkeywords:e.relatedkeywords},"*"),"getProductTrafficDetail"===e.action?(getProductTrafficDetail(e.startDate,e.endDate,e.page).then(e=>{a(e)}).catch(e=>{console.error("getProductTrafficDetail 오류:",e),a(null)}),!0):"getProductSales"===e.action?(getProductSales(e.vendorItemId,e.startDate,e.endDate).then(e=>{a(e)}).catch(e=>{console.error("getProductSales 오류:",e),a(null)}),!0):("getCategoryAnalysis"==e.msg&&window.postMessage({res:e.msg,msg:e.msg,categories:e.categories},"*"),"getCategoryStats"==e.msg&&window.postMessage({res:e.msg,msg:e.msg,categoryStats:e.categoryStats},"*"),void("settlementData"==e.msg&&window.postMessage({res:"settlementData",msg:e.msg,settlementData:e.settlementData,adData:e.adData},"*"))))}),window.addEventListener("message",e=>{console.log(e.data),e.data.greeting&&"AiRocketTranslateRequest"===e.data.greeting&&chrome.runtime.sendMessage({type:"AI_TRANSLATE_REQUEST",data:{id:e.data.id,apiKey:e.data.apiKey,imgUrl:e.data.data.imgUrl,chArr:e.data.data.chArr,prompt:e.data.data.prompt}}),e.data.greeting&&"importproductinfo"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getproductinfo",url:e.data.url}),e.data.greeting&&"coupangrank"===e.data.greeting&&chrome.runtime.sendMessage({joke:"coupangrank",link:e.data.link,keywords:e.data.keywords,companyid:e.data.companyid}),e.data.greeting&&"collecttracking"===e.data.greeting&&chrome.runtime.sendMessage({joke:"collecttr",companyid:e.data.companyid}),e.data.greeting&&"collectRank"===e.data.greeting&&chrome.runtime.sendMessage({joke:"collectRank",companyid:e.data.companyid,rankArr:e.data.rankArr,delayTime:e.data.delayTime}),e.data.greeting&&"collectGrowthDb"===e.data.greeting&&chrome.runtime.sendMessage({joke:"collectGrowthDb",companyid:e.data.companyid,suppliercode:e.data.suppliercode,detailSize:e.data.detailSize,growthdb:e.data.growthdb,updatedb:e.data.updatedb,allowedVendorNames:e.data.allowedVendorNames}),e.data.greeting&&"collectGrowthSales"===e.data.greeting&&chrome.runtime.sendMessage({joke:"collectGrowthSales",companyid:e.data.companyid,suppliercode:e.data.suppliercode,growthSales:e.data.growthSales,startDate:e.data.startDate,endDate:e.data.endDate}),e.data.greeting&&"collectSettlementData"===e.data.greeting&&chrome.runtime.sendMessage({joke:"collectSettlementData",companyid:e.data.companyid,suppliercode:e.data.suppliercode,dateRange:e.data.dateRange}),e.data.greeting&&"collectKeyword"===e.data.greeting&&chrome.runtime.sendMessage({joke:"collectKeyword",startRank:e.data.startRank,endRank:e.data.endRank}),e.data.greeting&&"keywordanalysis"===e.data.greeting&&chrome.runtime.sendMessage({joke:"keywordanalysis",data:e.data.data,auth:e.data.auth,ad:e.data.ad}),e.data.greeting&&"getrelatedkeywords"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getrelatedkeywords",data:e.data.data}),e.data.greeting&&"gettotalrelatedkeywords"===e.data.greeting&&chrome.runtime.sendMessage({joke:"gettotalrelatedkeywords",data:e.data.data}),e.data.greeting&&"addrelatedkeywords"===e.data.greeting&&chrome.runtime.sendMessage({joke:"addrelatedkeywords",data:e.data.data,opt:e.data.opt}),e.data.greeting&&"storeparsing"===e.data.greeting&&chrome.runtime.sendMessage({joke:"storeparsing",data:e.data.data,auth:e.data.auth}),e.data.greeting&&"makepage"===e.data.greeting&&chrome.runtime.sendMessage({joke:"makepage",data:e.data.reg}),e.data.greeting&&"makepage2"===e.data.greeting&&chrome.runtime.sendMessage({joke:"makepage2",data:e.data.reg}),e.data.greeting&&"importShipment"===e.data.greeting&&chrome.runtime.sendMessage({joke:"importShipment",suppliercode:e.data.suppliercode}),e.data.greeting&&"getMargin"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getMargin",info:e.data.info}),e.data.greeting&&"getCommission"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getCommission",companyid:e.data.companyid,suppliercode:e.data.suppliercode,info:e.data.info}),e.data.greeting&&"getKeywordCategory"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getKeywordCategory",keyword:e.data.keyword}),e.data.greeting&&"coupangLoginTest"===e.data.greeting&&chrome.runtime.sendMessage({joke:"coupangLoginTest",id:e.data.id,pw:e.data.pw,supplierCode:e.data.supplierCode}),"autoCollectToggle"===e.data.greeting&&chrome.runtime.sendMessage({type:"autoCollectToggle",data:{enabled:e.data.enabled,settings:e.data.settings}}),e.data.type&&"REQUEST_ANALYZE_KEYWORD"===e.data.type&&chrome.runtime.sendMessage({joke:"REQUEST_ANALYZE_KEYWORD",keyword:e.data.keyword,apiKey:e.data.apiKey,productInfo:e.data.productInfo}),e.data.type&&"REQUEST_LAYOUT"===e.data.type&&chrome.runtime.sendMessage({joke:"REQUEST_LAYOUT",payload:e.data.payload,apiKey:e.data.apiKey,productInfo:e.data.productInfo,labeledImages:e.data.labeledImages}),e.data.greeting&&"startCollectNow"===e.data.greeting&&chrome.runtime.sendMessage({type:"startCollectNow",id:e.data.settings.id,pw:e.data.settings.pw,items:e.data.settings.items}),e.data.greeting&&"startKeywordSeoAnalysis"===e.data.greeting&&chrome.runtime.sendMessage({type:"startKeywordSeoAnalysis",keyword:e.data.keyword,pageRange:e.data.pageRange,existingVendorItemIds:e.data.existingVendorItemIds||[]}),e.data.greeting&&"getProductTrafficKeywords"===e.data.greeting&&chrome.runtime.sendMessage({type:"getProductTrafficKeywords",productLink:e.data.productLink,days:e.data.days||30,limit:e.data.limit||10}),(e.data.greeting&&"searchKeywordProducts"===e.data.greeting||e.data.type&&"searchKeywordProducts"===e.data.type)&&chrome.runtime.sendMessage({type:"searchKeywordProducts",keyword:e.data.keyword,myVendorItemId:e.data.myVendorItemId,range:e.data.range||5}),e.data.greeting&&"getProductDetail"===e.data.greeting&&chrome.runtime.sendMessage({type:"getProductDetail",vendorItemId:e.data.vendorItemId}),e.data.greeting&&"getProductTrafficInfo"===e.data.greeting&&chrome.runtime.sendMessage({type:"getProductTrafficInfo",itemId:e.data.itemId,leafCategoryCode:e.data.leafCategoryCode}),e.data.greeting&&"collectTop3ProductReviews"===e.data.greeting&&chrome.runtime.sendMessage({type:"COLLECT_TOP3_REVIEWS",topProducts:e.data.topProducts}),e.data.greeting&&"AiRocketRegRequest"===e.data.greeting&&chrome.runtime.sendMessage({type:"AiRocketRegRequest",data:e.data}),e.data.greeting&&"GET_ATTRIBUTE_INFO"===e.data.greeting&&chrome.runtime.sendMessage({type:"GET_ATTRIBUTE_INFO",data:e.data}),e.data&&"GET_PRODUCT_INFO"===e.data.type&&chrome.runtime.sendMessage({action:"GET_PRODUCT_INFO",requestId:e.data.id,data:e.data.data}),e.data&&"GET_CATEGORY_INFO"===e.data.type&&(console.log("GET_CATEGORY_INFO"),chrome.runtime.sendMessage({action:"GET_CATEGORY_INFO",data:e.data.data})),e.data&&"SEARCH_CATEGORIES"===e.data.type&&chrome.runtime.sendMessage({action:"SEARCH_CATEGORIES",data:e.data.data}),e.data&&"DELETE_ROCKET_REG_DOC"===e.data.type&&chrome.runtime.sendMessage({action:"DELETE_ROCKET_REG_DOC",requestId:e.data.id,data:e.data.data}),e.data&&"VERIFY_ROCKET_REG_DOC"===e.data.type&&chrome.runtime.sendMessage({action:"VERIFY_ROCKET_REG_DOC",requestId:e.data.id,data:e.data.data}),e.data.greeting&&"AiRocketRegDetailRequest"===e.data.greeting&&chrome.runtime.sendMessage({type:"AiRocketRegDetailRequest",data:e.data}),"AiRocketSizeChartRequest"===e.data.greeting&&chrome.runtime.sendMessage({type:"SIZE_CHART_EXTRACTION",data:{id:e.data.id,productId:e.data.productId,apiKey:e.data.apiKey,images:e.data.requestArr?e.data.requestArr.flatMap(e=>e.images||[]):[],productInfo:e.data.productInfo||{}}}),e.data.greeting&&"getadkeyword"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getadkeyword",id:e.data.id,data:e.data.data,cnt:e.data.cnt,relKeywordChecked:e.data.relKeywordChecked,autoCompleteChecked:e.data.autoCompleteChecked}),e.data.greeting&&"getCategoryAnalysis"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getCategoryAnalysis",companyid:e.data.companyid,suppliercode:e.data.suppliercode,info:e.data.info}),e.data.greeting&&"getCategoryStats"===e.data.greeting&&chrome.runtime.sendMessage({joke:"getCategoryStats",categoryCode:e.data.categoryCode,categoryName:e.data.categoryName})},!1);const NEGOTIATION_STATUS={READY:"ready",IN_PROGRESS:"in_progress",PAUSED:"paused",COMPLETED:"completed",ERROR:"error"},StateManager={state:{status:NEGOTIATION_STATUS.READY,isPaused:!1,currentSession:null,error:null,negotiationStyle:{tone:"professional",language:"formal",priority:"price"}},getState(){return this.state},async updateState(e){return this.state={...this.state,...e},console.log("State updated:",this.state),this.state},async clearState(){return this.state={status:NEGOTIATION_STATUS.READY,isPaused:!1,currentSession:null,error:null,negotiationStyle:{tone:"professional",language:"formal",priority:"price"}},this.state}},Logger={levels:{DEBUG:0,INFO:1,WARN:2,ERROR:3},currentLevel:0,log(e,t,a=null){e>=this.currentLevel&&(e=`[${(new Date).toISOString()}] [${Object.keys(this.levels)[e]}]`,a?console.log(e+" "+t,a):console.log(e+" "+t))},debug(e,t=null){this.log(this.levels.DEBUG,e,t)},info(e,t=null){this.log(this.levels.INFO,e,t)},warn(e,t=null){this.log(this.levels.WARN,e,t)},error(e,t=null){this.log(this.levels.ERROR,e,t)}},ConversationManager={async getConversation(){return new Promise(t=>{chrome.storage.local.get("couplusNegotiation",e=>{t(e.couplusNegotiation||{conversationHistory:[],geminiApiKey:"",geminiModel:"gemini-2.0-flash",context:{}})})})},async setConversation(t){return new Promise(e=>{chrome.storage.local.set({couplusNegotiation:t},()=>{e(t)})})},async updateConversation(e){e={...await this.getConversation(),...e};return this.setConversation(e)},async addMessage(e,t){var a=await this.getConversation(),e={role:e,content:t,timestamp:(new Date).toISOString()},t={...a,conversationHistory:[...a.conversationHistory||[],e]};return this.setConversation(t)},async clearConversation(){return this.setConversation({conversationHistory:[],geminiApiKey:"",geminiModel:"gemini-2.0-flash",context:{}})}},UIManager={elements:{panel:null,header:null,chatArea:null,spinner:null,headerTitle:null},showNegotiationDirectionInput(){const t=document.createElement("div"),a=(t.id="negotiation-direction-input",t.style.cssText=`
            padding: 8px;
            background: #e3f2fd;
            border-radius: 4px;
            margin: 8px;
        `,document.createElement("textarea"));a.placeholder="새로운 협상 방향을 입력해주세요.\n예: 가격을 더 낮추려고 시도해주세요.\n예: 배송 기간을 더 짧게 해달라고 요청해주세요.",a.style.cssText=`
            width: 100%;
            height: 80px;
            margin: 8px 0;
            padding: 8px;
            border: 1px solid #ccc;
            border-radius: 4px;
            resize: none;
        `;var e=document.createElement("button");e.textContent="적용",e.style.cssText=`
            padding: 6px 12px;
            background: #1565c0;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `,e.onclick=async()=>{var e=a.value.trim();e&&(await NegotiationManager.updateNegotiationDirection(e),t.remove(),NegotiationManager.togglePause())},t.appendChild(a),t.appendChild(e),this.elements.chatArea.appendChild(t),this.elements.chatArea.scrollTop=this.elements.chatArea.scrollHeight},createErrorRetryMessage(e,t){const a=document.createElement("div");a.style.cssText=`
            margin: 10px;
            padding: 12px;
            background-color: #ffebee;
            border: 1px solid #ffcdd2;
            border-radius: 4px;
        `;var o=document.createElement("div"),e=(o.style.marginBottom="10px",o.innerHTML=`
            <strong>오류가 발생했습니다</strong><br>
            ${e.message}
        `,document.createElement("button")),t=(e.textContent="다시 시도",e.style.cssText=`
            padding: 6px 12px;
            background-color: #1565c0;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 8px;
        `,e.onclick=t,document.createElement("button"));t.textContent="취소",t.style.cssText=`
            padding: 6px 12px;
            background-color: #757575;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `,t.onclick=()=>a.remove(),a.appendChild(o),a.appendChild(e),a.appendChild(t),this.elements.chatArea.appendChild(a),this.elements.chatArea.scrollTop=this.elements.chatArea.scrollHeight},createPanel(){var e=document.createElement("div");return e.id="couplus-side-panel",e.style.cssText=`
            position: fixed;
            top: 0;
            right: 0;
            width: 300px;
            height: 100%;
            background: #fff;
            z-index: 999999;
            border-left: 1px solid #ccc;
            display: flex;
            flex-direction: column;
        `,this.elements.panel=e},createHeader(){var e=document.createElement("div"),t=(e.style.cssText=`
            background: #1565c0;
            color: #fff;
            padding: 8px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `,document.createElement("span")),a=(t.textContent="AI 협상 중...",this.elements.headerTitle=t,document.createElement("span")),o=(a.innerHTML="⏳",a.style.marginLeft="8px",this.elements.spinner=a,this.createCloseButton());return e.appendChild(t),e.appendChild(a),e.appendChild(o),this.elements.header=e},createCloseButton(){var e=document.createElement("button");return e.innerText="X",e.style.cssText=`
            background: transparent;
            color: #fff;
            border: none;
            cursor: pointer;
        `,e.onclick=()=>this.closePanel(),e},createChatArea(){var e=document.createElement("div");return e.id="couplus-chat-area",e.style.cssText=`
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            font-size: 14px;
        `,this.elements.chatArea=e},createInputArea(){var e=document.createElement("div");return e.style.cssText=`
            padding: 8px;
            border-top: 1px solid #eee;
            display: flex;
            flex-direction: column;
            gap: 8px;
        `,e},createControlPanel(){const a=document.createElement("div");a.className="negotiation-controls",a.style.cssText=`
            padding: 8px;
            background: #f5f5f5;
            border-top: 1px solid #ddd;
            border-bottom: 1px solid #ddd;
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;var e=document.createElement("div");e.style.cssText=`
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        `;const o=document.createElement("button");o.id="negotiation-pause-btn",o.textContent="일시정지",o.style.cssText=`
            padding: 6px 12px;
            background: #1565c0;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `,o.onclick=()=>{var e="재개"===o.textContent,t=(o.textContent=e?"일시정지":"재개",o.style.background=e?"#1565c0":"#4CAF50",document.getElementById("negotiation-prompt-container"));t?t.style.display=e?"none":"block":e||a.appendChild(this.createPromptInput()),NegotiationManager.togglePause()};var t=document.createElement("button");return t.textContent="협상 종료",t.style.cssText=`
            padding: 6px 12px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `,t.onclick=()=>this.closePanel(),e.appendChild(o),e.appendChild(t),a.appendChild(e),a},createPromptInput(){var e=document.createElement("div"),t=(e.id="negotiation-prompt-container",e.style.cssText=`
            margin-top: 8px;
            padding: 8px;
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 4px;
        `,document.createElement("div"));t.textContent="AI에게 협상 방향 지시",t.style.cssText=`
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
        `;const a=document.createElement("textarea");a.placeholder="예시:\n- 가격을 좀 더 낮춰보세요\n- 배송 기간을 단축할 수 있는지 확인해주세요\n- 샘플 주문이 가능한지 문의해주세요",a.style.cssText=`
            width: 100%;
            height: 80px;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            resize: none;
            margin-bottom: 8px;
        `;var o=document.createElement("button");return o.textContent="지시 전달",o.style.cssText=`
            padding: 6px 12px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
        `,o.onclick=async()=>{var e=a.value.trim();e&&(await NegotiationManager.updateNegotiationDirection(e),document.getElementById("negotiation-pause-btn").click())},e.appendChild(t),e.appendChild(a),e.appendChild(o),e},addControlButton(e,t){var a=document.createElement("button");a.textContent=t.text,a.onclick=t.onClick,a.style.cssText=`
            padding: 6px 12px;
            margin: 0 4px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.3s;
            ${t.style}
        `,e.appendChild(a)},setLoading(e){e?(this.elements.spinner.style.display="inline",this.elements.headerTitle.textContent="AI 협상 중..."):(this.elements.spinner.style.display="none",this.elements.headerTitle.textContent="AI 협상")},closePanel(){document.body.style.marginRight="",this.elements.panel&&this.elements.panel.remove(),NegotiationManager.endNegotiation()},addMessage(e,t,a="normal"){var o;t&&((o=document.createElement("div")).style.cssText=`
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
            background: ${"error"===a?"#ffebee":"system"===a?"#e3f2fd":"transparent"}
        `,o.innerHTML=`<b>[${e}]</b> `+t,this.elements.chatArea.appendChild(o),this.elements.chatArea.scrollTop=this.elements.chatArea.scrollHeight)}},ChatManager={async getExistingConversation(){try{var e=await this.waitForIframe(),t=(e.contentDocument||e.contentWindow.document).querySelector(".message-list");if(!t)return console.log("대화 내역을 찾을 수 없습니다."),[];var a=t.querySelectorAll(".message-item");console.log("기존 메시지 수:",a.length);const n=[];return a.forEach((e,t)=>{var a=e.classList.contains("seller-message")||null!==e.querySelector(".headPic"),o=e.querySelector(".content")?.textContent?.trim();o&&(a={role:a?"seller":"buyer",content:o,timestamp:e.getAttribute("data-time")||(new Date).toISOString()},n.push(a),console.log(`메시지 ${t+1}:`,a))}),console.log("전체 대화 내역:",n),n}catch(e){return console.error("대화 내역 가져오기 실패:",e),[]}},async initializeMessageObserver(){try{var e,t=await this.waitForIframe(),a=(t.contentDocument||t.contentWindow.document).querySelector(".message-list-container");if(a)return(e=new MutationObserver(e=>{e.forEach(e=>{"childList"===e.type&&0<e.addedNodes.length&&e.addedNodes.forEach(e=>{e.nodeType===Node.ELEMENT_NODE&&e.classList.contains("message-item")&&this.handleNewMessage(e)})})})).observe(a,{childList:!0,subtree:!0}),e;throw new Error("메시지 컨테이너를 찾을 수 없습니다")}catch(e){throw console.error("메시지 옵저버 초기화 실패:",e),e}},async handleNewMessage(e){try{console.log("New message detected:",e);var t,a,o=e.classList.contains("seller-message")||null!==e.querySelector(".headPic");console.log("Is seller message:",o),o?(t=e.querySelector(".content")?.textContent?.trim(),console.log("Extracted message text:",t),t?(a=await StateManager.getState(),console.log("Current negotiation state:",a),a.isPaused?console.log("Negotiation is paused, ignoring message"):(UIManager.addMessage("판매자 (중국어)",t),console.log("Requesting AI response for:",t),chrome.runtime.sendMessage({action:"startAIProcessing",message:t}))):console.log("No message text found")):console.log("Not a seller message, ignoring")}catch(e){console.error("Message handling error:",e),UIManager.addMessage("에러",e.message,"error")}},async initialize(){try{console.log("ChatManager initialize 시작");var e,t=await this.waitForIframe(),a=(console.log("iframe 찾음:",t),t.contentDocument||t.contentWindow.document),o=(console.log("iframe document 접근:",!!a),console.log("채팅창 초기화 시작"),await this.getExistingConversation()),n=(console.log("기존 대화 수:",o.length),0<o.length&&(e=await ConversationManager.getConversation(),await ConversationManager.setConversation({...e,conversationHistory:o}),console.log("대화 내역 저장 완료")),a.querySelector(".message-list"));if(console.log("메시지 컨테이너 찾음:",!!n),!n)throw new Error("메시지 컨테이너를 찾을 수 없습니다");var s=new MutationObserver(e=>{console.log("Mutations detected:",e.length),e.forEach(e=>{console.log("Mutation type:",e.type),console.log("Added nodes:",e.addedNodes.length),"childList"===e.type&&e.addedNodes.forEach(e=>{console.log("New node:",e),e.nodeType===Node.ELEMENT_NODE&&(e=e.classList?.contains("message-item")?e:e.querySelector(".message-item"))&&(console.log("Message item found:",e),this.handleNewMessage(e))})})}),r=(s.observe(n,{childList:!0,subtree:!0,characterData:!0,attributes:!0}),console.log("입력 요소 초기화 시작"),a.querySelector(".input-area"));if(console.log("input-area 찾음:",!!r),this.elements={input:r?.querySelector("pre"),sendButton:a.querySelector(".send-btn")},console.log("elements 초기화:",this.elements),this.elements.input)return this.initialized=!0,console.log("ChatManager 초기화 완료:",this.initialized),{messageContainer:n,observer:s};throw new Error("입력 요소를 찾을 수 없습니다")}catch(e){throw console.error("ChatManager 초기화 실패:",e),this.initialized=!1,e}},async waitForIframe(d=1e4){return new Promise((n,s)=>{const r=Date.now(),i=()=>{var e=document.querySelector('iframe[src*="air.1688.com"]');if(console.log("Checking for iframe...",!!e),e)try{var t,a,o=e.contentDocument||e.contentWindow.document;console.log("Iframe document accessed:",!!o),"complete"!==o.readyState?(console.log("Iframe still loading..."),Date.now()-r>d?s(new Error("Iframe 로딩 타임아웃")):setTimeout(i,100)):(t=o.querySelector(".input-area"),console.log("Input area found:",!!t),t?(a=t.querySelector("pre"),console.log("Pre element found:",!!a),a?(console.log("Successfully found all required elements"),n(e)):(console.log("Pre element not found yet, retrying..."),Date.now()-r>d?s(new Error("입력 요소를 찾을 수 없습니다")):setTimeout(i,100))):(console.log("Input area not found yet, retrying..."),Date.now()-r>d?s(new Error("입력 영역을 찾을 수 없습니다")):setTimeout(i,100)))}catch(e){console.error("Error accessing iframe:",e),Date.now()-r>d?s(e):setTimeout(i,100)}else Date.now()-r>d?s(new Error("채팅창을 찾을 수 없습니다")):setTimeout(i,100)};i()})},findChatElements(e){e={input:e.querySelector(".editBox .edit"),sendButton:e.querySelector(".send-btn"),placeholder:e.querySelector(".editBox .placeholder")};if(e.input&&e.sendButton)return e;throw new Error("채팅 요소를 찾을 수 없습니다")},async sendMessage(e){if(console.log("sendMessage 호출:",e),!this.initialized)throw new Error("ChatManager가 초기화되지 않았습니다");try{console.log("iframe wait 시작");var t=await this.waitForIframe(),a=t.contentDocument||t.contentWindow.document,o=(console.log(a),a.querySelector(".input-area"));if(!o)throw new Error("입력 영역을 찾을 수 없습니다");var n=o.querySelector("pre");if(!n)throw new Error("입력 요소를 찾을 수 없습니다");console.log("Input element found:",n),console.log("Current text:",n.textContent),console.log("Attempting to set text:",e),n.textContent=e;var s=new InputEvent("input",{bubbles:!0,cancelable:!0});return n.dispatchEvent(s),n.focus(),console.log("메시지 입력 완료:",e),console.log("현재 입력창 내용:",n.textContent),!0}catch(e){return console.error("메시지 입력 실패:",e),console.error("자세한 오류:",e.stack),!1}}},NegotiationManager={async startNegotiation(e){UIManager.setLoading(!0);try{console.log("협상 시작..."),console.log("ChatManager 초기화 상태:",ChatManager.initialized);var t=(new Date).toISOString(),a="session_"+t,o=(ChatManager.initialized||(console.log("ChatManager 초기화 시작..."),await ChatManager.initialize(),console.log("ChatManager 초기화 완료")),await ConversationManager.getConversation());console.log("현재 저장된 대화 내역:",o.conversationHistory),await StateManager.updateState({status:NEGOTIATION_STATUS.IN_PROGRESS,currentSession:{id:a,startTime:t,data:e}}),0<o.conversationHistory?.length&&(console.log("기존 대화 내역을 포함하여 AI 협상 시작"),e.existingConversation=o.conversationHistory),chrome.runtime.sendMessage({action:"startNegotiation",negotiationData:e})}catch(e){console.error("협상 시작 오류:",e),UIManager.addMessage("시스템","오류가 발생했습니다: "+e.message,"error")}finally{UIManager.setLoading(!1)}},async updateNegotiationDirection(e){try{var t=await ConversationManager.getConversation(),a={...t.context,negotiationDirection:e};await ConversationManager.updateConversation({...t,context:a}),UIManager.addMessage("시스템","새로운 협상 방향이 적용되었습니다: "+e,"system")}catch(e){console.error("협상 방향 업데이트 실패:",e),UIManager.addMessage("시스템","협상 방향 업데이트 중 오류가 발생했습니다: "+e.message,"error")}},async handleAIResponse(t){console.log("handleAIResponse 시작:",t);try{var[e,a]=t.split("\n\n"),o=(console.log("분리된 메시지:",{chineseText:e,koreanText:a}),console.log("ChatManager initialized:",ChatManager.initialized),console.log("sendMessage 호출 전..."),await ChatManager.sendMessage(e));if(console.log("sendMessage 결과:",o),!o)throw new Error("메시지 입력 실패");UIManager.addMessage("AI → 판매자 (중국어)",e),UIManager.addMessage("AI → 나 (한국어)",a)}catch(e){console.error("handleAIResponse 에러:",e),UIManager.createErrorRetryMessage(e,()=>this.handleAIResponse(t))}},async handleTranslationRetry(t,a){try{await ConversationManager.getConversation();var e=await new Promise(e=>{chrome.runtime.sendMessage({action:"translateMessage",message:t,direction:a},e)});if(!e.success)throw new Error(e.error);UIManager.addMessage("판매자 (중국어)",e.originalMessage),UIManager.addMessage("판매자 (한국어)",e.translation)}catch(e){UIManager.createErrorRetryMessage(e,()=>this.handleTranslationRetry(t,a))}},toggleInputs(e){var t=document.getElementById("seller-input-field"),a=document.getElementById("ai-response-field"),o=document.getElementById("request-ai-btn");e?(t.disabled=!1,a.disabled=!1,o.disabled=!1,this.showNegotiationDirectionInput()):(t.disabled=!0,a.disabled=!0,o.disabled=!0,(e=document.getElementById("negotiation-direction-input"))&&e.remove())},async togglePause(){var e=!(await this.getState()).isPaused;await this.updateState({isPaused:e}),UIManager.toggleInputs(e),e?UIManager.addMessage("시스템","협상이 일시 중지되었습니다. 판매자 응답을 직접 입력하거나, 새로운 협상 방향을 지정할 수 있습니다.","system"):UIManager.addMessage("시스템","협상이 재개되었습니다. AI가 자동으로 협상을 진행합니다.","system")},async restartNegotiation(){var e=prompt("새로운 협상 스타일을 입력하세요 (예: 적극적, 신중한, 친근한 등)");e&&(await this.updateState({negotiationStyle:{tone:e,language:"formal",priority:"price"},isPaused:!1}),UIManager.addMessage("시스템",`협상 스타일이 '${e}'(으)로 변경되었습니다.`,"system"))},async getState(){return new Promise(e=>{chrome.runtime.sendMessage({action:"getState"},e)})},async updateState(t){return new Promise(e=>{chrome.runtime.sendMessage({action:"updateState",state:t},e)})},async endNegotiation(){await this.updateState({status:"completed",isPaused:!0})}};async function initializeSidePanel(e){Logger.info("Initializing side panel",e);try{var t=document.getElementById("couplus-side-panel"),a=(t&&t.remove(),document.body.style.marginRight="320px",document.body.style.transition="margin-right 0.3s",UIManager.createPanel());document.body.appendChild(a),a.appendChild(UIManager.createHeader()),a.appendChild(UIManager.createChatArea()),a.appendChild(UIManager.createControlPanel()),a.appendChild(UIManager.createInputArea()),await ChatManager.initialize(),Logger.info("Chat manager initialized"),UIManager.addMessage("시스템","AI 협상 패널이 열렸습니다. 협상을 시작합니다...","system"),await NegotiationManager.startNegotiation(e),Logger.info("Negotiation started")}catch(e){Logger.error("Failed to initialize side panel:",e),console.error("사이드 패널 초기화 실패:",e),alert("사이드 패널 초기화 중 오류가 발생했습니다: "+e.message)}}function sleep(t){return new Promise(e=>setTimeout(e,t))}async function makepage(e,t,o,n){var u=[],m=[],[e,s]=(t.상세내역.forEach(e=>{e.옵션1_이미지&&(m.push(e.옵션1_한국어),u.push(e.옵션1_이미지))}),await async function(e,t,o){console.log("setpage");var n=e[0].result[0],s=[],r=e[0].result[2],e=e[0].result[3],i=t.minimagepixel,d=t.maxthumbqty;async function c(e){var t,o;e.includes("https://")&&(o=e,t=await new Promise((e,t)=>{var a=new Image;a.src=o,a.onload=()=>e(a.width),a.onerror=t}),i<t)&&s.push(e)}for(a of r)await c(a);async function l(e,a){console.log("downloading");var t=new XMLHttpRequest;t.open("GET",e,!0),t.responseType="blob",t.onload=function(){var e=(window.URL||window.webkitURL).createObjectURL(this.response),t=document.createElement("a");t.href=e,t.download=a,document.body.appendChild(t),t.click(),document.body.removeChild(t)},t.send()}var g=0,p=0;if(console.log(e[0]),d>n.length)for(g=0;g<n.length;g++)0<n[g].search(".jpg")?l(n[g],o+"_"+(g+1).toString()+".jpg"):l(n[g],o+"_"+(g+1).toString()+".png");else for(g=0;g<d;g++)0<n[g].search(".jpg")?l(n[g],o+"_"+(g+1).toString()+".jpg"):l(n[g],o+"_"+(g+1).toString()+".png");if(console.log(m.length),console.log(u),"1688"==e[0])for(p=0;p<m.length;p++)void 0!==u[p]&&(0<u[p].search(".jpg")?(console.log(o+"_"+m[p]+".jpg"),l(u[p],o+"_"+m[p]+".jpg")):l(u[p],o+"_"+m[p]+".png"),await sleep(500));return[u,s]}(e,t,o)),[[r,d],e,s,t,o]=(console.log(e,s),[[e,s],t,o,m,n]),s=`
        <canvas id="canvas" data-productnum="`+s+`" width="800" height="100"></canvas>
        <h1>
        `,e=e.mdcontent,c=t,l="";if(0==c.length)l="";else if(1==c.length)l="<tr>\n<td>\n<img class='optionimg' src='"+r[0]+"'>\n<div class='optiontext'>"+c+"</div>\n</td>\n</tr>";else if(c.length%2==0)for(i=0;i<c.length/2;i++)l=l+"<tr>\n<td>\n<img class='optionimg' src='"+r[2*i]+"'>\n<div class='optiontext'>"+c[2*i]+"</div>\n</td>\n<td>\n<img class='optionimg' src='"+r[2*i+1]+"'>\n<div class='optiontext'>"+c[2*i+1]+"</div>\n</td>\n</tr>";else{for(i=0;i<c.length/2-.5;i++)l=l+"<tr>\n<td>\n<img class='optionimg' src='"+r[2*i]+"'>\n<div class='optiontext'>"+c[2*i]+"</div>\n</td>\n<td>\n<img class='optionimg' src='"+r[2*i+1]+"'>\n<div class='optiontext'>"+c[2*i+1]+"</div>\n</td>\n</tr>";l=l+"<tr>\n<td>\n<img class='optionimg' src='"+r[c.length-1]+"'>\n<div class='optiontext'>"+c[c.length-1]+"</div>\n</td>\n</tr>"}var g="";for(i=0;i<d.length;i++)g=g+"<div class='container'>\n<img class='image' src='"+d[i]+"'>\n<img class='changed' src=\""+d[i]+"\" alt=''>\n<div class='closebutton'>X</div>\n</div>";t=s+o+'</h1><p class="md">'+e+`</p>

                    <div class="container">
                        <table style="margin-left: auto; margin-right: auto; margin-bottom: 20px;">
                            <caption></caption>
        <tbody>
        `+l+`
        </tbody>
        </table>
        <div class="closebutton">X</div>
    </div>
    <h1></h1>
        `+g,document.querySelector(".main").innerHTML=t}async function makepage2(e,t,o,n,s){var u=[],m=[],[e,t]=(t.상세내역.forEach(e=>{e.옵션1_이미지&&(m.push(e.옵션1_한국어),u.push(e.옵션1_이미지))}),await async function(e,t,o){console.log("setpage");var n=e[0].result[0],s=[],r=e[0].result[2],e=e[0].result[3],i=t.minimagepixel,d=t.maxthumbqty;async function c(e){var t,o;e.includes("https://")&&(o=e,t=await new Promise((e,t)=>{var a=new Image;a.src=o,a.onload=()=>e(a.width),a.onerror=t}),i<t)&&s.push(e)}for(a of r)await c(a);async function l(e,a){console.log("downloading");var t=new XMLHttpRequest;t.open("GET",e,!0),t.responseType="blob",t.onload=function(){var e=(window.URL||window.webkitURL).createObjectURL(this.response),t=document.createElement("a");t.href=e,t.download=a,document.body.appendChild(t),t.click(),document.body.removeChild(t)},t.send()}var g=0,p=0;if(console.log(e[0]),d>n.length)for(g=0;g<n.length;g++)0<n[g].search(".jpg")?l(n[g],o+"_"+(g+1).toString()+".jpg"):l(n[g],o+"_"+(g+1).toString()+".png");else for(g=0;g<d;g++)0<n[g].search(".jpg")?l(n[g],o+"_"+(g+1).toString()+".jpg"):l(n[g],o+"_"+(g+1).toString()+".png");if(console.log(m.length),console.log(u),"1688"==e[0])for(p=0;p<m.length;p++)void 0!==u[p]&&(0<u[p].search(".jpg")?(console.log(o+"_"+m[p]+".jpg"),l(u[p],o+"_"+m[p]+".jpg")):l(u[p],o+"_"+m[p]+".png"),await sleep(500));return[u,s]}(e,t,o)),[[r,d],e,t]=(console.log(e,t),[[e,t],o,m]),e=`
        <canvas id="canvas" data-productnum="`+e+`" width="800" height="100"></canvas>

        `,c=t,l="";if(0==c.length)l="";else if(1==c.length)l="<tr>\n<td>\n<img class='optionimg' src='"+r[0]+"'>\n<div class='optiontext normal'>"+c+"</div>\n</td>\n</tr>";else if(c.length%2==0)for(i=0;i<c.length/2;i++)l=l+"<tr>\n<td>\n<img class='optionimg' src='"+r[2*i]+"'>\n<div class='optiontext normal'>"+c[2*i]+"</div>\n</td>\n<td>\n<img class='optionimg' src='"+r[2*i+1]+"'>\n<div class='optiontext normal'>"+c[2*i+1]+"</div>\n</td>\n</tr>";else{for(i=0;i<c.length/2-.5;i++)l=l+"<tr>\n<td>\n<img class='optionimg' src='"+r[2*i]+"'>\n<div class='optiontext normal'>"+c[2*i]+"</div>\n</td>\n<td>\n<img class='optionimg' src='"+r[2*i+1]+"'>\n<div class='optiontext normal'>"+c[2*i+1]+"</div>\n</td>\n</tr>";l=l+"<tr>\n<td>\n<img class='optionimg' src='"+r[c.length-1]+"'>\n<div class='optiontext normal'>"+c[c.length-1]+"</div>\n</td>\n</tr>"}var g="";for(i=0;i<d.length;i++)g=g+"<div class='container'>\n<img class='image' src='"+d[i]+"'>\n<img class='changed' src=\""+d[i]+"\" alt=''>\n<div class='closebutton'>X</div>\n</div>";t=e+g+`

                    <div class="container">
                        <table style="margin-left: auto; margin-right: auto; margin-bottom: 20px;">
                            <caption></caption>
        <tbody>
        `+l+`
        </tbody>
        </table>
        <div class="closebutton">X</div>
    </div>
    <h1></h1>
        `,document.querySelector(".main").innerHTML=t}