/**
 * MFF Content Script v2.0
 * Handles checkout capture and success detection for MyFundedFutures
 *
 * KEY FIXES (from CURSOR_MFF_ADAPTER_v2.md):
 * - MutationObserver watches for plan selection changes
 * - Re-extracts when user changes plan (React app updates)
 * - DOM-based extraction finds "Review your order" container (not regex on full page)
 * - Debounced updates (300ms) to let React finish rendering
 *
 * v2.0: Added network interception for product/price data from API
 *
 * KEY BEHAVIORS:
 * - Same URL (/challenge) for checkout AND success - detect by DOM content
 * - Coupon code NOT shown on success page - must capture on checkout
 * - ONLY track purchases where we VALIDATED the coupon code "LAB" was used
 */

(function() {
  'use strict';

  // Prevent double initialization
  if (window.__mffContentLoaded) return;
  window.__mffContentLoaded = true;

  const PARTNER = 'myfundedfutures';
  const PARTNER_NAME = 'MyFundedFutures';
  const REQUIRED_COUPON = 'LAB';
  const DEBUG = false;
  const STORAGE_KEY = 'mff_validated_coupon';
  const VERSION = 'v2.0';

  // Debounce timer for MutationObserver
  let extractionTimer = null;
  let lastExtractedDataStr = null;

  function log(...args) {
    if (DEBUG) console.log('[MFF]', ...args);
  }

  // ══════════════════════════════════════════════════════════════════════
  // NETWORK DATA (captured from mff-net-intercept.js)
  // ══════════════════════════════════════════════════════════════════════

  const networkData = {
    products: {},        // Map of price_id -> product data
    selectedPriceId: null,
    selectedProduct: null,
    couponData: null,
    lastNetworkUpdate: 0
  };

  // Listen for network events from the main world intercept script
  document.addEventListener('__pfc_mff_net', function(e) {
    try {
      const detail = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      if (!detail || !detail.type || !detail.data) return;

      const d = detail.data;

      // Process response data
      if (d.responseData) {
        processNetworkResponse(d.url, d.responseData, d.requestBody);
      }
    } catch (err) {
      log('⚠️ Error processing network event:', err);
    }
  });

  // Process network responses to extract product/pricing data
  function processNetworkResponse(url, data, requestBody) {
    if (!data || typeof data !== 'object') return;

    const urlLower = url.toLowerCase();

    // ─────────────────────────────────────────────────────────────────
    // getBusinessProducts - Product catalog with prices
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('getbusinessproducts')) {
      log('🔍 Processing getBusinessProducts response');
      if (data.ok) {
        // Parse all products and store by price_id
        for (const category of Object.values(data.ok)) {
          if (Array.isArray(category)) {
            for (const product of category) {
              if (product.price_data?.id) {
                networkData.products[product.price_data.id] = {
                  id: product.id,
                  name: product.name,
                  category: product.category,
                  account_size: product.account_size,
                  price: product.price_data.price,
                  price_id: product.price_data.id
                };
              }
            }
          }
        }
        log('✅ Loaded', Object.keys(networkData.products).length, 'products from API');
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // getCouponCheckoutInfo - Coupon validation & selected product
    // Request: {"couponCode":"LAB","price_id":78,"selected_processor":1}
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('getcouponcheckoutinfo')) {
      log('🔍 Processing getCouponCheckoutInfo response');

      // Extract price_id from request body
      if (requestBody) {
        try {
          const req = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
          if (req.price_id) {
            networkData.selectedPriceId = req.price_id;
            networkData.selectedProduct = networkData.products[req.price_id] || null;
            log('✅ Selected product price_id:', req.price_id, networkData.selectedProduct?.name);

            // Update tracker with network data
            if (networkData.selectedProduct) {
              networkData.lastNetworkUpdate = Date.now();
              updateTrackerData({
                product_name: formatProductName(networkData.selectedProduct),
                original_price: networkData.selectedProduct.price,
                account_size: networkData.selectedProduct.account_size
              });
            }
          }
        } catch (e) {}
      }

      // Extract coupon data from response
      if (data.ok) {
        networkData.couponData = data.ok;
        log('✅ Coupon data:', data.ok.code, 'discount:', data.ok.amountOff, data.ok.typeOff);
      }
      return;
    }
  }

  // Format product name nicely
  function formatProductName(product) {
    if (!product) return null;
    // Format: "Flex • $50,000" or "Rapid50K • $50,000"
    const size = product.account_size ? `$${product.account_size.toLocaleString()}` : '';
    return `${product.name} • ${size}`;
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // TRACKER UI
  // ══════════════════════════════════════════════════════════════════════
  
  let tracker = null;
  
  function getTracker() {
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      return tracker;
    }
    return tracker;
  }
  
  function initTracker() {
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
    if (data.coupon_code) {
      tracker.updateField('coupon', data.coupon_code);
    }
    if (data.order_number) {
      tracker.updateField('order_id', data.order_number);
    }
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // VALIDATED COUPON STORAGE
  // ══════════════════════════════════════════════════════════════════════
  
  let validatedCoupon = null;
  let couponValidatedAt = null;
  
  function storeValidatedCoupon(code) {
    if (!code) return;
    validatedCoupon = code.toUpperCase();
    couponValidatedAt = Date.now();
    
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        code: validatedCoupon,
        validatedAt: couponValidatedAt,
        url: window.location.href
      }));
      log('💾 Stored validated coupon:', validatedCoupon);
    } catch (e) {}
  }
  
  function getStoredValidatedCoupon() {
    if (validatedCoupon && couponValidatedAt) {
      if (Date.now() - couponValidatedAt < 30 * 60 * 1000) {
        return validatedCoupon;
      }
    }
    
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (Date.now() - data.validatedAt < 30 * 60 * 1000) {
          validatedCoupon = data.code;
          couponValidatedAt = data.validatedAt;
          return validatedCoupon;
        }
      }
    } catch (e) {}
    
    return null;
  }
  
  function clearValidatedCoupon() {
    validatedCoupon = null;
    couponValidatedAt = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // PAGE DETECTION
  // ══════════════════════════════════════════════════════════════════════
  
  function getPageType() {
    const text = document.body?.innerText || '';
    
    if (text.includes('Order number') && 
        (text.includes("You're all set") || text.includes('You purchased'))) {
      return 'success';
    }
    
    if (text.includes('Review your order') || text.includes('Apply a discount')) {
      return 'checkout';
    }
    
    return 'other';
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // DOM-BASED EXTRACTION (finds actual containers, not regex on full page)
  // This is the KEY FIX for the plan selection issue
  // ══════════════════════════════════════════════════════════════════════
  
  /**
   * Find the "Review your order" container element
   * This is the authoritative source for what's actually selected
   */
  function findOrderSummaryContainer() {
    // Strategy 1: Find heading with exact text, then get its container
    const allElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p');
    for (const el of allElements) {
      const text = el.textContent?.trim();
      if (text === 'Review your order') {
        // Found the heading, now find its parent container
        let container = el.parentElement;
        while (container && container !== document.body) {
          const containerText = container.innerText || '';
          // Valid container has Subtotal and Total
          if (containerText.includes('Subtotal') && containerText.includes('Total')) {
            // But should NOT have all the plan cards (those have many prices)
            const priceMatches = containerText.match(/\$[\d,]+/g) || [];
            // Order summary typically has 2-6 prices, plan grid has 10+
            if (priceMatches.length <= 8) {
              log('📦 Found order summary container via heading traversal');
              return container;
            }
          }
          container = container.parentElement;
        }
        // Fallback: return a few levels up
        return el.parentElement?.parentElement || el.parentElement;
      }
    }
    
    // Strategy 2: Find by class patterns
    const summarySelectors = [
      '[class*="order-summary"]',
      '[class*="orderSummary"]',
      '[class*="checkout-summary"]',
      '[class*="cart-summary"]',
      'aside',
      '[class*="sidebar"]'
    ];
    
    for (const selector of summarySelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.innerText || '';
        if (text.includes('Review your order') && text.includes('Subtotal')) {
          log('📦 Found order summary container via selector:', selector);
          return el;
        }
      }
    }
    
    log('⚠️ Could not find order summary container');
    return null;
  }
  
  /**
   * Extract product name and price from the order summary container ONLY
   */
  function extractFromOrderSummary(container) {
    if (!container) return null;
    
    const text = container.innerText || '';
    log('📋 Order summary text (first 400 chars):', text.substring(0, 400));
    
    const result = {
      product_name: null,
      original_price: null,
      final_price: null,
      discount_amount: null,
      account_size: null
    };
    
    // Extract product name: Various formats MFF uses:
    // "Flex • $50,000" or "Rapid Plan • $50,000" or "Pro100K" or "Flex 25k" or "Builder 2.0K • $50,000"
    const productMatch = text.match(/((?:Rapid|Flex|Pro|Builder|Core|Express|Standard|Elite)(?:\s*Plan)?(?:\s*[\d.]+[Kk])?)\s*[•·]\s*\$?([\d,]+)/i);
    if (productMatch) {
      const planType = productMatch[1];
      let size = parseInt(productMatch[2].replace(/,/g, ''));
      if (size < 1000) size *= 1000;
      result.product_name = `${planType} • $${size.toLocaleString()}`;
      result.account_size = size;
      log('✅ Product:', result.product_name);
    }
    
    // Extract Subtotal (original price before discount)
    const subtotalMatch = text.match(/Subtotal[\s\n]*\$?([\d,.]+)/i);
    if (subtotalMatch) {
      result.original_price = parseFloat(subtotalMatch[1].replace(/,/g, ''));
      log('✅ Subtotal:', result.original_price);
    }
    
    // Extract Discount amount
    const discountMatch = text.match(/Discount[\s\S]*?\$?([\d,.]+)/i);
    if (discountMatch) {
      result.discount_amount = parseFloat(discountMatch[1].replace(/,/g, ''));
      log('✅ Discount:', result.discount_amount);
    }
    
    // Extract Total (final price after discount)
    // Must find the Total that comes AFTER Subtotal in the text
    const subtotalIdx = text.indexOf('Subtotal');
    if (subtotalIdx !== -1) {
      const afterSubtotal = text.substring(subtotalIdx);
      // Match "Total" but not "Subtotal"
      const totalMatch = afterSubtotal.match(/(?:^|[^b])Total[\s\n]*\$?([\d,.]+)/im);
      if (totalMatch) {
        result.final_price = parseFloat(totalMatch[1].replace(/,/g, ''));
        log('✅ Total:', result.final_price);
      }
    }
    
    return result;
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // USER DATA & COUPON EXTRACTION
  // ══════════════════════════════════════════════════════════════════════
  
  function getUserData() {
    try {
      const raw = localStorage.getItem('ajs_user_traits');
      const data = raw ? JSON.parse(raw) : {};
      return {
        email: data.email || null,
        customer_name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || null
      };
    } catch (e) {
      return { email: null, customer_name: null };
    }
  }
  
  function getCouponCode() {
    // Method 1: Input field
    const inputSelectors = [
      'input[placeholder="Discount Code"]',
      'input[placeholder="Promo Code"]',
      'input[placeholder="Coupon Code"]',
      'input[name="coupon"]',
      'input[name="discount"]'
    ];
    
    for (const selector of inputSelectors) {
      const input = document.querySelector(selector);
      if (input?.value?.trim()) {
        return input.value.trim().toUpperCase();
      }
    }
    
    // Method 2: Look for applied code in text
    const text = document.body.innerText;
    if (/\bLAB\b/.test(text) && /discount|coupon|applied|saved/i.test(text)) {
      return 'LAB';
    }
    
    return null;
  }
  
  function isDiscountApplied() {
    const text = document.body.innerText;
    const match = text.match(/Discount\s*\n?\s*([^\n]+)/i);
    if (!match) return false;
    return /\$[\d,.]+/.test(match[1]);
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // MAIN EXTRACTION FUNCTION
  // ══════════════════════════════════════════════════════════════════════
  
  function extractCheckoutData() {
    const user = getUserData();

    // DOM-based extraction - find the actual order summary container
    const orderSummary = findOrderSummaryContainer();
    const summaryData = extractFromOrderSummary(orderSummary);

    // Check if we have recent network data (within last 60 seconds)
    const hasRecentNetworkData = networkData.lastNetworkUpdate &&
      (Date.now() - networkData.lastNetworkUpdate < 60000) &&
      networkData.selectedProduct;

    const data = {
      partner: PARTNER,
      email: user.email,
      customer_name: user.customer_name,
      coupon_code: getCouponCode(),
      // Prefer network data for product info (more reliable)
      product_name: hasRecentNetworkData
        ? formatProductName(networkData.selectedProduct)
        : (summaryData?.product_name || null),
      account_size: hasRecentNetworkData
        ? networkData.selectedProduct.account_size
        : (summaryData?.account_size || null),
      original_price: hasRecentNetworkData
        ? networkData.selectedProduct.price
        : (summaryData?.original_price || null),
      // Final price and discount from DOM (has coupon applied)
      final_price: summaryData?.final_price || null,
      discount_amount: summaryData?.discount_amount || null,
      order_number: null,
      checkout_url: window.location.href
    };

    if (hasRecentNetworkData) {
      log('🌐 Using network data for product:', networkData.selectedProduct.name);
    } else {
      log('📋 Using DOM data for product');
    }

    log('📊 Extracted data:', data);
    return data;
  }
  
  function extractSuccessData() {
    const user = getUserData();
    const text = document.body.innerText;
    
    const orderMatch = text.match(/Order\s*number\s*\n?\s*(ORD-[A-Za-z0-9]+)/i);
    const productMatch = text.match(/You purchased (?:a\s+)?(.+?)\s+on\s+/i);
    const subtotalMatch = text.match(/Subtotal\s*\n?\s*(?:US)?\$?([\d,.]+)/i);
    const totalMatch = text.match(/Total\s*(?:Paid)?\s*\n?\s*(?:US)?\$?([\d,.]+)/i);
    
    return {
      partner: PARTNER,
      email: user.email,
      customer_name: user.customer_name,
      order_number: orderMatch ? orderMatch[1] : null,
      product_name: productMatch ? productMatch[1].trim() : null,
      original_price: subtotalMatch ? parseFloat(subtotalMatch[1].replace(/,/g, '')) : null,
      final_price: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : null
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // CAPTURE LOGIC
  // ══════════════════════════════════════════════════════════════════════
  
  let hasTriggeredSuccess = false;
  let purchaseCaptured = false;
  
  function monitorCouponCode() {
    const currentCoupon = getCouponCode();
    const discountApplied = isDiscountApplied();
    
    if (tracker && currentCoupon) {
      tracker.updateField('coupon', currentCoupon);
    }
    
    if (currentCoupon && discountApplied) {
      if (currentCoupon === REQUIRED_COUPON) {
        storeValidatedCoupon(currentCoupon);
        log(`✅ Coupon "${currentCoupon}" validated`);
        if (tracker) tracker.showMessage('success', `✓ Coupon "${REQUIRED_COUPON}" validated!`);
      } else {
        clearValidatedCoupon();
        if (tracker) tracker.showMessage('warning', `Code "${currentCoupon}" - not trackable`);
      }
    }
  }
  
  function captureCheckout() {
    const data = extractCheckoutData();
    
    // Always update tracker UI with current data
    updateTrackerData(data);
    
    // Check if data changed (to avoid duplicate captures)
    const dataStr = JSON.stringify(data);
    if (dataStr === lastExtractedDataStr) {
      log('⏭️ Data unchanged, skipping capture');
      return;
    }
    lastExtractedDataStr = dataStr;
    
    // Validate coupon
    const liveCoupon = getCouponCode();
    const storedCoupon = getStoredValidatedCoupon();
    const couponToUse = liveCoupon || storedCoupon;
    const discountApplied = isDiscountApplied();
    
    if (!couponToUse || couponToUse !== REQUIRED_COUPON) {
      log(`⏭️ Not capturing - coupon is "${couponToUse}", need "${REQUIRED_COUPON}"`);
      return;
    }
    
    if (!discountApplied) {
      log('⏭️ Not capturing - discount not applied');
      return;
    }
    
    if (purchaseCaptured) {
      log('⏭️ Already captured this checkout');
      return;
    }
    
    // Capture!
    data.coupon_code = couponToUse;
    data.coupon_validated = true;
    
    log('✅ Capturing checkout:', data);
    if (tracker) tracker.setStatus('waiting', 'Waiting for payment...');

    let captureRetries = 0;
    const MAX_CAPTURE_RETRIES = 3;

    function sendCapture() {
      chrome.runtime.sendMessage({ action: 'CAPTURE_PURCHASE', data }, (response) => {
        if (chrome.runtime.lastError) {
          log('❌ Capture error:', chrome.runtime.lastError.message, '(attempt', captureRetries + 1 + ')');
          captureRetries++;
          if (captureRetries < MAX_CAPTURE_RETRIES) {
            log('🔄 Retrying capture in', captureRetries * 2, 'seconds...');
            setTimeout(sendCapture, captureRetries * 2000);
          } else {
            log('❌ Capture failed after', MAX_CAPTURE_RETRIES, 'attempts');
            if (tracker) tracker.setStatus('error', 'Capture failed — reload page and retry');
          }
          return;
        }
        if (response?.success) {
          purchaseCaptured = true;
          log('✅ Queued with fingerprint:', response.fingerprint);
        } else {
          log('❌ Capture returned failure:', response?.error);
          captureRetries++;
          if (captureRetries < MAX_CAPTURE_RETRIES) {
            log('🔄 Retrying capture in', captureRetries * 2, 'seconds...');
            setTimeout(sendCapture, captureRetries * 2000);
          } else {
            log('❌ Capture failed after', MAX_CAPTURE_RETRIES, 'attempts');
            if (tracker) tracker.setStatus('error', 'Capture failed — reload page and retry');
          }
        }
      });
    }

    sendCapture();
  }
  
  const SUBMITTED_ORDERS_KEY = 'pfc_mffu_submitted_orders';
  const SUBMITTED_ORDER_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

  function triggerSuccess() {
    if (hasTriggeredSuccess) return;
    hasTriggeredSuccess = true;

    const data = extractSuccessData();
    const validatedCouponCode = getStoredValidatedCoupon();

    log('🎉 Success page - Order:', data.order_number);

    updateTrackerData(data);

    if (!purchaseCaptured && !validatedCouponCode) {
      log('⚠️ Cannot submit: No validated coupon');
      return;
    }

    // Check if this order was already submitted (survives page reloads)
    if (data.order_number) {
      chrome.storage.local.get([SUBMITTED_ORDERS_KEY], (stored) => {
        const entries = stored[SUBMITTED_ORDERS_KEY] || [];
        const alreadySubmitted = entries.some(e => e.orderNumber === data.order_number);
        if (alreadySubmitted) {
          log('⏭️ Order already submitted:', data.order_number);
          if (tracker) tracker.setStatus('success', 'Purchase already tracked');
          return;
        }
        sendSuccessFlow(data, validatedCouponCode);
      });
    } else {
      sendSuccessFlow(data, validatedCouponCode);
    }
  }

  function saveSubmittedOrder(orderNumber) {
    if (!orderNumber) return;
    chrome.storage.local.get([SUBMITTED_ORDERS_KEY], (stored) => {
      const entries = stored[SUBMITTED_ORDERS_KEY] || [];
      const now = Date.now();
      // Remove entries older than 7 days
      const fresh = entries.filter(e => now - e.timestamp < SUBMITTED_ORDER_MAX_AGE);
      fresh.push({ orderNumber, timestamp: now });
      chrome.storage.local.set({ [SUBMITTED_ORDERS_KEY]: fresh });
    });
  }

  function sendSuccessFlow(data, validatedCouponCode) {
    let successRetries = 0;
    const MAX_SUCCESS_RETRIES = 5;

    const successPayload = {
      partner: PARTNER,
      order_number: data.order_number,
      email: data.email,
      coupon_code: validatedCouponCode,
      successData: data
    };

    function sendSuccess() {
      chrome.runtime.sendMessage({
        action: 'SUCCESS_DETECTED',
        data: successPayload
      }, (response) => {
        if (chrome.runtime.lastError) {
          log('❌ SUCCESS_DETECTED error:', chrome.runtime.lastError.message, '(attempt', successRetries + 1 + ')');
          successRetries++;
          if (successRetries < MAX_SUCCESS_RETRIES) {
            const delay = successRetries * 2000;
            log('🔄 Retrying SUCCESS_DETECTED in', delay / 1000, 'seconds...');
            if (tracker) tracker.setStatus('waiting', 'Submitting... (retry ' + successRetries + ')');
            setTimeout(sendSuccess, delay);
          } else {
            log('❌ SUCCESS_DETECTED failed after', MAX_SUCCESS_RETRIES, 'attempts');
            if (tracker) tracker.setStatus('error', 'Tracking failed — check extension login');
            log('💾 Saving to persistent retry storage...');
            chrome.storage.local.set({
              pfc_mffu_stuck_purchase: {
                data: successPayload,
                timestamp: Date.now(),
                retries: 0,
                order_number: data.order_number
              }
            });
          }
          return;
        }

        if (response?.success) {
          saveSubmittedOrder(data.order_number);
          clearValidatedCoupon();
          purchaseCaptured = false;

          if (tracker) {
            tracker.setStatus('success', response.skipped ? 'Already tracked' : 'Reward tracked!');
          }
        } else {
          log('❌ SUCCESS_DETECTED returned failure:', response?.error, '(attempt', successRetries + 1 + ')');
          successRetries++;
          if (successRetries < MAX_SUCCESS_RETRIES) {
            const delay = successRetries * 2000;
            log('🔄 Retrying SUCCESS_DETECTED in', delay / 1000, 'seconds...');
            if (tracker) tracker.setStatus('waiting', 'Submitting... (retry ' + successRetries + ')');
            setTimeout(sendSuccess, delay);
          } else {
            log('❌ SUCCESS_DETECTED failed after', MAX_SUCCESS_RETRIES, 'attempts — error:', response?.error);
            if (tracker) tracker.setStatus('error', response?.error || 'Tracking failed');
            log('💾 Saving to persistent retry storage...');
            chrome.storage.local.set({
              pfc_mffu_stuck_purchase: {
                data: successPayload,
                timestamp: Date.now(),
                retries: 0,
                order_number: data.order_number
              }
            });
          }
        }
      });
    }

    sendSuccess();
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // MUTATION OBSERVER - Watch for plan selection changes (THE KEY FIX)
  // ══════════════════════════════════════════════════════════════════════
  
  function setupOrderSummaryWatcher() {
    log('👀 Setting up MutationObserver for plan changes');
    
    const observer = new MutationObserver((mutations) => {
      // Debounce: Clear existing timer
      if (extractionTimer) {
        clearTimeout(extractionTimer);
      }
      
      // Check if any mutation might affect the order summary
      let shouldReExtract = false;
      
      for (const mutation of mutations) {
        const targetText = mutation.target.textContent || '';
        const isRelevant = 
          targetText.includes('Subtotal') ||
          targetText.includes('Total') ||
          targetText.includes('Plan') ||
          targetText.includes('Review your order') ||
          targetText.includes('Discount') ||
          mutation.target.querySelector?.('[class*="price"]') ||
          mutation.target.querySelector?.('[class*="plan"]') ||
          mutation.target.querySelector?.('[class*="summary"]');
        
        if (isRelevant) {
          shouldReExtract = true;
          break;
        }
        
        // Check added nodes
        for (const node of mutation.addedNodes) {
          if (node.textContent?.includes('Plan') || 
              node.textContent?.includes('Subtotal')) {
            shouldReExtract = true;
            break;
          }
        }
      }
      
      if (shouldReExtract) {
        // Debounce: Wait 300ms for React to finish rendering
        extractionTimer = setTimeout(() => {
          log('🔄 DOM changed - re-extracting data');
          checkPage();
        }, 300);
      }
    });
    
    // Watch the entire body for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    return observer;
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // CLICK LISTENER - Backup for plan card clicks
  // ══════════════════════════════════════════════════════════════════════
  
  function setupClickListener() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      
      // Check if click was on or near a plan card
      const planCard = target.closest('[class*="plan"], [class*="Plan"], [class*="card"], [class*="Card"]');
      const priceElement = target.closest('[class*="price"], [class*="Price"]');
      const hasPrice = target.textContent?.match(/\$[\d,]+/);
      
      if (planCard || priceElement || hasPrice) {
        log('🖱️ Plan-related click detected');
        // Wait for React to update
        setTimeout(checkPage, 500);
      }
      
      // Watch for Apply button clicks
      const btnText = target.textContent?.toLowerCase() || '';
      if (target.tagName === 'BUTTON' && (btnText.includes('apply') || btnText.includes('redeem'))) {
        log('🖱️ Apply button clicked');
        setTimeout(monitorCouponCode, 500);
        setTimeout(monitorCouponCode, 1000);
        setTimeout(checkPage, 1500);
      }
    }, true);
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // PAGE CHECK
  // ══════════════════════════════════════════════════════════════════════
  
  let trackerShownForSession = false;
  
  function checkPage() {
    const pageType = getPageType();
    log('📄 Page type:', pageType);
    
    if (pageType === 'checkout') {
      showTracker();
      trackerShownForSession = true;
      if (tracker) tracker.setStatus('', 'Capturing checkout data...');
      
      monitorCouponCode();
      captureCheckout();
      
    } else if (pageType === 'success') {
      showTracker();
      if (tracker) tracker.setStatus('waiting', 'Processing purchase...');
      setTimeout(triggerSuccess, 300);
    }
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // NOTIFICATION
  // ══════════════════════════════════════════════════════════════════════
  
  function showNotification(message, type = 'info') {
    if (tracker) {
      tracker.showMessage(type, message);
    }
    log(`[Notification] ${type}: ${message}`);
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // DEBUG COMMANDS
  // ══════════════════════════════════════════════════════════════════════
  
  window.mffDebug = {
    // Current extraction
    extract: () => {
      const data = extractCheckoutData();
      console.table(data);
      return data;
    },
    
    // Analyze order summary
    analyzeOrderSummary: () => {
      const container = findOrderSummaryContainer();
      if (container) {
        console.log('✅ Found order summary container:');
        console.log('Tag:', container.tagName);
        console.log('Classes:', container.className);
        console.log('Text (first 600 chars):');
        console.log(container.innerText.substring(0, 600));
        console.log('---');
        const data = extractFromOrderSummary(container);
        console.log('Extracted:');
        console.table(data);
        return data;
      } else {
        console.log('❌ Order summary container not found');
      }
    },
    
    // Force re-extraction
    reExtract: () => {
      log('🔄 Manual re-extraction');
      lastExtractedDataStr = null;
      checkPage();
    },
    
    // Page type
    pageType: getPageType,
    
    // Coupon status
    coupon: () => ({
      live: getCouponCode(),
      stored: getStoredValidatedCoupon(),
      discountApplied: isDiscountApplied()
    }),
    
    // Status
    status: () => ({
      pageType: getPageType(),
      coupon: getCouponCode(),
      discountApplied: isDiscountApplied(),
      purchaseCaptured,
      hasTriggeredSuccess
    }),

    // Export all data as JSON
    exportAll: () => {
      return JSON.stringify({
        exportTimestamp: new Date().toISOString(),
        extensionVersion: VERSION,
        url: window.location.href,
        pageType: getPageType(),
        captureStatus: {
          purchaseCaptured,
          hasTriggeredSuccess
        },
        checkoutData: extractCheckoutData(),
        successData: getPageType() === 'success' ? extractSuccessData() : null,
        coupon: {
          live: getCouponCode(),
          stored: getStoredValidatedCoupon(),
          discountApplied: isDiscountApplied()
        },
        networkData: {
          products: Object.keys(networkData.products).length,
          selectedPriceId: networkData.selectedPriceId,
          selectedProduct: networkData.selectedProduct,
          couponData: networkData.couponData,
          lastNetworkUpdate: networkData.lastNetworkUpdate
        }
      }, null, 2);
    },

    // Download full debug JSON
    download: () => {
      const data = window.mffDebug.exportAll();
      const checkoutData = extractCheckoutData();
      const orderNum = checkoutData.order_number || 'unknown';
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pfc-mffu-${orderNum}-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };
  
  // ══════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════════════
  
  function init() {
    log('🚀 MFF Content script loaded (with MutationObserver fix)');
    log('Required coupon:', REQUIRED_COUPON);

    // Setup watchers for dynamic plan changes
    setupOrderSummaryWatcher();
    setupClickListener();

    // Initial check after page settles
    setTimeout(checkPage, 500);

    // Watch for SPA navigation
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        hasTriggeredSuccess = false;
        purchaseCaptured = false;
        lastExtractedDataStr = null;
        log('🔀 URL changed, resetting state');
        setTimeout(checkPage, 1000);
      }
    }, 1000);

    // Check for stuck purchases from previous failed submissions
    chrome.storage.local.get(['pfc_mffu_stuck_purchase'], (stored) => {
      if (stored.pfc_mffu_stuck_purchase) {
        const stuck = stored.pfc_mffu_stuck_purchase;
        if (Date.now() - stuck.timestamp < 24 * 60 * 60 * 1000) { // < 24 hours old
          log('🔄 Found stuck purchase, retrying:', stuck.order_number);
          chrome.runtime.sendMessage({
            action: 'SUCCESS_DETECTED',
            data: stuck.data
          }, (response) => {
            if (!chrome.runtime.lastError && response?.success) {
              log('✅ Stuck purchase submitted successfully');
              chrome.storage.local.remove(['pfc_mffu_stuck_purchase']);
            } else {
              log('⚠️ Stuck purchase retry failed:', chrome.runtime.lastError?.message || response?.error);
            }
          });
        } else {
          log('🗑️ Removing expired stuck purchase (> 24h old)');
          chrome.storage.local.remove(['pfc_mffu_stuck_purchase']);
        }
      }
    });
  }
  
  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
