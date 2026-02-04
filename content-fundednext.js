/**
 * FUNDEDNEXT CONTENT SCRIPT v2.0
 * Queue-based capture: Captures on checkout, detects success, sends to queue engine
 * Uses shared TrackerUI to show live extraction data
 *
 * CRITICAL DISCOVERY: localStorage('purchasePlanInfo') is CLEARED after payment!
 * Solution: Capture on checkout page (where data exists), detect success separately.
 *
 * v1.2 FIX: Clear paymentProcessed after each purchase to allow multiple purchases
 * v2.0: Added network interception for order/transaction IDs (similar to TPT)
 *
 * Data Map:
 * - purchasePlanInfo.couponCode → coupon_code
 * - purchasePlanInfo.totalPrice → final_price
 * - purchasePlanInfo.plan_value → original_price
 * - purchasePlanInfo.discount_price → discount_amount
 * - purchasePlanInfo.plan_name → product_name
 * - user.email → email (backup)
 * - user.full_name → customer_name (backup)
 * - Network intercept → order_number, transaction_id (NEW)
 */

(function() {
  'use strict';

  const PARTNER = 'fundednext';
  const PARTNER_NAME = 'FundedNext';
  const DEBUG = true;
  const VERSION = 'v2.0';
  
  function log(...args) {
    if (DEBUG) console.log('[FN-Queue]', ...args);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NETWORK DATA (captured from fn-net-intercept.js)
  // ═══════════════════════════════════════════════════════════════════════

  const networkData = {
    order_number: null,
    transaction_id: null,
    payment_status: null,
    // Pricing data from network (more accurate than localStorage)
    product_name: null,
    original_price: null,
    final_price: null,
    discount_amount: null,
    network_log: [],
    lastNetworkUpdate: 0  // Timestamp of last network price update
  };

  // Listen for network events from the main world intercept script
  document.addEventListener('__pfc_fn_net', function(e) {
    try {
      const detail = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      if (!detail || !detail.type || !detail.data) return;

      const d = detail.data;

      // Log all network requests for debugging
      if (detail.type === 'fetch' || detail.type === 'xhr') {
        networkData.network_log.push({
          type: detail.type,
          url: d.url,
          method: d.method,
          status: d.status,
          time: new Date().toISOString()
        });
        // Keep only last 100
        if (networkData.network_log.length > 100) {
          networkData.network_log.splice(0, networkData.network_log.length - 100);
        }

        // Process response data for order/transaction IDs
        if (d.responseData) {
          processNetworkResponse(d.url, d.responseData, d.requestBody);
        }
      }

      // Handle payment callbacks from console.log
      if (detail.type === 'console_payment') {
        log('💳 Console payment detected:', d);
        if (d.transactionId && !networkData.transaction_id) {
          networkData.transaction_id = d.transactionId;
          log('✅ Transaction ID from console:', networkData.transaction_id);
        }
        if (d.orderId && !networkData.order_number) {
          networkData.order_number = d.orderId;
          log('✅ Order ID from console:', networkData.order_number);
        }
        if (d.result) {
          networkData.payment_status = d.result;
          if (d.result === 'APPROVED' || d.result === 'success' || d.result === 'completed') {
            log('🎉 Payment approved via console callback');
            setTimeout(checkForSuccess, 500);
          }
        }
      }

      // Handle postMessage payment events (iframe processors)
      if (detail.type === 'postmessage_payment') {
        log('💳 PostMessage payment detected:', d);
        if (d.transactionId && !networkData.transaction_id) {
          networkData.transaction_id = d.transactionId;
          log('✅ Transaction ID from postMessage:', networkData.transaction_id);
        }
        if (d.orderId && !networkData.order_number) {
          networkData.order_number = d.orderId;
          log('✅ Order ID from postMessage:', networkData.order_number);
        }
        if (d.result === 'succeeded' || d.result === 'APPROVED' || d.result === 'completed') {
          log('🎉 Payment approved via postMessage');
          setTimeout(checkForSuccess, 500);
        }
      }

    } catch (err) {
      log('⚠️ Error processing network event:', err);
    }
  });

  // Process network responses to extract order/transaction IDs
  function processNetworkResponse(url, data, requestBody) {
    if (!data || typeof data !== 'object') return;

    const urlLower = url.toLowerCase();

    // ─────────────────────────────────────────────────────────────────
    // FundedNext-specific: product-order endpoint returns gateway_order_id
    // Response: {"message":"success","data":{"gateway_order_id":"BP_xxx",...}}
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('product-order')) {
      log('🔍 Processing product-order response:', url);

      if (data.data?.gateway_order_id && !networkData.order_number) {
        networkData.order_number = String(data.data.gateway_order_id);
        log('✅ Order number from product-order:', networkData.order_number);
        updateTrackerData({ order_number: networkData.order_number });
      }

      if (data.data?.client_secret) {
        networkData.client_secret = data.data.client_secret;
        log('📋 Client secret captured');
      }

      if (data.message === 'success') {
        networkData.payment_status = 'order_created';
        log('✅ Product order created successfully');
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // FundedNext-specific: coupon-check endpoint
    // Response: {"message":"Coupon applied successfully!","data":{"final_amounts":{"old_amount":99.99,"coupon_amount":9.99,"payable_amount":89.99}}}
    // URL contains plan_id param: coupon-check?plan_id=81&...
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('coupon-check')) {
      log('🔍 Processing coupon-check response:', data);

      // Get plan ID from current URL and request URL
      const currentPlanId = window.location.pathname.match(/\/checkout\/(\d+)/)?.[1];
      const requestPlanId = url.match(/plan_id=(\d+)/)?.[1];

      log('📋 Plan IDs - URL:', currentPlanId, 'Request:', requestPlanId);

      // Only update if plan ID matches current URL (ignore stale responses)
      if (currentPlanId && requestPlanId && currentPlanId !== requestPlanId) {
        log('⚠️ Ignoring stale coupon-check response for plan', requestPlanId, '(current:', currentPlanId, ')');
        return;
      }

      if (data.data?.final_amounts) {
        const amounts = data.data.final_amounts;
        // Store in networkData so it persists and isn't overwritten by localStorage
        if (amounts.old_amount) networkData.original_price = amounts.old_amount;
        if (amounts.payable_amount) networkData.final_price = amounts.payable_amount;
        if (amounts.coupon_amount) networkData.discount_amount = amounts.coupon_amount;
        networkData.lastNetworkUpdate = Date.now();
        log('✅ Prices from coupon-check:', { original: networkData.original_price, final: networkData.final_price });
        updateTrackerData({
          original_price: networkData.original_price,
          final_price: networkData.final_price,
          discount_amount: networkData.discount_amount
        });
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // FundedNext-specific: calculate-challenge-price endpoint
    // Response: {"message":"price details","data":{"payable_amount":199.99,"plan_price":199.99,"plan":{...}}}
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('calculate-challenge-price')) {
      log('🔍 Processing calculate-challenge-price response:', data);
      if (data.data) {
        // Get plan ID from URL to check if this is for the current product
        const currentPlanId = window.location.pathname.match(/\/checkout\/(\d+)/)?.[1];
        const responsePlanId = data.data.plan?.id?.toString();

        log('📋 Plan IDs - URL:', currentPlanId, 'Response:', responsePlanId);

        // Only update if plan ID matches current URL (ignore stale responses)
        if (currentPlanId && responsePlanId && currentPlanId !== responsePlanId) {
          log('⚠️ Ignoring stale calculate-challenge-price response for plan', responsePlanId, '(current:', currentPlanId, ')');
          return;
        }

        // Store in networkData so it persists and isn't overwritten by localStorage
        if (data.data.payable_amount) networkData.final_price = data.data.payable_amount;
        if (data.data.plan_price) networkData.original_price = data.data.plan_price;
        if (data.data.plan?.name) networkData.product_name = data.data.plan.name;
        networkData.lastNetworkUpdate = Date.now();
        log('✅ Prices from calculate-challenge-price:', { product: networkData.product_name, original: networkData.original_price, final: networkData.final_price });
        updateTrackerData({
          product_name: networkData.product_name,
          original_price: networkData.original_price,
          final_price: networkData.final_price
        });
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // FundedNext-specific: dynamic-checkout endpoint
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('coupon/v2') || urlLower.includes('dynamic-checkout')) {
      log('🔍 Processing dynamic-checkout response:', url);
      // Trigger a re-check of localStorage data with force update
      setTimeout(() => checkAndCapture(true), 300);
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Generic fallback for other checkout/payment endpoints
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('checkout') ||
        urlLower.includes('order') ||
        urlLower.includes('payment') ||
        urlLower.includes('purchase') ||
        urlLower.includes('subscription') ||
        urlLower.includes('transaction')) {

      log('🔍 Processing potential payment endpoint:', url);

      // Search for order ID - FundedNext specific keys first
      const orderKeys = ['gateway_order_id', 'order_id', 'orderId', 'order_number', 'orderNumber',
                         'checkout_id', 'checkoutId', 'purchase_id', 'purchaseId',
                         'reference', 'ref', 'invoice_id', 'invoiceId'];
      for (const key of orderKeys) {
        if (data[key] && !networkData.order_number) {
          networkData.order_number = String(data[key]);
          log('✅ Order number from network:', networkData.order_number, '(key:', key, ')');
          updateTrackerData({ order_number: networkData.order_number });
          break;
        }
        // Check nested data object (FundedNext uses data.xxx pattern)
        if (data.data && data.data[key] && !networkData.order_number) {
          networkData.order_number = String(data.data[key]);
          log('✅ Order number from network (data.xxx):', networkData.order_number);
          updateTrackerData({ order_number: networkData.order_number });
          break;
        }
      }

      // Search for transaction ID
      const txKeys = ['transaction_id', 'transactionId', 'tx_id', 'txId',
                      'payment_id', 'paymentId', 'charge_id', 'chargeId', 'client_secret'];
      for (const key of txKeys) {
        if (data[key] && !networkData.transaction_id) {
          networkData.transaction_id = String(data[key]);
          log('✅ Transaction ID from network:', networkData.transaction_id, '(key:', key, ')');
          break;
        }
        if (data.data && data.data[key] && !networkData.transaction_id) {
          networkData.transaction_id = String(data.data[key]);
          log('✅ Transaction ID from network (data.xxx):', networkData.transaction_id);
          break;
        }
      }

      // Check for payment success status
      if (data.message === 'success' || data.status === 'success' ||
          data.status === 'completed' || data.success === true) {
        networkData.payment_status = data.message || data.status || 'success';
        log('✅ Payment success detected via network');
      }
    }
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
      fields: ['coupon', 'product', 'price', 'email', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        order_id: 'Order ID'
      },
      afterPurchaseFields: ['order_id']
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
    if (data.order_number) {
      tracker.updateField('order_id', data.order_number);
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
      // Use network data if available (it's more accurate and up-to-date)
      product_name: networkData.product_name || null,
      original_price: networkData.original_price || null,
      final_price: networkData.final_price || null,
      discount_amount: networkData.discount_amount || null,
      coupon_code: null,
      order_number: networkData.order_number || null,  // From network intercept
      transaction_id: networkData.transaction_id || null,  // From network intercept
      plan_id: null,
      checkout_url: window.location.href
    };

    // Track if we have recent network data (within last 30 seconds)
    const hasRecentNetworkData = networkData.lastNetworkUpdate &&
      (Date.now() - networkData.lastNetworkUpdate < 30000);
    
    // ─────────────────────────────────────────────────────────────────
    // PRIMARY: purchasePlanInfo (ONLY exists on checkout page!)
    // Only use as FALLBACK if network data isn't available
    // ─────────────────────────────────────────────────────────────────
    try {
      const ppiRaw = localStorage.getItem('purchasePlanInfo');
      if (ppiRaw) {
        const ppi = JSON.parse(ppiRaw);

        // Always get coupon, email, customer from localStorage
        data.coupon_code = ppi.couponCode || ppi.coupon || null;
        data.email = ppi.email || null;
        data.plan_id = ppi.plan_id || ppi.id || null;

        if (ppi.personalInfo) {
          data.email = data.email || ppi.personalInfo.email;
          const firstName = ppi.personalInfo.firstName || '';
          const lastName = ppi.personalInfo.lastName || '';
          data.customer_name = `${firstName} ${lastName}`.trim() || null;
        }

        // Only use localStorage for pricing/product if NO recent network data
        if (!hasRecentNetworkData) {
          if (!data.final_price) data.final_price = ppi.totalPrice || null;
          if (!data.original_price) data.original_price = ppi.plan_value || null;
          if (!data.discount_amount) data.discount_amount = ppi.discount_price || null;
          if (!data.product_name) data.product_name = ppi.plan_name || ppi.name || null;

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

          log('📋 Using localStorage data (no recent network data)');
        } else {
          log('🌐 Using network data (more recent than localStorage)');
        }

        log('✅ Extracted data:', data);
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

            // Clear network data for next purchase
            networkData.order_number = null;
            networkData.transaction_id = null;
            networkData.payment_status = null;

            // Clear tracker fields for next purchase
            if (tracker) {
              tracker.clearField('product');
              tracker.clearField('price');
              tracker.clearField('coupon');
              tracker.clearField('order_id');
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

    // Clear network data so new product data can be captured
    networkData.product_name = null;
    networkData.original_price = null;
    networkData.final_price = null;
    networkData.discount_amount = null;
    networkData.order_number = null;
    networkData.transaction_id = null;
    networkData.lastNetworkUpdate = 0;

    // Clear paymentProcessed to allow detection of next purchase
    if (localStorage.getItem('paymentProcessed') === 'true') {
      log('🧹 Clearing paymentProcessed for next purchase');
      localStorage.removeItem('paymentProcessed');
      lastPaymentProcessedState = false;
    }
  }
  
  function checkAndCapture(forceUpdate = false) {
    // Debounce - but allow forced updates from network responses
    if (!forceUpdate && Date.now() - lastCaptureTime < 2000) return;

    if (isCheckoutPage()) {
      // Show tracker on checkout
      showTracker();

      // Always extract and update tracker data
      const data = extractPurchaseData();
      updateTrackerData(data);

      if (localStorage.getItem('purchasePlanInfo')) {
        capturePurchase();
        lastCaptureTime = Date.now();
      } else {
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
  
  // Watch URL changes (SPA) - setup after body is ready
  let lastUrl = window.location.href;
  let urlObserver = null;

  function setupUrlObserver() {
    if (urlObserver) return; // Already set up
    if (!document.body) {
      // Body not ready, retry later
      setTimeout(setupUrlObserver, 100);
      return;
    }

    try {
      urlObserver = new MutationObserver(() => {
        try {
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
        } catch (e) {
          // Extension context may be invalidated
        }
      });

      urlObserver.observe(document.body, { childList: true, subtree: true });
      log('🔍 URL observer initialized');
    } catch (e) {
      log('⚠️ Failed to setup URL observer:', e.message);
    }
  }

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
    },
    // Network data debug
    network: () => networkData,
    networkLog: () => networkData.network_log,
    showNetwork: () => {
      console.log('[FN-Queue] Network Data:');
      console.log('  Order Number:', networkData.order_number);
      console.log('  Transaction ID:', networkData.transaction_id);
      console.log('  Payment Status:', networkData.payment_status);
      console.log('  Requests logged:', networkData.network_log.length);
      return networkData;
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

  // Setup URL observer (will wait for body if needed)
  setupUrlObserver();

  setTimeout(() => {
    checkAndCapture();
    checkForSuccess();
  }, 1000);

  window.addEventListener('load', () => {
    // Ensure observer is set up after load
    setupUrlObserver();
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
