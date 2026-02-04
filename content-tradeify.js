/**
 * TRADEIFY CONTENT SCRIPT v1.2
 * Handles checkout capture, success detection, and LAB coupon autofill for Tradeify
 *
 * Data Sources:
 * - Network: /api/dashboard/plandetails - plan info, price, coupon
 * - Network: /api/dashboard/plan-list - all plans
 * - Network: /api/dashboard/profile - user id, email, name, phone
 * - Network: Intercom ping - email, user_id, name (fallback)
 * - Network: Klaviyo events - email, user ID (fallback)
 * - LocalStorage: Intercom user data
 * - URL: plan_id parameter
 * - DOM: Success page detection
 *
 * Features:
 * - LAB coupon auto-fill on checkout page
 * - User profile data capture (email, user_id, name, phone)
 * - Price tracking with discount calculation
 */

(function() {
  'use strict';

  // Prevent double initialization
  if (window.__tradeifyContentLoaded) return;
  window.__tradeifyContentLoaded = true;

  const PARTNER = 'tradeify';
  const PARTNER_NAME = 'Tradeify';
  const DEBUG = true;
  const VERSION = 'v1.2';
  const VALID_COUPONS = ['LAB'];

  function log(...args) {
    if (DEBUG) console.log('[Tradeify]', ...args);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NETWORK DATA
  // ═══════════════════════════════════════════════════════════════════════

  const networkData = {
    plan: null,           // Selected plan details
    plans: {},            // All plans by ID
    email: null,
    userId: null,
    userName: null,
    username: null,       // Tradeify username
    phone: null,
    couponCode: null,
    couponDiscount: null,
    couponDiscountType: null,
    lastNetworkUpdate: 0,
    network_log: []
  };

  // ═══════════════════════════════════════════════════════════════════════
  // INTERCOM DATA FROM LOCALSTORAGE
  // ═══════════════════════════════════════════════════════════════════════

  function extractIntercomData() {
    try {
      // Intercom stores data in localStorage with various keys
      const intercomKeys = Object.keys(localStorage).filter(k =>
        k.includes('intercom') || k.includes('intercom-state')
      );

      for (const key of intercomKeys) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data?.user?.email) {
            networkData.email = data.user.email;
            log('✅ Email from Intercom localStorage:', networkData.email);
          }
          if (data?.user?.user_id) {
            networkData.userId = data.user.user_id;
            log('✅ User ID from Intercom localStorage:', networkData.userId);
          }
          if (data?.user?.name) {
            networkData.userName = data.user.name;
          }
        } catch (e) {}
      }

      // Also check window.Intercom for settings
      if (window.Intercom && window.intercomSettings) {
        if (window.intercomSettings.email && !networkData.email) {
          networkData.email = window.intercomSettings.email;
          log('✅ Email from intercomSettings:', networkData.email);
        }
        if (window.intercomSettings.user_id && !networkData.userId) {
          networkData.userId = window.intercomSettings.user_id;
        }
        if (window.intercomSettings.name && !networkData.userName) {
          networkData.userName = window.intercomSettings.name;
        }
      }
    } catch (e) {
      log('⚠️ Error extracting Intercom data:', e);
    }
  }

  // Listen for network events from intercept script
  document.addEventListener('__pfc_tradeify_net', function(e) {
    try {
      const detail = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      if (!detail || !detail.type || !detail.data) return;

      const d = detail.data;

      // Log network requests
      if (detail.type === 'fetch' || detail.type === 'xhr') {
        networkData.network_log.push({
          type: detail.type,
          url: d.url,
          method: d.method,
          status: d.status,
          time: new Date().toISOString()
        });
        if (networkData.network_log.length > 100) {
          networkData.network_log.splice(0, networkData.network_log.length - 100);
        }

        if (d.responseData) {
          processNetworkResponse(d.url, d.responseData, d.requestBody);
        }
      }
    } catch (err) {
      log('⚠️ Error processing network event:', err);
    }
  });

  function processNetworkResponse(url, data, requestBody) {
    if (!data || typeof data !== 'object') return;

    const urlLower = url.toLowerCase();

    // ─────────────────────────────────────────────────────────────────
    // Plan details endpoint
    // /api/dashboard/plandetails?id=xxx
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('plandetails')) {
      log('🔍 Processing plandetails response');
      if (data.success && data.data?.data) {
        const plan = data.data.data;
        networkData.plan = plan;
        networkData.lastNetworkUpdate = Date.now();

        // Extract coupon info
        if (plan.coupon_code) {
          networkData.couponCode = plan.coupon_code;
          networkData.couponDiscount = parseFloat(plan.coupon_discount_value) || 0;
          networkData.couponDiscountType = plan.coupon_discount_type;
        }

        log('✅ Plan details:', plan.name, plan.price, 'coupon:', plan.coupon_code);

        // Update tracker
        updateTrackerFromNetwork();
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Plan list endpoint
    // /api/dashboard/plan-list
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('plan-list')) {
      log('🔍 Processing plan-list response');
      if (data.success && data.data?.data && Array.isArray(data.data.data)) {
        for (const plan of data.data.data) {
          if (plan.id) {
            networkData.plans[plan.id] = plan;
          }
        }
        log('✅ Loaded', Object.keys(networkData.plans).length, 'plans');
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // User profile endpoint - best source of user data
    // /api/dashboard/profile
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('/profile') && !urlLower.includes('sumsub')) {
      log('🔍 Processing profile response');
      if (data.success && data.data) {
        const profile = data.data;
        if (profile.id) {
          networkData.userId = profile.id;
          log('✅ User ID from profile:', networkData.userId);
        }
        if (profile.email) {
          networkData.email = profile.email;
          log('✅ Email from profile:', networkData.email);
        }
        if (profile.first_name || profile.last_name) {
          networkData.userName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
          log('✅ Name from profile:', networkData.userName);
        }
        if (profile.username) {
          networkData.username = profile.username;
        }
        if (profile.phone) {
          networkData.phone = profile.phone;
        }
        updateTrackerFromNetwork();
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Intercom ping (contains user_data with email, user_id, name)
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('intercom') && urlLower.includes('ping')) {
      log('🔍 Processing Intercom ping');
      // Parse from request body (form-urlencoded)
      if (requestBody) {
        try {
          // user_data is URL encoded JSON in the request body
          const params = new URLSearchParams(requestBody);
          const userDataStr = params.get('user_data');
          if (userDataStr) {
            const userData = JSON.parse(decodeURIComponent(userDataStr));
            if (userData.email) {
              networkData.email = userData.email;
              log('✅ Email from Intercom:', networkData.email);
            }
            if (userData.user_id) {
              networkData.userId = userData.user_id;
              log('✅ User ID from Intercom:', networkData.userId);
            }
            if (userData.name) {
              networkData.userName = userData.name;
              log('✅ Name from Intercom:', networkData.userName);
            }
            updateTrackerFromNetwork();
          }
        } catch (e) {
          log('⚠️ Error parsing Intercom data:', e);
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Klaviyo analytics (fallback for email)
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('klaviyo') || urlLower.includes('event-bulk-create')) {
      log('🔍 Processing Klaviyo event');
      // Parse from request body
      if (requestBody) {
        try {
          const req = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
          const profile = req.data?.attributes?.profile?.data?.attributes;
          if (profile?.email && !networkData.email) {
            networkData.email = profile.email;
            log('✅ Email from Klaviyo:', networkData.email);
          }
          const events = req.data?.attributes?.events?.data;
          if (events && events[0]?.attributes?.properties) {
            const props = events[0].attributes.properties;
            if (props.Email && !networkData.email) networkData.email = props.Email;
            if (props.UserID && !networkData.userId) networkData.userId = props.UserID;
          }
        } catch (e) {}
      }
      return;
    }
  }

  function updateTrackerFromNetwork() {
    // Update user data even without plan
    if (networkData.email || networkData.userId) {
      updateTrackerData({
        email: networkData.email,
        user_id: networkData.userId
      });
    }

    if (!networkData.plan) return;

    const plan = networkData.plan;
    const originalPrice = parseFloat(plan.price) || 0;
    let finalPrice = originalPrice;

    // Calculate discounted price
    if (networkData.couponDiscount && networkData.couponDiscountType === 'percentage') {
      finalPrice = originalPrice * (1 - networkData.couponDiscount / 100);
    } else if (networkData.couponDiscount && networkData.couponDiscountType === 'fixed') {
      finalPrice = originalPrice - networkData.couponDiscount;
    }

    const productName = `${plan.plan_type || ''} ${plan.account_type || plan.name}`.trim();

    updateTrackerData({
      product_name: productName,
      original_price: originalPrice,
      final_price: finalPrice,
      coupon_code: networkData.couponCode,
      email: networkData.email,
      user_id: networkData.userId
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRACKER UI
  // ═══════════════════════════════════════════════════════════════════════

  let tracker = null;

  function initTracker() {
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      log('Using existing tracker');
      return;
    }

    if (!window.TrackerUI) {
      log('TrackerUI not loaded, retrying...');
      setTimeout(initTracker, 500);
      return;
    }

    if (tracker) return;

    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: PARTNER_NAME,
      fields: ['coupon', 'product', 'price', 'email', 'user_id', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        user_id: 'Account ID',
        order_id: 'Order ID'
      },
      afterPurchaseFields: ['order_id']
    });

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
    if (data.final_price || data.original_price) {
      const origPrice = data.original_price;
      const finalPrice = data.final_price || origPrice;
      const priceDisplay = origPrice && finalPrice && origPrice > finalPrice
        ? tracker.formatPrice(origPrice, finalPrice)
        : `$${parseFloat(finalPrice || origPrice).toFixed(2)}`;
      tracker.updateField('price', finalPrice || origPrice, priceDisplay);
    }
    if (data.email) {
      tracker.updateField('email', data.email);
    }
    if (data.user_id) {
      tracker.updateField('user_id', data.user_id);
    }
    if (data.coupon_code) {
      tracker.updateField('coupon', data.coupon_code);
    }
    if (data.order_id) {
      tracker.updateField('order_id', data.order_id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE DETECTION
  // ═══════════════════════════════════════════════════════════════════════

  function isCheckoutPage() {
    return window.location.pathname.includes('/checkout') ||
           window.location.href.includes('plan_id=');
  }

  function isSelectPlanPage() {
    return window.location.pathname.includes('/select-plan');
  }

  function isSuccessPage() {
    const text = document.body?.innerText || '';
    return text.includes('Payment Successful') ||
           text.includes('Thank you for your purchase') ||
           text.includes('Order confirmed') ||
           window.location.pathname.includes('/success') ||
           window.location.pathname.includes('/thank-you');
  }

  function getUrlPlanId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('plan_id');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DATA EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════

  function extractPurchaseData() {
    // Try to get Intercom data if not already captured
    if (!networkData.email && !networkData.userId) {
      extractIntercomData();
    }

    const plan = networkData.plan || {};
    const originalPrice = parseFloat(plan.price) || 0;
    let finalPrice = originalPrice;

    // Calculate discounted price
    if (networkData.couponDiscount && networkData.couponDiscountType === 'percentage') {
      finalPrice = originalPrice * (1 - networkData.couponDiscount / 100);
    } else if (networkData.couponDiscount && networkData.couponDiscountType === 'fixed') {
      finalPrice = originalPrice - networkData.couponDiscount;
    }

    const productName = plan.account_type || plan.name || null;

    return {
      partner: PARTNER,
      email: networkData.email,
      user_id: networkData.userId,
      username: networkData.username,
      customer_name: networkData.userName,
      phone: networkData.phone,
      product_name: productName ? `${plan.plan_type || ''} ${productName}`.trim() : null,
      account_size: plan.additional_info?.initial_balance || null,
      original_price: originalPrice || null,
      final_price: finalPrice || null,
      discount_amount: originalPrice - finalPrice || null,
      coupon_code: networkData.couponCode,
      order_number: null,
      plan_id: plan.id || getUrlPlanId(),
      broker: plan.broker || null,
      checkout_url: window.location.href
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CAPTURE LOGIC
  // ═══════════════════════════════════════════════════════════════════════

  let hasTriggeredSuccess = false;
  let purchaseCaptured = false;

  function captureCheckout() {
    const data = extractPurchaseData();

    // Update tracker
    updateTrackerData(data);

    // Validate coupon
    if (!data.coupon_code) {
      log('⏭️ No coupon code found');
      if (tracker) tracker.showMessage('warning', 'Apply code "LAB" to track rewards');
      return;
    }

    const couponUpper = data.coupon_code.toUpperCase();
    if (!VALID_COUPONS.includes(couponUpper)) {
      log('⏭️ Coupon not tracked:', data.coupon_code);
      if (tracker) tracker.showMessage('info', `Code "${data.coupon_code}" applied`);
      return;
    }

    if (purchaseCaptured) {
      log('⏭️ Already captured');
      return;
    }

    if (!data.email && !data.final_price) {
      log('⏭️ Not enough data yet');
      if (tracker) tracker.setStatus('', 'Waiting for checkout data...');
      return;
    }

    log('✅ Capturing checkout:', data);
    if (tracker) {
      tracker.showMessage('success', `✓ Coupon "${data.coupon_code}" validated!`);
      tracker.setStatus('waiting', 'Waiting for payment...');
    }

    chrome.runtime.sendMessage({ action: 'CAPTURE_PURCHASE', data }, (response) => {
      if (chrome.runtime.lastError) {
        log('❌ Capture error:', chrome.runtime.lastError.message);
        return;
      }
      if (response?.success) {
        purchaseCaptured = true;
        log('✅ Queued with fingerprint:', response.fingerprint);
      }
    });
  }

  function triggerSuccess() {
    if (hasTriggeredSuccess) return;
    hasTriggeredSuccess = true;

    log('🎉 Success page detected');

    const data = extractPurchaseData();

    // Try to extract order ID from DOM
    const text = document.body?.innerText || '';
    const orderMatch = text.match(/order[:\s#]*([A-Z0-9-]+)/i) ||
                       text.match(/confirmation[:\s#]*([A-Z0-9-]+)/i);
    if (orderMatch) {
      data.order_number = orderMatch[1];
      log('✅ Order number:', data.order_number);
    }

    updateTrackerData(data);

    chrome.runtime.sendMessage({
      action: 'SUCCESS_DETECTED',
      data: {
        partner: PARTNER,
        order_number: data.order_number,
        email: data.email,
        coupon_code: data.coupon_code,
        successData: data
      }
    }, (response) => {
      if (chrome.runtime.lastError) return;

      if (response?.success) {
        purchaseCaptured = false;
        if (tracker) {
          tracker.setStatus('success', response.skipped ? 'Already tracked' : 'Reward tracked!');
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTOFILL - Direct implementation (like TakeProfitTrader)
  // ═══════════════════════════════════════════════════════════════════════

  let autofillAttempted = false;
  let autofillInProgress = false;

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function performAutofill() {
    if (autofillAttempted || autofillInProgress) {
      return;
    }

    // Check if LAB coupon already applied (look for chip with LAB text)
    const existingChip = document.querySelector('.promo_chip');
    if (existingChip && existingChip.textContent?.toUpperCase().includes('LAB')) {
      log('✅ LAB coupon already applied');
      autofillAttempted = true;
      if (tracker) {
        tracker.updateField('coupon', 'LAB');
        tracker.setAutoFillStatus('success', 'Code "LAB" already applied ✓');
        setTimeout(() => tracker.setAutoFillStatus('hidden', ''), 3000);
      }
      return;
    }

    autofillInProgress = true;
    log('🔄 Starting coupon autofill...');

    if (tracker) {
      tracker.setAutoFillStatus('applying', 'Applying code "LAB"...');
    }

    try {
      // Step 1: Find "Add promo code" button
      let promoBtn = document.querySelector('.promo_btn');
      if (!promoBtn) {
        // Fallback: search by text
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('add promo') || text.includes('promo code')) {
            promoBtn = btn;
            break;
          }
        }
      }

      if (!promoBtn) {
        log('⚠️ Promo button not found');
        autofillAttempted = true;
        autofillInProgress = false;
        if (tracker) tracker.setAutoFillStatus('error', 'Promo button not found');
        return;
      }

      // Click promo button with proper event simulation
      log('📍 Found promo button, clicking...');
      promoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Wait for input to appear
      await sleep(300);

      // Step 2: Find promo input - try multiple selectors
      let input = null;
      const inputSelectors = [
        "input[placeholder*='promo' i]",
        "input[placeholder*='coupon' i]",
        "input[placeholder*='code' i]",
        "input[name*='promo' i]",
        "input[name*='coupon' i]",
        ".MuiInputBase-input"
      ];

      // Poll for input appearance
      for (let attempt = 0; attempt < 10 && !input; attempt++) {
        for (const selector of inputSelectors) {
          const found = document.querySelector(selector);
          // Make sure it's visible and not the search input
          if (found && found.offsetParent !== null &&
              !found.placeholder?.toLowerCase().includes('search') &&
              !found.placeholder?.toLowerCase().includes('address')) {
            input = found;
            break;
          }
        }
        if (!input) {
          await sleep(100);
        }
      }

      if (!input) {
        log('⚠️ Promo input not found after clicking button');
        autofillAttempted = true;
        autofillInProgress = false;
        if (tracker) tracker.setAutoFillStatus('error', 'Input not found - try manually');
        return;
      }

      log('📍 Found input:', input.placeholder || input.name || 'no-name');

      // Check if already filled with LAB
      if (input.value?.toUpperCase() === 'LAB') {
        log('✅ Input already has LAB');
        autofillAttempted = true;
        autofillInProgress = false;
        if (tracker) {
          tracker.updateField('coupon', 'LAB');
          tracker.setAutoFillStatus('success', 'Code "LAB" ready ✓');
          setTimeout(() => tracker.setAutoFillStatus('hidden', ''), 3000);
        }
        return;
      }

      // Step 3: Fill the input with proper React/MUI simulation
      log('📝 Filling input with LAB...');

      // Clear and focus
      input.focus();
      input.select && input.select();

      // Set value using native setter to trigger React state
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, 'LAB');

      // Dispatch events that React listens to
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Also try keyup for good measure
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      await sleep(150);

      // Step 4: Find and click Apply button
      let applyButton = null;
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        if (text === 'apply' || (text.includes('apply') && !text.includes('pay'))) {
          applyButton = btn;
          break;
        }
      }

      if (applyButton) {
        log('📍 Found Apply button, clicking...');

        // Brief wait for button to be enabled
        for (let i = 0; i < 5 && applyButton.disabled; i++) {
          await sleep(50);
        }

        if (!applyButton.disabled) {
          applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          log('✅ Clicked Apply button');
        }
      }

      autofillAttempted = true;
      autofillInProgress = false;

      log('✅ Autofill completed');

      if (tracker) {
        tracker.updateField('coupon', 'LAB');
        tracker.setAutoFillStatus('success', 'Code "LAB" applied! ✓');
        setTimeout(() => tracker.setAutoFillStatus('hidden', ''), 2000);
      }

    } catch (error) {
      log('❌ Autofill error:', error.message);
      autofillInProgress = false;
      autofillAttempted = true;
      if (tracker) tracker.setAutoFillStatus('error', 'Autofill failed');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE CHECK
  // ═══════════════════════════════════════════════════════════════════════

  function checkPage() {
    log('📄 Checking page:', window.location.pathname);

    if (isCheckoutPage()) {
      log('📦 Checkout page detected');
      showTracker();
      if (tracker) tracker.setStatus('', 'Detecting checkout data...');
      setTimeout(captureCheckout, 1000);
      // Attempt autofill quickly
      setTimeout(performAutofill, 800);
    } else if (isSelectPlanPage()) {
      log('📋 Select plan page detected');
      // Don't show tracker yet, but capture profile data
      // Profile API will be captured by network intercept
    } else if (isSuccessPage()) {
      log('🎉 Success page detected');
      showTracker();
      setTimeout(triggerSuccess, 1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // URL OBSERVER (SPA navigation)
  // ═══════════════════════════════════════════════════════════════════════

  let lastUrl = window.location.href;

  function setupUrlObserver() {
    if (!document.body) {
      setTimeout(setupUrlObserver, 100);
      return;
    }

    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        log('🔗 URL changed:', lastUrl);

        // Reset state
        hasTriggeredSuccess = false;
        purchaseCaptured = false;
        autofillAttempted = false;
        autofillInProgress = false;
        networkData.plan = null;
        networkData.lastNetworkUpdate = 0;

        setTimeout(checkPage, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DEBUG INTERFACE
  // ═══════════════════════════════════════════════════════════════════════

  window.tradeifyDebug = {
    extract: extractPurchaseData,
    network: () => networkData,
    networkLog: () => networkData.network_log,
    showNetwork: () => {
      console.log('[Tradeify] Network Data:');
      console.log('  Plan:', networkData.plan?.name);
      console.log('  Price:', networkData.plan?.price);
      console.log('  Coupon:', networkData.couponCode, networkData.couponDiscount ? networkData.couponDiscount + '%' : 'N/A');
      console.log('  Email:', networkData.email);
      console.log('  User ID:', networkData.userId);
      console.log('  Username:', networkData.username);
      console.log('  Name:', networkData.userName);
      console.log('  Phone:', networkData.phone);
      console.log('  Requests logged:', networkData.network_log.length);
      return networkData;
    },
    status: () => ({
      isCheckout: isCheckoutPage(),
      isSuccess: isSuccessPage(),
      purchaseCaptured,
      hasTriggeredSuccess,
      planLoaded: !!networkData.plan
    }),
    recheck: () => {
      purchaseCaptured = false;
      checkPage();
    },
    extractIntercom: extractIntercomData,
    autofill: () => {
      autofillAttempted = false;
      autofillInProgress = false;
      performAutofill();
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════

  function init() {
    log(`📦 Tradeify Content Script ${VERSION} loaded`);
    log('   URL:', window.location.href);
    log('   isCheckout:', isCheckoutPage());

    setupUrlObserver();

    // Try to extract Intercom data from localStorage on load
    setTimeout(() => {
      extractIntercomData();
      if (networkData.email || networkData.userId) {
        updateTrackerFromNetwork();
      }
    }, 2000);

    // Initial check after page settles
    setTimeout(checkPage, 1500);

    // Periodic re-check for late-loading data
    setInterval(() => {
      if (isCheckoutPage() && !purchaseCaptured && networkData.plan) {
        captureCheckout();
      }
      // Re-check Intercom data periodically
      if (!networkData.email) {
        extractIntercomData();
        if (networkData.email) {
          updateTrackerFromNetwork();
        }
      }
    }, 3000);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
