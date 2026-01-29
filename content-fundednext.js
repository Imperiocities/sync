/**
 * FUNDEDNEXT CONTENT SCRIPT v1.2
 * Queue-based capture: Captures on checkout, detects success, sends to queue engine
 * Uses shared TrackerUI to show live extraction data
 * 
 * CRITICAL DISCOVERY: localStorage('purchasePlanInfo') is CLEARED after payment!
 * Solution: Capture on checkout page (where data exists), detect success separately.
 * 
 * v1.2 FIX: Clear paymentProcessed after each purchase to allow multiple purchases
 * 
 * Data Map:
 * - purchasePlanInfo.couponCode → coupon_code
 * - purchasePlanInfo.totalPrice → final_price
 * - purchasePlanInfo.plan_value → original_price
 * - purchasePlanInfo.discount_price → discount_amount
 * - purchasePlanInfo.plan_name → product_name
 * - user.email → email (backup)
 * - user.full_name → customer_name (backup)
 */

(function() {
  'use strict';
  
  const PARTNER = 'fundednext';
  const PARTNER_NAME = 'FundedNext';
  const DEBUG = true;
  const VERSION = 'v1.2';
  
  function log(...args) {
    if (DEBUG) console.log('[FN-Queue]', ...args);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // TRACKER UI
  // ═══════════════════════════════════════════════════════════════════════
  
  let tracker = null;
  
  function getTracker() {
    // Check if tracker was created by autofill script
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      return tracker;
    }
    return tracker;
  }
  
  function initTracker() {
    // Check if already exists globally
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      log('Using existing tracker from autofill');
      return;
    }
    
    if (!window.TrackerUI) {
      log('TrackerUI not loaded yet, retrying...');
      setTimeout(initTracker, 500);
      return;
    }
    
    if (tracker) return;
    
    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: PARTNER_NAME,
      fields: ['coupon', 'product', 'price', 'email'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email'
      },
      afterPurchaseFields: [] // FundedNext doesn't provide order number
    });
    
    // Store globally
    window.__pfcTracker = tracker;
    log('Tracker initialized');
  }
  
  function showTracker() {
    if (!tracker) initTracker();
    if (tracker) tracker.show();
  }
  
  function updateTrackerData(data) {
    if (!tracker) return;
    
    if (data.product_name) {
      tracker.updateField('product', data.product_name);
    }
    if (data.final_price) {
      const priceDisplay = data.original_price && parseFloat(data.original_price) > parseFloat(data.final_price)
        ? tracker.formatPrice(data.original_price, data.final_price)
        : `$${parseFloat(data.final_price).toFixed(2)}`;
      tracker.updateField('price', data.final_price, priceDisplay);
    }
    if (data.email) {
      tracker.updateField('email', data.email);
    }
    if (data.coupon_code) {
      tracker.updateField('coupon', data.coupon_code);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PAGE DETECTION
  // ═══════════════════════════════════════════════════════════════════════
  
  function isCheckoutPage() {
    const path = window.location.pathname;
    return path.includes('/checkout') && !path.includes('/thank-you');
  }
  
  function isSuccessPage() {
    const path = window.location.pathname;
    return path.includes('/thank-you') || path.includes('/success');
  }
  
  function hasPaymentProcessed() {
    return localStorage.getItem('paymentProcessed') === 'true';
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // DATA EXTRACTION - Based on actual capture analysis
  // ═══════════════════════════════════════════════════════════════════════
  
  function extractPurchaseData() {
    const data = {
      partner: PARTNER,
      email: null,
      customer_name: null,
      product_name: null,
      original_price: null,
      final_price: null,
      discount_amount: null,
      coupon_code: null,
      order_number: null,  // FundedNext doesn't provide this - that's OK
      plan_id: null,
      checkout_url: window.location.href
    };
    
    // ─────────────────────────────────────────────────────────────────
    // PRIMARY: purchasePlanInfo (ONLY exists on checkout page!)
    // ─────────────────────────────────────────────────────────────────
    try {
      const ppiRaw = localStorage.getItem('purchasePlanInfo');
      if (ppiRaw) {
        const ppi = JSON.parse(ppiRaw);
        
        data.coupon_code = ppi.couponCode || ppi.coupon || null;
        data.final_price = ppi.totalPrice || null;
        data.original_price = ppi.plan_value || null;
        data.discount_amount = ppi.discount_price || null;
        data.product_name = ppi.plan_name || ppi.name || null;
        data.plan_id = ppi.plan_id || ppi.id || null;
        data.email = ppi.email || null;
        
        if (ppi.personalInfo) {
          data.email = data.email || ppi.personalInfo.email;
          const firstName = ppi.personalInfo.firstName || '';
          const lastName = ppi.personalInfo.lastName || '';
          data.customer_name = `${firstName} ${lastName}`.trim() || null;
        }
        
        // Also check accountData for additional pricing info
        if (ppi.accountData) {
          if (!data.original_price && ppi.accountData.price) {
            data.original_price = ppi.accountData.price;
          }
          if (!data.final_price && ppi.accountData.discountPrice) {
            data.final_price = ppi.accountData.discountPrice;
          }
          if (ppi.accountData.size) {
            data.account_size = ppi.accountData.size;
          }
        }
        
        // Check accountType for product name
        if (ppi.accountType?.name && !data.product_name) {
          data.product_name = ppi.accountType.name;
          if (ppi.accountData?.size) {
            data.product_name += ` ${ppi.accountData.size} USD`;
          }
        }
        
        log('✅ Extracted from purchasePlanInfo:', data);
      }
    } catch (e) {
      log('⚠️ Error reading purchasePlanInfo:', e);
    }
    
    // ─────────────────────────────────────────────────────────────────
    // SECONDARY: user (always available)
    // ─────────────────────────────────────────────────────────────────
    try {
      const userRaw = localStorage.getItem('user');
      if (userRaw) {
        const user = JSON.parse(userRaw);
        if (!data.email) data.email = user.email;
        if (!data.customer_name) data.customer_name = user.full_name;
        log('📧 User data:', { email: data.email, name: data.customer_name });
      }
    } catch (e) {}
    
    // ─────────────────────────────────────────────────────────────────
    // FALLBACK: Form input for coupon
    // ─────────────────────────────────────────────────────────────────
    if (!data.coupon_code) {
      // Try various coupon input selectors
      const couponSelectors = [
        'input.tw-bg-transparent.tw-outline-none',
        'input[placeholder*="coupon" i]',
        'input[placeholder*="code" i]',
        'input[name*="coupon" i]'
      ];
      
      for (const selector of couponSelectors) {
        const input = document.querySelector(selector);
        if (input && input.value && input.value.trim().length >= 2) {
          data.coupon_code = input.value.trim().toUpperCase();
          log('🎟️ Coupon from input:', data.coupon_code);
          break;
        }
      }
    }
    
    // ─────────────────────────────────────────────────────────────────
    // FALLBACK: URL for coupon
    // ─────────────────────────────────────────────────────────────────
    if (!data.coupon_code) {
      const urlParams = new URLSearchParams(window.location.search);
      const couponFromUrl = urlParams.get('coupon') || urlParams.get('couponCode') || urlParams.get('promo');
      if (couponFromUrl) {
        data.coupon_code = couponFromUrl.toUpperCase();
        log('🎟️ Coupon from URL:', data.coupon_code);
      }
    }
    
    // ─────────────────────────────────────────────────────────────────
    // FALLBACK: Check page text for "LAB Applied" or similar
    // ─────────────────────────────────────────────────────────────────
    if (!data.coupon_code) {
      const pageText = document.body?.innerText || '';
      if (pageText.includes('LAB Applied') || pageText.includes('LAB applied')) {
        data.coupon_code = 'LAB';
        log('🎟️ Coupon from page text: LAB');
      }
    }
    
    // ─────────────────────────────────────────────────────────────────
    // FALLBACK: Cookie for email
    // ─────────────────────────────────────────────────────────────────
    if (!data.email) {
      const match = document.cookie.match(/_email=([^;]+)/);
      if (match) {
        data.email = decodeURIComponent(match[1]);
        log('📧 Email from cookie:', data.email);
      }
    }
    
    return data;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // CAPTURE: Send to background queue
  // ═══════════════════════════════════════════════════════════════════════
  
  function capturePurchase() {
    const data = extractPurchaseData();
    
    // Update tracker with current data
    updateTrackerData(data);
    
    // Need minimum data to capture
    if (!data.email && !data.final_price && !data.original_price) {
      log('⏳ Not enough data to capture yet');
      if (tracker) tracker.setStatus('', 'Waiting for checkout data...');
      return;
    }
    
    // Must have a tracked coupon code
    const validCoupons = ['LAB', 'JAN'];
    if (!data.coupon_code || !validCoupons.includes(data.coupon_code.toUpperCase())) {
      log('⏭️ No tracked coupon code found:', data.coupon_code);
      if (tracker) tracker.showMessage('warning', 'Apply code "LAB" to track rewards');
      return;
    }
    
    // Show coupon validation message
    if (tracker) tracker.showMessage('success', `✓ Coupon "${data.coupon_code}" validated!`);
    
    log('📤 Capturing purchase:', data);
    
    chrome.runtime.sendMessage(
      { action: 'CAPTURE_PURCHASE', data },
      (response) => {
        if (chrome.runtime.lastError) {
          log('❌ Capture error:', chrome.runtime.lastError.message);
          if (tracker) tracker.setStatus('error', 'Connection error');
          return;
        }
        if (response?.success) {
          log('✅ Queued! Position:', response.queueLength);
          if (tracker) tracker.setStatus('waiting', 'Waiting for payment...');
          showNotification('Purchase captured', 'success');
        }
      }
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // SUCCESS: Trigger submission
  // ═══════════════════════════════════════════════════════════════════════
  
  function triggerSuccess() {
    const successData = {
      partner: PARTNER,
      url: window.location.href,
      email: null
    };
    
    // Try to get email from user (still available on success page)
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      successData.email = user.email;
    } catch (e) {}
    
    log('🎉 Triggering success');
    
    // Show tracker on success page
    showTracker();
    if (tracker) tracker.setStatus('waiting', 'Processing purchase...');
    
    chrome.runtime.sendMessage(
      { action: 'SUCCESS_DETECTED', data: successData },
      (response) => {
        if (chrome.runtime.lastError) {
          log('❌ Success trigger error:', chrome.runtime.lastError.message);
          if (tracker) tracker.setStatus('error', 'Connection error');
          // Reset so we can retry - but keep paymentProcessed so we retry on next check
          hasTriggeredSuccess = false;
          lastPaymentProcessedState = true; // Keep this true so we can retry
          return;
        }
        if (response?.success) {
          if (response.skipped) {
            log('⏭️ Skipped (duplicate)');
            if (tracker) {
              tracker.setStatus('success', 'Already tracked');
              tracker.showMessage('success', 'This purchase was already tracked!');
            }
          } else {
            log('✅ Submitted!');
            if (tracker) {
              tracker.setStatus('success', 'Reward tracked!');
              tracker.showMessage('success', 'Your purchase has been submitted for rewards! 🎉');
            }
            showNotification('Purchase submitted!', 'success');
          }
          
          // IMPORTANT: Reset for next purchase after a short delay
          // This allows the UI to show the success message before resetting
          setTimeout(() => {
            log('🔄 Ready for next purchase');
            
            // CRITICAL: Clear paymentProcessed so next purchase can be detected
            if (localStorage.getItem('paymentProcessed') === 'true') {
              log('🧹 Clearing paymentProcessed for next purchase');
              localStorage.removeItem('paymentProcessed');
            }
            
            hasTriggeredSuccess = false;
            lastCaptureTime = 0;
            lastPaymentProcessedState = false;
            
            // Clear tracker fields for next purchase
            if (tracker) {
              tracker.clearField('product');
              tracker.clearField('price');
              tracker.clearField('coupon');
              // Keep email field
              tracker.showMessage('success', '✅ Ready to track next purchase');
            }
          }, 3000);
        } else {
          log('❌ Failed:', response?.error);
          if (tracker) tracker.setStatus('warning', 'Retrying...');
          showNotification('Submit failed - will retry', 'error');
          // Reset so we can retry - but keep paymentProcessed so we retry on next check
          hasTriggeredSuccess = false;
          lastPaymentProcessedState = true; // Keep this true so we can retry
        }
      }
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // MONITORING
  // ═══════════════════════════════════════════════════════════════════════
  
  let lastCaptureTime = 0;
  let hasTriggeredSuccess = false;
  let lastPaymentProcessedState = null; // Track the PREVIOUS state of paymentProcessed
  
  // Initialize payment state - we track CHANGES, not just the value
  function initPaymentState() {
    lastPaymentProcessedState = localStorage.getItem('paymentProcessed') === 'true';
    log('📊 Initial paymentProcessed state:', lastPaymentProcessedState);
    
    // If already on checkout page, clear the payment flag to prepare for new purchase
    if (isCheckoutPage() && lastPaymentProcessedState) {
      log('🔄 Clearing stale paymentProcessed flag on checkout page');
      localStorage.removeItem('paymentProcessed');
      lastPaymentProcessedState = false;
    }
  }
  
  // Reset for new purchase - call this when entering checkout
  function resetForNewPurchase() {
    log('🔄 Resetting for new purchase');
    hasTriggeredSuccess = false;
    lastCaptureTime = 0;
    
    // Clear paymentProcessed to allow detection of next purchase
    if (localStorage.getItem('paymentProcessed') === 'true') {
      log('🧹 Clearing paymentProcessed for next purchase');
      localStorage.removeItem('paymentProcessed');
      lastPaymentProcessedState = false;
    }
  }
  
  function checkAndCapture() {
    if (Date.now() - lastCaptureTime < 2000) return; // Debounce
    
    if (isCheckoutPage()) {
      // Show tracker on checkout
      showTracker();
      
      if (localStorage.getItem('purchasePlanInfo')) {
        capturePurchase();
        lastCaptureTime = Date.now();
      } else {
        // Still update tracker with any available data
        const data = extractPurchaseData();
        updateTrackerData(data);
        if (tracker) tracker.setStatus('', 'Waiting for checkout data...');
      }
    }
  }
  
  function checkForSuccess() {
    if (hasTriggeredSuccess) return;
    
    // Check for success page OR paymentProcessed flag
    const isSuccess = isSuccessPage();
    const paymentFlag = localStorage.getItem('paymentProcessed') === 'true';
    
    if (isSuccess || paymentFlag) {
      hasTriggeredSuccess = true;
      log('🎉 Success detected! isSuccessPage:', isSuccess, 'paymentProcessed:', paymentFlag);
      setTimeout(triggerSuccess, 500);
    }
  }
  
  // Watch localStorage changes - detect paymentProcessed CHANGE to true
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    originalSetItem.apply(this, arguments);
    
    if (key === 'paymentProcessed') {
      const newState = value === 'true';
      log('💳 paymentProcessed set to:', value, '(was:', lastPaymentProcessedState, ')');
      
      // Only trigger success if state CHANGED from false to true
      // This prevents false triggers when the flag is already true
      if (newState && lastPaymentProcessedState === false) {
        log('💳 Payment COMPLETED - triggering success detection');
        lastPaymentProcessedState = true;
        checkForSuccess();
      } else if (newState && lastPaymentProcessedState === true) {
        log('⚠️ paymentProcessed already true - ignoring duplicate set');
      }
      
      lastPaymentProcessedState = newState;
    }
    
    if (key === 'purchasePlanInfo') {
      log('📋 purchasePlanInfo updated');
      setTimeout(checkAndCapture, 300);
    }
  };
  
  // Also intercept removeItem to track clearing of paymentProcessed
  const originalRemoveItem = localStorage.removeItem;
  localStorage.removeItem = function(key) {
    originalRemoveItem.apply(this, arguments);
    
    if (key === 'paymentProcessed') {
      log('🧹 paymentProcessed cleared');
      lastPaymentProcessedState = false;
    }
  };
  
  // Watch URL changes (SPA)
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      const oldUrl = lastUrl;
      lastUrl = window.location.href;
      log('🔗 URL changed:', lastUrl);
      
      // If navigating TO checkout page, reset for new purchase
      if (isCheckoutPage()) {
        log('🔄 Navigated to checkout - preparing for new purchase');
        resetForNewPurchase();
      }
      
      setTimeout(() => {
        checkAndCapture();
        checkForSuccess();
      }, 500);
    }
  }).observe(document.body, { childList: true, subtree: true });
  
  // Watch form changes
  document.addEventListener('change', (e) => {
    if (e.target.tagName === 'INPUT') {
      setTimeout(checkAndCapture, 500);
    }
  });
  
  // Also watch for click on payment buttons
  document.addEventListener('click', (e) => {
    const target = e.target;
    const text = target.textContent?.toLowerCase() || '';
    
    // If clicking a pay/submit button, capture immediately
    if (text.includes('pay') || text.includes('submit') || text.includes('complete')) {
      log('💳 Payment button clicked');
      checkAndCapture();
    }
  }, true);
  
  // ═══════════════════════════════════════════════════════════════════════
  // NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════
  
  function showNotification(message, type = 'info') {
    // Use tracker message instead of separate notification
    if (tracker) {
      tracker.showMessage(type, message);
    }
    log(`[Notification] ${type}: ${message}`);
  }
  
  // Legacy notification function (unused now)
  function showNotificationLegacy(message, type = 'info') {
    const colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6' };
    
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      background: ${colors[type]}; color: white;
      padding: 12px 20px; border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px;
      z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideInRight 0.3s ease-out;
    `;
    el.textContent = `🎯 ${message}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // DEBUG HELPERS (available in console)
  // ═══════════════════════════════════════════════════════════════════════
  
  window.fnQueueDebug = {
    extract: extractPurchaseData,
    capture: capturePurchase,
    triggerSuccess: triggerSuccess,
    getStatus: () => {
      chrome.runtime.sendMessage({ action: 'GET_QUEUE_STATUS' }, (response) => {
        console.log('[FN-Queue] Status:', response);
      });
    },
    clearQueue: () => {
      chrome.runtime.sendMessage({ action: 'CLEAR_QUEUE' }, (response) => {
        console.log('[FN-Queue] Queue cleared:', response);
      });
    },
    retryFailed: () => {
      chrome.runtime.sendMessage({ action: 'RETRY_FAILED' }, (response) => {
        console.log('[FN-Queue] Retried:', response);
      });
    }
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════
  
  log(`📦 FundedNext Queue Script ${VERSION} loaded:`, window.location.pathname);
  log('   isCheckoutPage:', isCheckoutPage());
  log('   isSuccessPage:', isSuccessPage());
  log('   hasPaymentProcessed:', hasPaymentProcessed());
  
  // Initialize payment state tracking
  initPaymentState();
  
  // If on checkout page, reset for new purchase
  if (isCheckoutPage()) {
    resetForNewPurchase();
  }
  
  setTimeout(() => {
    checkAndCapture();
    checkForSuccess();
  }, 1000);
  
  window.addEventListener('load', () => {
    setTimeout(() => {
      checkAndCapture();
      checkForSuccess();
    }, 500);
  });
  
  // Also check periodically in case data loads late
  setInterval(() => {
    if (isCheckoutPage()) {
      checkAndCapture();
    }
  }, 3000);
  
})();
