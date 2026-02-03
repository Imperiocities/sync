/**
 * TAKEPROFITTRADER ADAPTER v6.0
 *
 * Enhanced Staged Capture with comprehensive tracking.
 * Captures metadata, all network requests, event timeline, storage/DOM snapshots.
 *
 * Supports TWO purchase flows:
 *
 * 1. NEW ACCOUNT PURCHASE (checkout modal)
 *    - Captures via checkout modal (.account-flow-modal) + fallback detection
 *    - Supports coupon code autofill
 *    - Waits for /Accounts/pending API for account_id
 *
 * 2. ACCOUNT RESET (control center page)
 *    - Triggered by RESET button click on existing account
 *    - Account ID captured from clicked row
 *    - NO coupon codes (not supported for resets)
 *    - Submits immediately on nuveiResponse APPROVED
 *
 * DATA CAPTURE - NEW PURCHASE:
 * | Stage | Trigger                  | Data Captured                              |
 * |-------|--------------------------|---------------------------------------------|
 * | 1     | Page load                | email, name, user_id (JWT cookie)          |
 * | 2     | Page load                | product_name, original_price (localStorage)|
 * | 3     | Page load                | coupon_code (localStorage)                 |
 * | 4     | Pricing modal visible    | discount_percent, final_price (DOM)        |
 * | 5     | `nuveiResponse APPROVED` | Validate all data present                  |
 * | 6     | /Accounts/pending API    | account_id (Network intercept)             |
 * | 7     | All complete             | Push to API with _enriched envelope        |
 *
 * DATA CAPTURE - RESET:
 * | Stage | Trigger                  | Data Captured                              |
 * |-------|--------------------------|---------------------------------------------|
 * | 1     | RESET button click       | account_id, product_name, price (from row) |
 * | 2     | `nuveiResponse APPROVED` | transaction_id                             |
 * | 3     | Immediate                | Push to API with _enriched envelope        |
 */

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK INTERCEPTION - MUST BE FIRST!
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // Prevent double initialization
  if (window.__tptAdapterV5Installed) return;
  window.__tptAdapterV5Installed = true;

  const originalLog = console.log;
  const PARTNER = 'takeprofittrader';
  const ADAPTER_VERSION = '6.0';
  const DEV_SKIP_EMAIL_CHECK = true;  // TEMPORARY: bypass extension email validation for testing

  // Product mapping for TPT subscription IDs
  const TPT_PRODUCTS = {
    2: { name: '25K', price: 150 },
    3: { name: '50K', price: 170 },
    4: { name: '75K', price: 245 },
    5: { name: '100K', price: 330 },
    6: { name: '150K', price: 360 }
  };

  function getProduct(subscriptionId) {
    const id = parseInt(subscriptionId, 10);
    if (TPT_PRODUCTS[id]) return TPT_PRODUCTS[id];
    addEvent('unknown_product_id', `Subscription ID ${id} not in product map`);
    logError('unknown_product', new Error(`Unknown subscription ID: ${id}`));
    return { name: `Unknown-${id}`, price: null };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PURCHASE DATA STATE
  // ═══════════════════════════════════════════════════════════════════

  const purchaseData = {
    email: null,
    customer_name: null,
    user_id: null,
    product_name: null,
    original_price: null,
    discount_percent: null,
    final_price: null,
    coupon_code: null,
    account_id: null,
    transaction_id: null,
    platform: null,
    purchase_type: 'new'  // 'new' for new account, 'reset' for account reset
  };

  // Reset pricing - flat $100 for all account sizes
  const RESET_PRICE = 100;

  let captureStatus = 'initializing';
  let tracker = null;
  let lastSeenAccountSizeId = null;
  let couponConfirmed = false;  // Only true after network confirms promo code applied
  let previousFirstAccountId = null;  // The first account ID BEFORE purchase (to detect new one)
  let watchingForNewAccount = false;  // True after payment success, waiting for new account in DOM
  let resetFlowActive = false;  // True when user clicked RESET button
  let submissionRetryCount = 0;
  let finalSubmissionTimeout = null;
  let purchaseResetPending = false;

  // ═══════════════════════════════════════════════════════════════════
  // TRACKING DATA STRUCTURES
  // ═══════════════════════════════════════════════════════════════════

  // A1: Session Context - browser/device metadata captured at page load
  const sessionContext = {
    session_id: 'tpt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
    adapter_version: ADAPTER_VERSION,
    started_at: new Date().toISOString(),
    started_timestamp: Date.now(),
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: [...(navigator.languages || [])],
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelRatio: window.devicePixelRatio || 1
      },
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: new Date().getTimezoneOffset()
    },
    page: {
      url: window.location.href,
      pathname: window.location.pathname,
      referrer: document.referrer,
      title: document.title
    }
  };

  // A2: Event Timeline
  const eventTimeline = [];

  function addEvent(type, detail, data) {
    const entry = {
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      elapsed_ms: Date.now() - sessionContext.started_timestamp,
      type: type,
      detail: detail
    };
    if (data !== undefined && data !== null) entry.data = data;
    eventTimeline.push(entry);
    if (eventTimeline.length > 500) eventTimeline.splice(0, eventTimeline.length - 500);
    originalLog.call(console, `[TPT] [EVENT] ${type}: ${detail}`);
  }

  // A3: Network Log
  const networkLog = [];
  const SENSITIVE_PATTERNS = /password|token|secret|authorization|cookie|ssn|social|card.?number|cvv|cvc|expir|access_token/i;
  const MAX_BODY_LENGTH = 2000;

  function sanitizeObject(obj, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 3 || !obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.slice(0, 10).map(function(item) { return sanitizeObject(item, depth + 1); });
    var result = {};
    for (var key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      if (SENSITIVE_PATTERNS.test(key)) {
        result[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        result[key] = sanitizeObject(obj[key], depth + 1);
      } else {
        result[key] = obj[key];
      }
    }
    return result;
  }

  function truncateBody(obj) {
    var str = JSON.stringify(obj);
    if (str.length <= MAX_BODY_LENGTH) return obj;
    return { _truncated: true, _length: str.length, _preview: str.substring(0, MAX_BODY_LENGTH) };
  }

  function summarizeResponse(data) {
    var summary = { isSuccess: data?.isSuccess };
    if (data?.result !== undefined) {
      summary.result_type = typeof data.result;
      if (typeof data.result === 'number' || typeof data.result === 'string') {
        summary.result_value = data.result;
      }
    }
    if (data?.message) summary.message = String(data.message).substring(0, 200);
    if (data?.error) summary.error = String(data.error).substring(0, 200);
    return summary;
  }

  function logNetworkRequest(url, method, status, requestBody, responseData, error, startTime) {
    var urlPath = url.split('?')[0];
    try { urlPath = urlPath.replace(/https?:\/\/[^/]+/, ''); } catch (e) { /* keep full */ }

    var sanitizedReqBody = null;
    try {
      if (requestBody) sanitizedReqBody = truncateBody(sanitizeObject(JSON.parse(typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody))));
    } catch (e) { /* not JSON */ }

    var entry = {
      timestamp: Date.now(),
      elapsed_ms: Date.now() - sessionContext.started_timestamp,
      duration_ms: startTime ? Date.now() - startTime : null,
      method: method || 'GET',
      url_path: urlPath,
      status: status,
      request_body: sanitizedReqBody,
      response_summary: responseData ? summarizeResponse(responseData) : null,
      error: error ? (error.message || String(error)) : null
    };

    networkLog.push(entry);
    if (networkLog.length > 200) networkLog.splice(0, networkLog.length - 200);
  }

  // A4: Price Change History
  const priceHistory = [];

  function recordPriceChange(source, originalPrice, finalPrice, discountPercent, couponCode) {
    priceHistory.push({
      timestamp: Date.now(),
      elapsed_ms: Date.now() - sessionContext.started_timestamp,
      source: source,
      original_price: originalPrice,
      final_price: finalPrice,
      discount_percent: discountPercent,
      coupon_code: couponCode
    });
  }

  // A5: Error Log
  const errorLog = [];

  function logError(context, error, extra) {
    var entry = {
      timestamp: Date.now(),
      elapsed_ms: Date.now() - sessionContext.started_timestamp,
      context: context,
      message: error?.message || String(error),
      stack: error?.stack ? error.stack.split('\n').slice(0, 3).join('\n') : null
    };
    if (extra) entry.extra = extra;
    errorLog.push(entry);
    if (errorLog.length > 100) errorLog.splice(0, errorLog.length - 100);
    originalLog.call(console, `[TPT] [ERROR] ${context}:`, error?.message || error);
  }

  // D1: Storage Snapshot
  function captureStorageSnapshot() {
    var snapshot = { timestamp: Date.now() };
    var relevantKeys = [
      'selectedAccountSizeId', 'urlReferralCode', 'accountSize',
      '__pfc_previous_account_id', '__pfc_checkout_started'
    ];

    snapshot.localStorage = {};
    for (var i = 0; i < relevantKeys.length; i++) {
      try {
        var val = localStorage.getItem(relevantKeys[i]);
        if (val !== null) snapshot.localStorage[relevantKeys[i]] = val.substring(0, 500);
      } catch (e) { /* ignore */ }
    }

    snapshot.sessionStorage = {};
    try {
      for (var j = 0; j < sessionStorage.length; j++) {
        var key = sessionStorage.key(j);
        if (key && !SENSITIVE_PATTERNS.test(key)) {
          snapshot.sessionStorage[key] = (sessionStorage.getItem(key) || '').substring(0, 500);
        }
      }
    } catch (e) { /* ignore */ }

    snapshot.cookieNames = document.cookie
      .split(';')
      .map(function(c) { return c.trim().split('=')[0]; })
      .filter(Boolean);

    return snapshot;
  }

  // D2: DOM State Snapshot
  function captureDOMSnapshot(context) {
    var snapshot = {
      timestamp: Date.now(),
      context: context,
      url: window.location.href,
      pathname: window.location.pathname
    };

    var modal = document.querySelector('.account-flow-modal');
    if (modal) {
      snapshot.modal = {
        exists: true,
        innerText_length: (modal.innerText || '').length,
        visiblePrice: extractTextNear(modal, 'Total'),
        visibleDiscount: extractTextNear(modal, 'Discount'),
        visibleAmount: extractTextNear(modal, 'Amount'),
        promoInputValue: (modal.querySelector('input[name="code"]') || {}).value || null,
        promoInputVisible: !!(modal.querySelector('input[name="code"]') || {}).offsetParent
      };
    } else {
      snapshot.modal = { exists: false };
    }

    var accounts = document.querySelectorAll('app-test-subscription-record');
    if (accounts.length > 0) {
      snapshot.accounts_visible = accounts.length;
      var firstLink = accounts[0].querySelector('a[href*="/control-center/"]');
      snapshot.first_account_href = firstLink ? firstLink.getAttribute('href') : null;
    }

    return snapshot;
  }

  function extractTextNear(container, label) {
    var text = container.innerText || '';
    var idx = text.indexOf(label);
    if (idx === -1) return null;
    return text.substring(idx, Math.min(idx + 50, text.length)).replace(/\n/g, ' ').trim();
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE PERSISTENCE (chrome.storage for PayPal redirects)
  // ═══════════════════════════════════════════════════════════════════

  function persistPurchaseState() {
    try {
      chrome.storage.local.set({
        '__tpt_purchase_state': {
          purchaseData: Object.assign({}, purchaseData),
          couponConfirmed: couponConfirmed,
          resetFlowActive: resetFlowActive,
          previousFirstAccountId: previousFirstAccountId,
          timestamp: Date.now()
        }
      });
    } catch (e) { /* ignore */ }
  }

  function restorePurchaseState() {
    return new Promise(function(resolve) {
      try {
        chrome.storage.local.get(['__tpt_purchase_state'], function(result) {
          var state = result.__tpt_purchase_state;
          if (state && (Date.now() - state.timestamp) < 30 * 60 * 1000) {
            // Only restore fields that haven't been freshly captured
            // (captureUser/captureProduct may have already run before this async callback)
            var saved = state.purchaseData;
            for (var key in saved) {
              if (saved.hasOwnProperty(key) && saved[key] != null && (purchaseData[key] == null || purchaseData[key] === '')) {
                purchaseData[key] = saved[key];
              }
            }
            couponConfirmed = state.couponConfirmed;
            resetFlowActive = state.resetFlowActive;
            previousFirstAccountId = state.previousFirstAccountId;
            addEvent('state_restored', 'Purchase state restored from chrome.storage', {
              age_seconds: Math.round((Date.now() - state.timestamp) / 1000)
            });
            resolve(true);
          } else {
            resolve(false);
          }
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  function clearPersistedState() {
    try {
      chrome.storage.local.remove(['__tpt_purchase_state']);
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // NETWORK INTERCEPTION (Main World Bridge)
  // The actual fetch/XHR/console.log overrides run in tpt-net-intercept.js
  // which is loaded via manifest.json with "world": "MAIN". That script
  // dispatches CustomEvent('__pfc_net') on the document. We listen here.
  // ═══════════════════════════════════════════════════════════════════

  document.addEventListener('__pfc_net', function(e) {
    try {
      var detail;
      try { detail = JSON.parse(e.detail); } catch(ex) { detail = e.detail; }
      if (!detail || !detail.type || !detail.data) return;
      var d = detail.data;

      if (detail.type === 'fetch' || detail.type === 'xhr') {
        // Parse request body if string
        var reqBodyParsed = null;
        try { if (d.requestBody) reqBodyParsed = JSON.parse(d.requestBody); } catch(ex) {}

        // Log the network request
        logNetworkRequest(d.url, d.method, d.status, d.requestBody, d.responseData, d.error ? new Error(d.error) : null, d.startTime);

        // Process key endpoints
        if (d.responseData) {
          var options = reqBodyParsed ? { body: d.requestBody } : null;
          if (detail.type === 'fetch') {
            processInterceptedRequest(d.url, options, d.responseData).catch(function(err) {
              logError('fetch_process', err, { url: d.url.split('?')[0] });
            });
          } else {
            processInterceptedXHR(d.url, d.requestBody, d.responseData).catch(function(err) {
              logError('xhr_process', err, { url: d.url.split('?')[0] });
            });
          }
        }
      } else if (detail.type === 'console_payment') {
        // Nuvei payment callback detected in main world
        if (d.result === 'APPROVED' && d.transactionId) {
          if (!purchaseData.transaction_id) {
            purchaseData.transaction_id = d.transactionId;
            addEvent('payment_approved_console', 'Payment approved via console.log (main world)', {
              transaction_id: d.transactionId
            });
            var t = tracker || window.__pfcTracker;
            if (t) {
              var message = resetFlowActive ? 'Reset payment approved!' : 'Payment approved!';
              t.showMessage('success', message);
            }
            persistPurchaseState();
            scheduleFinalSubmission();
            if (resetFlowActive && purchaseData.account_id) {
              submitPurchase();
            } else {
              setTimeout(function() {
                if (captureStatus !== 'success') {
                  addEvent('submission_fallback', 'Attempting submission via console.log fallback (3s delay)');
                  submitPurchase();
                }
              }, 3000);
            }
          }
        } else if (d.result && d.result !== 'APPROVED') {
          addEvent('payment_declined_console', 'Payment result: ' + d.result, { result: d.result });
        }
      }
    } catch (err) {
      logError('net_event_handler', err);
    }
  });

  addEvent('adapter_init', 'Network interception installed (main world injection)');

  async function processInterceptedRequest(url, options, data) {
    try {
      const body = options?.body ? JSON.parse(options.body) : null;
      const urlLower = url.toLowerCase();

      // ─────────────────────────────────────────────────────────────────────
      // PROMO CODE VALIDATION - This confirms the coupon is actually applied!
      // ─────────────────────────────────────────────────────────────────────
      if (urlLower.includes('/promocodes/validate') && data?.isSuccess) {
        purchaseData.coupon_code = body?.code || null;
        purchaseData.original_price = body?.amount || null;
        purchaseData.discount_percent = data.result?.discount || null;
        purchaseData.final_price = data.result?.total || null;

        // NOW the coupon is confirmed as applied
        couponConfirmed = true;

        originalLog.call(console, '[TPT] Promo CONFIRMED:', purchaseData.coupon_code);
        originalLog.call(console, '[TPT]    Original:', purchaseData.original_price);
        originalLog.call(console, '[TPT]    Discount:', purchaseData.discount_percent + '%');
        originalLog.call(console, '[TPT]    Final:', purchaseData.final_price);

        addEvent('coupon_confirmed', `Promo ${purchaseData.coupon_code} confirmed: ${purchaseData.discount_percent}% off`, {
          coupon_code: purchaseData.coupon_code,
          original_price: purchaseData.original_price,
          discount_percent: purchaseData.discount_percent,
          final_price: purchaseData.final_price
        });

        recordPriceChange('network_promo', purchaseData.original_price, purchaseData.final_price, purchaseData.discount_percent, purchaseData.coupon_code);
        persistPurchaseState();
        updateTrackerUI();
        setStatus('waiting', 'Discount applied');
      }

      // PROMO VALIDATION FAILED
      else if (urlLower.includes('/promocodes/validate') && !data?.isSuccess) {
        addEvent('coupon_failed', 'Promo code validation failed', {
          code: body?.code,
          error: data?.message || data?.error
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // ACCOUNT PENDING (product selected, account created) - KEY FOR ACCOUNT ID!
      // ─────────────────────────────────────────────────────────────────────
      else if (urlLower.includes('/accounts/pending') && data?.isSuccess) {
        const subId = body?.SubscriptionId;
        const product = getProduct(subId);

        purchaseData.product_name = product.name;
        purchaseData.account_id = String(data.result);  // THIS IS THE CORRECT ACCOUNT ID!
        purchaseData.platform = body?.PlatformType === 1 ? 'CQG' : 'Rithmic';

        // Set original price if not already set by promo validation
        if (!purchaseData.original_price && product.price) {
          purchaseData.original_price = product.price;
        }

        originalLog.call(console, '[TPT] Account created:', purchaseData.account_id);
        originalLog.call(console, '[TPT]    Product:', purchaseData.product_name);
        originalLog.call(console, '[TPT]    Platform:', purchaseData.platform);

        addEvent('account_created', `Account ${purchaseData.account_id} created: ${purchaseData.product_name} (${purchaseData.platform})`, {
          account_id: purchaseData.account_id,
          product_name: purchaseData.product_name,
          platform: purchaseData.platform,
          subscription_id: subId
        });

        persistPurchaseState();
        updateTrackerUI();
      }

      // ─────────────────────────────────────────────────────────────────────
      // SUBSCRIPTION SUCCESS - PURCHASE COMPLETE!
      // ─────────────────────────────────────────────────────────────────────
      else if (urlLower.includes('/subscriptions/nuvei') && data?.isSuccess) {
        purchaseData.transaction_id = body?.transactionId || null;

        // Fallback: get account_id from request if we missed /Accounts/pending
        if (!purchaseData.account_id && body?.info?.accountId) {
          purchaseData.account_id = String(body.info.accountId);
        }

        originalLog.call(console, '[TPT] PURCHASE COMPLETE (Network)!');
        originalLog.call(console, '[TPT]    Order (account_id):', purchaseData.account_id);
        originalLog.call(console, '[TPT]    Transaction:', purchaseData.transaction_id);

        addEvent('payment_complete_network', 'Purchase confirmed via /subscriptions/nuvei', {
          account_id: purchaseData.account_id,
          transaction_id: purchaseData.transaction_id
        });

        persistPurchaseState();
        scheduleFinalSubmission();

        // If we have account_id, submit immediately
        if (purchaseData.account_id) {
          submitPurchase();
        } else {
          // Otherwise, start watching for new account in DOM
          originalLog.call(console, '[TPT] No account_id yet, watching DOM for new account...');
          startWatchingForNewAccount();
        }
      }

      // SUBSCRIPTION FAILED
      else if (urlLower.includes('/subscriptions/nuvei') && !data?.isSuccess) {
        addEvent('payment_declined', 'Payment attempt failed via network', {
          error: data?.message || data?.error || 'Unknown error',
          code: data?.errorCode || data?.code || null
        });
        logError('payment_declined', new Error(data?.message || 'Payment declined'));
      }

    } catch (e) {
      // Log errors for key endpoints instead of silently swallowing
      var urlLower = url.toLowerCase();
      if (urlLower.includes('/promocodes/') || urlLower.includes('/accounts/') || urlLower.includes('/subscriptions/')) {
        logError('fetch_intercept', e, { url: url.split('?')[0] });
      }
    }
  }

  async function processInterceptedXHR(url, requestBody, data) {
    try {
      const body = requestBody ? JSON.parse(typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)) : null;
      const urlLower = url.toLowerCase();

      // PROMO VALIDATION - Confirms coupon is applied
      if (urlLower.includes('/promocodes/validate') && data?.isSuccess) {
        purchaseData.coupon_code = body?.code || null;
        purchaseData.original_price = body?.amount || null;
        purchaseData.discount_percent = data.result?.discount || null;
        purchaseData.final_price = data.result?.total || null;
        couponConfirmed = true;

        originalLog.call(console, '[TPT] Promo CONFIRMED (XHR):', purchaseData.coupon_code);
        addEvent('coupon_confirmed', `Promo ${purchaseData.coupon_code} confirmed (XHR)`, {
          coupon_code: purchaseData.coupon_code,
          discount_percent: purchaseData.discount_percent,
          final_price: purchaseData.final_price
        });
        recordPriceChange('xhr_promo', purchaseData.original_price, purchaseData.final_price, purchaseData.discount_percent, purchaseData.coupon_code);
        persistPurchaseState();
        updateTrackerUI();
        setStatus('waiting', 'Discount applied');
      }

      // ACCOUNT PENDING - KEY FOR ACCOUNT ID!
      else if (urlLower.includes('/accounts/pending') && data?.isSuccess) {
        const subId = body?.SubscriptionId;
        const product = getProduct(subId);

        purchaseData.product_name = product.name;
        purchaseData.account_id = String(data.result);
        purchaseData.platform = body?.PlatformType === 1 ? 'CQG' : 'Rithmic';

        if (!purchaseData.original_price && product.price) {
          purchaseData.original_price = product.price;
        }

        originalLog.call(console, '[TPT] Account created (XHR):', purchaseData.account_id);
        addEvent('account_created', `Account ${purchaseData.account_id} created (XHR)`, {
          account_id: purchaseData.account_id,
          product_name: purchaseData.product_name,
          platform: purchaseData.platform
        });
        persistPurchaseState();
        updateTrackerUI();
      }

      // SUBSCRIPTION SUCCESS
      else if (urlLower.includes('/subscriptions/nuvei') && data?.isSuccess) {
        purchaseData.transaction_id = body?.transactionId || null;

        if (!purchaseData.account_id && body?.info?.accountId) {
          purchaseData.account_id = String(body.info.accountId);
        }

        originalLog.call(console, '[TPT] PURCHASE COMPLETE (XHR)!');
        addEvent('payment_complete_network', 'Purchase confirmed via XHR', {
          account_id: purchaseData.account_id,
          transaction_id: purchaseData.transaction_id
        });
        persistPurchaseState();
        scheduleFinalSubmission();

        if (purchaseData.account_id) {
          submitPurchase();
        } else {
          originalLog.call(console, '[TPT] No account_id yet, watching DOM...');
          startWatchingForNewAccount();
        }
      }

      // SUBSCRIPTION FAILED (XHR)
      else if (urlLower.includes('/subscriptions/nuvei') && !data?.isSuccess) {
        addEvent('payment_declined', 'Payment attempt failed (XHR)', {
          error: data?.message || data?.error
        });
      }

    } catch (e) {
      var urlLower = url.toLowerCase();
      if (urlLower.includes('/promocodes/') || urlLower.includes('/accounts/') || urlLower.includes('/subscriptions/')) {
        logError('xhr_intercept', e, { url: url.split('?')[0] });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // TRACKER UI (Using shared TrackerUI)
  // ═══════════════════════════════════════════════════════════════════

  function initTracker() {
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      return tracker;
    }

    if (!window.TrackerUI) {
      originalLog.call(console, '[TPT] TrackerUI not loaded yet, retrying...');
      return null;
    }

    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: 'Take Profit Trader',
      fields: ['coupon', 'product', 'price', 'email', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        order_id: 'Account ID'
      },
      afterPurchaseFields: ['order_id']
    });

    window.__pfcTracker = tracker;
    originalLog.call(console, '[TPT] TrackerUI initialized');
    return tracker;
  }

  function showTracker() {
    const t = tracker || initTracker();
    if (t) {
      t.show();
      if (t.startRecording) t.startRecording();
      updateTrackerUI();
    }
  }

  function updateTrackerUI() {
    const t = tracker || window.__pfcTracker;
    if (!t) return;

    const isReset = purchaseData.purchase_type === 'reset';

    if (purchaseData.product_name) {
      t.updateField('product', purchaseData.product_name);
    }

    if (purchaseData.original_price) {
      if (!isReset && couponConfirmed && purchaseData.final_price && purchaseData.final_price < purchaseData.original_price) {
        t.updateField('price', purchaseData.final_price, t.formatPrice(purchaseData.original_price, purchaseData.final_price));
      } else {
        t.updateField('price', purchaseData.original_price, `$${purchaseData.original_price}`);
      }
    }

    if (purchaseData.email) {
      t.updateField('email', purchaseData.email);
    }

    if (isReset) {
      t.updateField('coupon', 'N/A', 'Not available for resets');
    } else if (couponConfirmed && purchaseData.coupon_code) {
      t.updateField('coupon', purchaseData.coupon_code);
    }

    if (purchaseData.account_id) {
      t.updateField('order_id', purchaseData.account_id);
    }
  }

  function setStatus(status, text) {
    captureStatus = status;
    originalLog.call(console, `[TPT] Status: ${status}`);

    const t = tracker || window.__pfcTracker;
    if (t) {
      t.setStatus(status, text || status);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EARLY EMAIL VALIDATION - Warn before purchase, not after
  // ═══════════════════════════════════════════════════════════════════

  function checkEmailBeforePurchase() {
    const t = tracker || window.__pfcTracker;
    if (!t) return;

    if (DEV_SKIP_EMAIL_CHECK) {
      originalLog.call(console, '[TPT] DEV MODE: Skipping email validation');
      addEvent('email_check_skipped', 'DEV_SKIP_EMAIL_CHECK is enabled');
      t.showMessage('info', 'Dev mode: email check bypassed. Using TPT website email.');
      return;
    }

    const tptWebsiteEmail = purchaseData.email?.toLowerCase()?.trim();

    chrome.storage.local.get(['rewards_emails', 'email'], (stored) => {
      originalLog.call(console, '[TPT] Storage check - rewards_emails:', JSON.stringify(stored.rewards_emails || {}));

      const firmSpecificEmail = (
        stored.rewards_emails?.['take-profit-trader'] ||
        stored.rewards_emails?.['takeprofittrader'] ||
        stored.rewards_emails?.['TakeProfitTrader']
      )?.toLowerCase()?.trim();

      const generalEmail = stored.email?.toLowerCase()?.trim();
      const extensionTptEmail = firmSpecificEmail || generalEmail;

      if (!extensionTptEmail) {
        addEvent('email_mismatch', 'No email configured in extension');
        t.showMessage('error', 'Please log in to the extension to track your rewards!');
        setStatus('error', 'Login required');
      } else if (!tptWebsiteEmail) {
        addEvent('email_mismatch', 'Could not get TPT website email');
        t.showMessage('warning', 'Could not verify TPT email. Make sure you are logged in.');
        setStatus('warning', 'Cannot verify');
      } else if (extensionTptEmail !== tptWebsiteEmail) {
        const emailSource = firmSpecificEmail ? 'TPT-specific' : 'general';
        addEvent('email_mismatch', `Emails don't match: ${tptWebsiteEmail} vs ${extensionTptEmail} (${emailSource})`);
        t.showMessage('error', `Email mismatch! TPT: ${tptWebsiteEmail} != Extension (${emailSource}): ${extensionTptEmail}. Update your emails to match.`);
        setStatus('warning', 'Email mismatch');
      } else {
        originalLog.call(console, '[TPT] Emails match - ready for purchase');
        t.showMessage('success', 'Emails verified - ready to track purchase!');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 1: USER DATA - email, name, user_id from JWT cookie
  // ═══════════════════════════════════════════════════════════════════

  function captureUser() {
    try {
      const match = document.cookie.match(/access_token=([^;]+)/);
      if (match) {
        const parts = match[1].split('.');
        if (parts.length >= 2) {
          let payload = parts[1];
          payload += '='.repeat((4 - payload.length % 4) % 4);
          const decoded = JSON.parse(atob(payload));

          purchaseData.email = decoded.email || null;
          purchaseData.customer_name = [decoded.given_name, decoded.family_name].filter(Boolean).join(' ') || null;
          purchaseData.user_id = decoded.sub || null;

          originalLog.call(console, '[TPT] Stage 1: TPT email -', purchaseData.email);
          addEvent('user_captured', 'Email and user data from JWT', {
            email: purchaseData.email,
            has_name: !!purchaseData.customer_name,
            has_user_id: !!purchaseData.user_id
          });
          updateTrackerUI();
        }
      }

      if (!purchaseData.email) {
        originalLog.call(console, '[TPT] Stage 1: No email found on TPT');
      }

      return true;
    } catch (e) {
      logError('captureUser', e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 2: PRODUCT FROM LOCALSTORAGE (selectedAccountSizeId)
  // ═══════════════════════════════════════════════════════════════════

  function captureProduct() {
    try {
      const sizeId = localStorage.getItem('selectedAccountSizeId');
      if (!sizeId) return false;

      const product = getProduct(sizeId);

      // If product changed and we had a stale account_id (from state restore), clear it
      // For non-reset flows, account_id should only come from network intercept during THIS checkout
      if (!resetFlowActive && purchaseData.account_id && purchaseData.product_name && purchaseData.product_name !== product.name) {
        originalLog.call(console, '[TPT] Product changed, clearing stale account_id:', purchaseData.account_id);
        addEvent('account_id_cleared', `Cleared stale account_id ${purchaseData.account_id} due to product change (${purchaseData.product_name} -> ${product.name})`);
        purchaseData.account_id = null;
      }

      purchaseData.product_name = product.name;
      purchaseData.original_price = product.price;

      originalLog.call(console, '[TPT] Stage 2: Product -', purchaseData.product_name, '$' + purchaseData.original_price);
      addEvent('product_captured', `Product ${purchaseData.product_name} ($${purchaseData.original_price})`, {
        product_name: purchaseData.product_name,
        original_price: purchaseData.original_price,
        size_id: sizeId
      });
      updateTrackerUI();
      return true;
    } catch (e) {
      logError('captureProduct', e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 3: COUPON FROM LOCALSTORAGE (stored but NOT shown until confirmed)
  // ═══════════════════════════════════════════════════════════════════

  function captureCoupon() {
    const coupon = localStorage.getItem('urlReferralCode');
    if (coupon) {
      purchaseData.coupon_code = coupon;
      originalLog.call(console, '[TPT] Stage 3: Coupon stored (pending confirmation) -', coupon);
      addEvent('coupon_stored', `Coupon ${coupon} found in localStorage (pending network confirmation)`);
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 4: PRICING FROM DOM - Multi-pattern with fallbacks
  // ═══════════════════════════════════════════════════════════════════

  function capturePricing() {
    const modal = document.querySelector('.account-flow-modal') || document.body;
    const modalText = modal.innerText;
    let foundNew = false;

    // Multi-pattern discount detection
    const discountPatterns = [
      /Discount\s*(\d+)\s*%/i,
      /(\d+)\s*%\s*(?:off|discount)/i,
      /(?:save|saving)\s*(\d+)\s*%/i,
      /-\s*(\d+)\s*%/i
    ];

    for (const pattern of discountPatterns) {
      const discountMatch = modalText.match(pattern);
      if (discountMatch) {
        const newDiscount = parseInt(discountMatch[1], 10);
        if (newDiscount > 0 && newDiscount <= 100 && purchaseData.discount_percent !== newDiscount) {
          purchaseData.discount_percent = newDiscount;
          originalLog.call(console, '[TPT] Stage 4: Discount CONFIRMED from DOM -', purchaseData.discount_percent + '%');
          foundNew = true;

          if (!couponConfirmed && purchaseData.discount_percent > 0) {
            couponConfirmed = true;
            if (!purchaseData.coupon_code) {
              const codeInput = document.querySelector('input[name="code"]');
              if (codeInput && codeInput.value) {
                purchaseData.coupon_code = codeInput.value;
              }
            }
            originalLog.call(console, '[TPT] Coupon CONFIRMED via DOM discount:', purchaseData.coupon_code);
            addEvent('coupon_confirmed', `Coupon confirmed via DOM discount: ${purchaseData.discount_percent}%`, {
              discount_percent: purchaseData.discount_percent,
              coupon_code: purchaseData.coupon_code
            });
          }
        }
        break;
      }
    }

    // Multi-pattern total price detection
    const totalPatterns = [
      /Total\s*\$(\d+(?:\.\d{2})?)/i,
      /\$(\d+(?:\.\d{2})?)\s*\/\s*month/i,
      /Total\s*Price\s*\$(\d+(?:\.\d{2})?)/i
    ];

    for (const pattern of totalPatterns) {
      const totalMatch = modalText.match(pattern);
      if (totalMatch) {
        const newFinal = parseFloat(totalMatch[1]);
        if (purchaseData.final_price !== newFinal) {
          purchaseData.final_price = newFinal;
          originalLog.call(console, '[TPT] Stage 4: Final price -', '$' + purchaseData.final_price);
          foundNew = true;
        }
        break;
      }
    }

    // Multi-pattern original price detection
    const amountPatterns = [
      /Amount\s*\$(\d+(?:\.\d{2})?)/i,
      /Price\s*\$(\d+(?:\.\d{2})?)/i
    ];

    for (const pattern of amountPatterns) {
      const amountMatch = modalText.match(pattern);
      if (amountMatch) {
        const origPrice = parseFloat(amountMatch[1]);
        if (!purchaseData.original_price || purchaseData.original_price !== origPrice) {
          purchaseData.original_price = origPrice;
          originalLog.call(console, '[TPT] Stage 4: Original price -', '$' + purchaseData.original_price);
          foundNew = true;
        }
        break;
      }
    }

    if (foundNew) {
      recordPriceChange('dom_pricing', purchaseData.original_price, purchaseData.final_price, purchaseData.discount_percent, purchaseData.coupon_code);
      addEvent('price_changed', `Pricing updated from DOM`, {
        original_price: purchaseData.original_price,
        final_price: purchaseData.final_price,
        discount_percent: purchaseData.discount_percent
      });
      persistPurchaseState();
      updateTrackerUI();
    }

    return purchaseData.discount_percent !== null && purchaseData.final_price !== null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 5: PAYMENT SUCCESS DETECTION
  // Console.log interception is handled by the main-world injected script.
  // It dispatches 'console_payment' events which are processed in the
  // __pfc_net event listener above (handles APPROVED, triggers submission).
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // TIMEOUT SAFETY NET
  // ═══════════════════════════════════════════════════════════════════

  function scheduleFinalSubmission() {
    if (finalSubmissionTimeout) clearTimeout(finalSubmissionTimeout);
    finalSubmissionTimeout = setTimeout(() => {
      if (captureStatus !== 'success' && captureStatus !== 'submitting') {
        addEvent('timeout_submission', 'Attempting final submission after 60s timeout');
        if (purchaseData.email) {
          submitPurchase();
        }
      }
    }, 60000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUBMIT PURCHASE
  // ═══════════════════════════════════════════════════════════════════

  function submitPurchase() {
    // Prevent duplicate submissions
    if (captureStatus === 'success' || captureStatus === 'submitting') {
      originalLog.call(console, '[TPT] Already submitted or submitting, skipping');
      return;
    }

    // Validate minimum data
    if (!purchaseData.email) {
      originalLog.call(console, '[TPT] Cannot submit - missing website email');
      addEvent('submission_blocked', 'Missing TPT email');
      handleSubmissionBlocked('Missing TPT email - please log in to TPT');
      return;
    }

    if (!purchaseData.account_id) {
      originalLog.call(console, '[TPT] Cannot submit - missing account_id');
      addEvent('submission_blocked', 'Missing account ID');
      handleSubmissionBlocked('Missing account ID - please try again');
      return;
    }

    addEvent('submission_started', 'Starting purchase submission', {
      email: purchaseData.email,
      account_id: purchaseData.account_id,
      product: purchaseData.product_name
    });

    // Get extension's configured TPT email for verification
    chrome.storage.local.get(['rewards_emails', 'email'], (stored) => {
      if (DEV_SKIP_EMAIL_CHECK) {
        originalLog.call(console, '[TPT] DEV MODE: Bypassing email validation for submission. Using TPT email:', purchaseData.email);
        addEvent('email_check_skipped', 'DEV_SKIP_EMAIL_CHECK bypassed submission email gate');
      } else {
      const firmSpecificEmail = (
        stored.rewards_emails?.['take-profit-trader'] ||
        stored.rewards_emails?.['takeprofittrader'] ||
        stored.rewards_emails?.['TakeProfitTrader']
      )?.toLowerCase()?.trim();

      const generalEmail = stored.email?.toLowerCase()?.trim();
      const extensionTptEmail = firmSpecificEmail || generalEmail;
      const tptWebsiteEmail = purchaseData.email?.toLowerCase()?.trim();

      if (!extensionTptEmail) {
        addEvent('submission_blocked', 'No email in extension');
        handleSubmissionBlocked('Please log in to the extension to track your rewards!');
        return;
      }

      if (!tptWebsiteEmail) {
        addEvent('submission_blocked', 'No email from TPT website');
        handleSubmissionBlocked('Could not get email from TPT. Make sure you are logged in.');
        return;
      }

      if (extensionTptEmail !== tptWebsiteEmail) {
        const emailSource = firmSpecificEmail ? 'TPT-specific' : 'general';
        addEvent('submission_blocked', `Email mismatch: ${tptWebsiteEmail} vs ${extensionTptEmail}`);
        handleSubmissionBlocked(`Email mismatch! TPT: ${tptWebsiteEmail} != Extension (${emailSource}): ${extensionTptEmail}`);
        return;
      }

      originalLog.call(console, '[TPT] Emails match - submitting with:', purchaseData.email);
      }
      doSubmit();
    });
  }

  function handleSubmissionBlocked(message) {
    setStatus('error', 'Blocked');
    const t = tracker || window.__pfcTracker;
    if (t) {
      t.showMessage('error', message);
    }

    setTimeout(() => {
      const { email, customer_name, user_id } = purchaseData;
      Object.assign(purchaseData, {
        email,
        customer_name,
        user_id,
        product_name: null,
        original_price: null,
        final_price: null,
        coupon_code: null,
        discount_percent: null,
        account_id: null,
        transaction_id: null,
        platform: null,
        purchase_type: 'new'
      });

      couponConfirmed = false;
      resetFlowActive = false;

      setStatus('waiting', 'Fix emails to continue');

      if (t) {
        t.clearField('product');
        t.clearField('price');
        t.clearField('coupon');
        t.clearField('order_id');
      }

      clearPersistedState();
    }, 5000);
  }

  function doSubmit() {
    // If no promo was used, final = original
    if (!purchaseData.final_price && purchaseData.original_price) {
      purchaseData.final_price = purchaseData.original_price;
    }

    const isReset = purchaseData.purchase_type === 'reset';
    setStatus('submitting', isReset ? 'Submitting reset...' : 'Submitting to API...');

    // Build enriched payload
    const payload = {
      // Core fields
      partner: PARTNER,
      email: purchaseData.email,
      customer_name: purchaseData.customer_name,
      product_name: purchaseData.product_name,
      original_price: purchaseData.original_price,
      final_price: purchaseData.final_price,
      discount_amount: purchaseData.original_price && purchaseData.final_price
        ? purchaseData.original_price - purchaseData.final_price
        : null,
      coupon_code: isReset ? null : purchaseData.coupon_code,
      order_number: purchaseData.account_id,
      checkout_url: window.location.href,

      // TPT-specific fields (previously dropped by background.js)
      platform: purchaseData.platform,
      transaction_id: purchaseData.transaction_id,
      purchase_type: purchaseData.purchase_type,

      // Enriched data envelope
      _enriched: {
        session_id: sessionContext.session_id,
        adapter_version: sessionContext.adapter_version,
        session_started_at: sessionContext.started_at,
        checkout_duration_ms: Date.now() - sessionContext.started_timestamp,

        browser_summary: {
          platform: sessionContext.browser.platform,
          language: sessionContext.browser.language,
          screen: sessionContext.browser.screen.width + 'x' + sessionContext.browser.screen.height,
          viewport: window.innerWidth + 'x' + window.innerHeight,
          timezone: sessionContext.browser.timezone,
          pixelRatio: sessionContext.browser.screen.pixelRatio,
          userAgent: sessionContext.browser.userAgent
        },

        page_url: sessionContext.page.url,
        referrer: sessionContext.page.referrer,

        event_count: eventTimeline.length,
        network_request_count: networkLog.length,
        error_count: errorLog.length,

        price_changes: priceHistory.slice(),
        event_timeline: eventTimeline.slice(),
        network_summary: networkLog.map(function(n) {
          return { t: n.elapsed_ms, m: n.method, p: n.url_path, s: n.status, d: n.duration_ms, e: n.error };
        }),
        errors: errorLog.slice(),

        storage_snapshot: captureStorageSnapshot(),
        dom_snapshot: captureDOMSnapshot('submission'),

        user_id: purchaseData.user_id,
        discount_percent: purchaseData.discount_percent,
        coupon_confirmed_via: couponConfirmed ? 'confirmed' : 'none',
        reset_flow: resetFlowActive,
        previous_account_id: previousFirstAccountId
      }
    };

    originalLog.call(console, '[TPT] Submitting:', JSON.stringify({
      partner: payload.partner,
      email: payload.email,
      product: payload.product_name,
      price: payload.final_price,
      account_id: payload.order_number,
      purchase_type: payload.purchase_type,
      enriched_events: payload._enriched.event_count,
      enriched_network: payload._enriched.network_request_count
    }));

    // First capture
    chrome.runtime.sendMessage({
      action: 'CAPTURE_PURCHASE',
      data: payload
    }, (captureResponse) => {
      if (chrome.runtime.lastError) {
        logError('capture_message', chrome.runtime.lastError);
        addEvent('capture_response', 'CAPTURE_PURCHASE failed: ' + (chrome.runtime.lastError.message || 'unknown'));

        // Retry logic
        if (submissionRetryCount < 3) {
          const delays = [5000, 15000, 30000];
          const delay = delays[submissionRetryCount] || 30000;
          submissionRetryCount++;
          addEvent('submission_retry', `Retrying in ${delay/1000}s (attempt ${submissionRetryCount}/3)`);
          captureStatus = 'waiting';
          setTimeout(() => submitPurchase(), delay);
        } else {
          addEvent('submission_failed', 'All retry attempts exhausted');
          setStatus('error', 'Failed after retries');
          // Download data even on total failure so nothing is lost
          var ft = tracker || window.__pfcTracker;
          if (ft && ft.downloadData) ft.downloadData(payload, { success: false, error: 'All retry attempts exhausted' });
        }
        return;
      }

      originalLog.call(console, '[TPT] Captured:', captureResponse);
      addEvent('capture_response', 'CAPTURE_PURCHASE succeeded', { response: captureResponse });

      // Then trigger success
      chrome.runtime.sendMessage({
        action: 'SUCCESS_DETECTED',
        data: {
          partner: PARTNER,
          order_number: purchaseData.account_id,
          email: purchaseData.email,
          coupon_code: purchaseData.coupon_code,
          purchase_type: purchaseData.purchase_type,
          platform: purchaseData.platform,
          transaction_id: purchaseData.transaction_id,
          _enriched: payload._enriched,
          successData: payload
        }
      }, (successResponse) => {
        if (chrome.runtime.lastError) {
          logError('success_message', chrome.runtime.lastError);
          addEvent('success_response', 'SUCCESS_DETECTED failed: ' + (chrome.runtime.lastError.message || 'unknown'));
          return;
        }

        originalLog.call(console, '[TPT] Success response:', successResponse);
        addEvent('success_response', 'SUCCESS_DETECTED completed', { response: successResponse });

        const t = tracker || window.__pfcTracker;
        if (t) {
          if (successResponse?.skipped) {
            setStatus('success', 'Already tracked');
            t.showMessage('success', 'This purchase was already tracked!');
          } else if (successResponse?.success) {
            setStatus('success', 'Reward tracked!');
            t.showMessage('success', 'Your purchase has been submitted for rewards!');
          } else {
            setStatus('warning', 'Purchase detected');
            t.showMessage('warning', successResponse?.error || 'Data captured but API did not confirm');
          }
          // Always download tracking data regardless of API result
          if (t.downloadData) t.downloadData(payload, successResponse);
        }
      });
    });

    // Schedule guarded reset
    scheduleReset();
  }

  // Race-safe post-submission reset
  function scheduleReset() {
    if (purchaseResetPending) return;
    purchaseResetPending = true;

    const { email, customer_name, user_id, account_id, purchase_type } = purchaseData;

    // Set new baseline immediately
    if (account_id && purchase_type !== 'reset') {
      previousFirstAccountId = account_id;
      localStorage.setItem('__pfc_previous_account_id', account_id);
      originalLog.call(console, '[TPT] New baseline set for next purchase:', account_id);
    }

    setTimeout(() => {
      performReset(email, customer_name, user_id);
    }, captureStatus === 'success' ? 3000 : 8000);
  }

  function performReset(email, customer_name, user_id) {
    purchaseResetPending = false;

    Object.assign(purchaseData, {
      email: email,
      customer_name: customer_name,
      user_id: user_id,
      product_name: null,
      original_price: null,
      final_price: null,
      discount_percent: null,
      coupon_code: null,
      account_id: null,
      transaction_id: null,
      platform: null,
      purchase_type: 'new'
    });

    couponConfirmed = false;
    resetFlowActive = false;
    submissionRetryCount = 0;
    if (finalSubmissionTimeout) { clearTimeout(finalSubmissionTimeout); finalSubmissionTimeout = null; }

    setStatus('waiting', 'Ready for next purchase');

    const t = tracker || window.__pfcTracker;
    if (t) {
      if (t.stopRecording) t.stopRecording();
      t.clearField('product');
      t.clearField('price');
      t.clearField('coupon');
      t.clearField('order_id');
      t.showMessage('success', 'Ready to track next purchase');
    }

    clearPersistedState();
    addEvent('state_reset', 'Ready for next purchase');
    originalLog.call(console, '[TPT] Ready to track next purchase');
  }

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 6B: CAPTURE ACCOUNT ID FROM SUBSCRIPTIONS LIST (DOM fallback)
  // ═══════════════════════════════════════════════════════════════════

  function getFirstAccountIdFromDOM() {
    try {
      const firstRecord = document.querySelector('app-test-subscription-record a[href^="/control-center/"]');
      if (firstRecord) {
        const href = firstRecord.getAttribute('href');
        const match = href.match(/\/control-center\/(\d+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (e) {
      logError('getFirstAccountIdFromDOM', e);
    }
    return null;
  }

  function storeCurrentFirstAccountId() {
    const currentFirst = getFirstAccountIdFromDOM();
    if (currentFirst) {
      previousFirstAccountId = currentFirst;
      localStorage.setItem('__pfc_previous_account_id', currentFirst);
      localStorage.setItem('__pfc_checkout_started', Date.now().toString());
      // Also persist to chrome.storage for PayPal redirect resilience
      persistPurchaseState();
      originalLog.call(console, '[TPT] Stored current first account ID:', previousFirstAccountId);
    }
  }

  function startWatchingForNewAccount() {
    if (watchingForNewAccount) return;

    watchingForNewAccount = true;
    originalLog.call(console, '[TPT] Watching for new account ID (current first:', previousFirstAccountId, ')');

    const t = tracker || window.__pfcTracker;
    if (t) {
      t.showMessage('info', 'Please wait, capturing your reward...');
    }
  }

  function checkForNewAccountId() {
    if (purchaseData.account_id) return false;
    if (!previousFirstAccountId) return false;

    const currentFirst = getFirstAccountIdFromDOM();

    if (currentFirst && currentFirst !== previousFirstAccountId) {
      purchaseData.account_id = currentFirst;
      watchingForNewAccount = false;

      localStorage.removeItem('__pfc_previous_account_id');
      localStorage.removeItem('__pfc_checkout_started');

      originalLog.call(console, '[TPT] Stage 6: NEW Account ID detected!');
      originalLog.call(console, '[TPT]    Previous first:', previousFirstAccountId);
      originalLog.call(console, '[TPT]    New account:', purchaseData.account_id);

      addEvent('account_id_dom', `New account ${purchaseData.account_id} detected via DOM (was ${previousFirstAccountId})`);

      const firstRecord = document.querySelector('app-test-subscription-record a[href^="/control-center/"]');
      if (firstRecord) {
        if (!purchaseData.product_name) {
          const productDiv = firstRecord.querySelector('.text-subtitle-3');
          if (productDiv) {
            purchaseData.product_name = productDiv.textContent.trim();
          }
        }

        if (!purchaseData.platform) {
          const platformDiv = firstRecord.querySelector('.text-body-8.text-start.color-white-60');
          if (platformDiv) {
            const platformText = platformDiv.textContent.trim();
            if (platformText === 'CQG' || platformText === 'Rithmic') {
              purchaseData.platform = platformText;
            }
          }
        }
      }

      persistPurchaseState();
      updateTrackerUI();

      if (purchaseData.email && captureStatus !== 'success') {
        originalLog.call(console, '[TPT] New account detected, submitting...');
        submitPurchase();
      }

      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTOFILL - Direct implementation
  // ═══════════════════════════════════════════════════════════════════

  let autofillAttempted = false;
  let autofillInProgress = false;

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForElement(selector, textContent, maxWait) {
    if (textContent === undefined) textContent = null;
    if (maxWait === undefined) maxWait = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const elements = document.querySelectorAll(selector);

      for (const el of elements) {
        if (!textContent || el.textContent.trim().toUpperCase().includes(textContent.toUpperCase())) {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
            return el;
          }
        }
      }

      await sleep(100);
    }

    return null;
  }

  async function performAutofill() {
    if (resetFlowActive || purchaseData.purchase_type === 'reset') {
      originalLog.call(console, '[TPT] Skipping autofill - reset flow');
      return;
    }

    if (autofillAttempted || autofillInProgress) {
      return;
    }

    autofillInProgress = true;
    addEvent('autofill_started', 'Starting coupon autofill');

    try {
      let addButton = null;
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent.trim().toUpperCase();
        const isLinkStyle = btn.classList.contains('ant-btn-link') || btn.getAttribute('nztype') === 'link';
        if (text === 'ADD' && isLinkStyle) {
          addButton = btn;
          break;
        }
      }

      if (!addButton) {
        const existingInput = document.querySelector('input[name="code"]');
        if (!existingInput) {
          addButton = await waitForElement('button', 'Add', 5000);
          if (!addButton) {
            throw new Error('Could not find Add button or promo input');
          }
        }
      }

      if (addButton) {
        addButton.click();
        await sleep(800);
      }

      const input = await waitForElement('input[name="code"]', null, 5000);

      if (!input) {
        throw new Error('Promo input not found after clicking Add');
      }

      if (input.value === 'LAB') {
        autofillAttempted = true;
        autofillInProgress = false;
        addEvent('autofill_completed', 'Code already filled with LAB');
        return;
      }

      input.focus();
      input.value = '';

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'LAB');

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));

      input.style.border = '2px solid #00cc66';
      input.style.boxShadow = '0 0 10px rgba(0, 204, 102, 0.3)';

      await sleep(500);

      let applyButton = null;
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const text = btn.textContent.trim().toUpperCase();
        const isDefaultStyle = btn.classList.contains('ant-btn-default') || btn.getAttribute('nztype') === 'default';
        if (text === 'APPLY' && isDefaultStyle) {
          applyButton = btn;
          break;
        }
      }

      if (!applyButton) {
        applyButton = await waitForElement('button', 'APPLY', 3000);
      }

      if (!applyButton) {
        throw new Error('APPLY button not found');
      }

      applyButton.click();

      autofillAttempted = true;
      autofillInProgress = false;

      addEvent('autofill_completed', 'Coupon LAB autofilled and applied');

      setTimeout(() => {
        if (input) {
          input.style.border = '';
          input.style.boxShadow = '';
        }
      }, 2000);

    } catch (error) {
      logError('autofill', error);
      addEvent('autofill_failed', error.message);
      autofillInProgress = false;
      autofillAttempted = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESET FLOW DETECTION
  // ═══════════════════════════════════════════════════════════════════

  function setupResetButtonListeners() {
    document.body.addEventListener('click', (e) => {
      const resetButton = e.target.closest('button');
      if (!resetButton) return;

      const buttonText = resetButton.textContent.trim().toUpperCase();
      const isResetButton = buttonText === 'RESET' &&
                            resetButton.classList.contains('ant-btn-color-error');

      if (!isResetButton) return;

      originalLog.call(console, '[TPT] RESET button clicked!');
      addEvent('reset_button_clicked', 'User clicked RESET button');

      const accountRow = resetButton.closest('app-test-subscription-record, app-subscription-record, [class*="subscription"]');

      if (accountRow) {
        const accountLink = accountRow.querySelector('a[href*="/control-center/"]');
        if (accountLink) {
          const href = accountLink.getAttribute('href');
          const match = href.match(/\/control-center\/(\d+)/);
          if (match && match[1]) {
            purchaseData.account_id = match[1];
            originalLog.call(console, '[TPT] Reset account ID:', purchaseData.account_id);
          }
        }

        const productDiv = accountRow.querySelector('.text-subtitle-3, .subscription-name');
        if (productDiv) {
          const productText = productDiv.textContent.trim();
          const sizeMatch = productText.match(/\$?\s*(\d+)\s*[kK]/);
          if (sizeMatch) {
            const size = sizeMatch[1] + 'K';
            purchaseData.product_name = size + ' Reset';
            purchaseData.original_price = RESET_PRICE;
          }
        }

        const platformDiv = accountRow.querySelector('.text-body-8, [class*="platform"]');
        if (platformDiv) {
          const platformText = platformDiv.textContent.trim();
          if (platformText === 'CQG' || platformText === 'Rithmic') {
            purchaseData.platform = platformText;
          }
        }
      }

      if (!purchaseData.product_name) {
        try {
          const accountSizeStr = localStorage.getItem('accountSize');
          if (accountSizeStr) {
            const accountSize = JSON.parse(accountSizeStr);
            const sizeMatch = accountSize.name?.match(/\$?\s*(\d+)\s*[kK]/);
            if (sizeMatch) {
              const size = sizeMatch[1] + 'K';
              purchaseData.product_name = size + ' Reset';
              purchaseData.original_price = RESET_PRICE;
            }
          }
        } catch (e) {
          logError('resetProductParse', e);
        }
      }

      purchaseData.purchase_type = 'reset';
      purchaseData.coupon_code = null;
      resetFlowActive = true;
      couponConfirmed = false;

      if (!purchaseData.email) {
        captureUser();
      }

      addEvent('reset_flow_started', 'Reset flow initialized', {
        account_id: purchaseData.account_id,
        product_name: purchaseData.product_name,
        platform: purchaseData.platform
      });

      showTracker();
      updateTrackerUI();
      setStatus('waiting', 'Waiting for reset payment...');
      checkEmailBeforePurchase();
      persistPurchaseState();
    }, true);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POSTMESSAGE LISTENER (for Nuvei iframe communication)
  // ═══════════════════════════════════════════════════════════════════

  function setupPostMessageListener() {
    window.addEventListener('message', function(event) {
      // Only log during active checkout/payment
      if (captureStatus === 'initializing' && !resetFlowActive) return;

      try {
        var data = event.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { return; }
        }
        if (!data || typeof data !== 'object') return;

        // Log payment-related postMessages
        if (data.transactionId || data.result || data.status || data.paymentStatus) {
          var origin = event.origin || 'unknown';
          addEvent('postmessage_received', `Payment message from ${origin}`, {
            origin: origin,
            has_transaction_id: !!data.transactionId,
            result: data.result || data.status || data.paymentStatus || null
          });

          // Use as additional payment success trigger
          if (data.result === 'APPROVED' || data.status === 'APPROVED' || data.paymentStatus === 'approved') {
            if (data.transactionId && !purchaseData.transaction_id) {
              purchaseData.transaction_id = data.transactionId;
              addEvent('payment_approved_postmessage', 'Payment approved via postMessage', {
                transaction_id: data.transactionId,
                origin: origin
              });
              persistPurchaseState();
              scheduleFinalSubmission();
            }
          }
        }
      } catch (e) {
        // Ignore non-payment postMessages
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // URL-BASED SUCCESS DETECTION
  // ═══════════════════════════════════════════════════════════════════

  let lastCheckedUrl = window.location.href;

  function setupUrlMonitoring() {
    // Watch for SPA navigation via popstate
    window.addEventListener('popstate', function() {
      checkUrlChange();
    });

    // Poll for URL changes (SPA frameworks often don't fire popstate)
    setInterval(function() {
      if (window.location.href !== lastCheckedUrl) {
        checkUrlChange();
      }
    }, 1000);
  }

  function checkUrlChange() {
    var newUrl = window.location.href;
    if (newUrl === lastCheckedUrl) return;

    var oldUrl = lastCheckedUrl;
    lastCheckedUrl = newUrl;

    addEvent('url_changed', `Navigation: ${oldUrl.split('/').slice(3).join('/')} -> ${newUrl.split('/').slice(3).join('/')}`);

    // Detect navigation to control-center after checkout (success signal)
    if (newUrl.includes('/control-center/') && !newUrl.includes('/control-center/pro') && purchaseData.email && captureStatus !== 'success') {
      addEvent('success_url_detected', 'Navigated to control-center (possible purchase success)');
      // Give network intercept a chance first, then try submission
      setTimeout(function() {
        if (captureStatus !== 'success' && captureStatus !== 'submitting' && purchaseData.account_id) {
          submitPurchase();
        }
      }, 5000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOM-BASED SUCCESS DETECTION BACKUP
  // ═══════════════════════════════════════════════════════════════════

  let successPolling = null;

  function startSuccessPolling() {
    if (successPolling) return;
    successPolling = setInterval(function() {
      var bodyText = document.body.innerText;
      if (bodyText.includes('Payment Successful') ||
          bodyText.includes('payment was successful') ||
          bodyText.includes('Account Created Successfully') ||
          bodyText.includes('Your account has been created')) {
        addEvent('payment_success_dom', 'Payment success detected via DOM text');
        if (!purchaseData.account_id) {
          checkForNewAccountId();
        }
        if (purchaseData.account_id && purchaseData.email && captureStatus !== 'success' && captureStatus !== 'submitting') {
          submitPurchase();
        }
        stopSuccessPolling();
      }
    }, 1000);
  }

  function stopSuccessPolling() {
    if (successPolling) {
      clearInterval(successPolling);
      successPolling = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // WATCHERS
  // ═══════════════════════════════════════════════════════════════════

  function startWatchers() {
    // Poll for product selection changes
    setInterval(() => {
      const currentSizeId = localStorage.getItem('selectedAccountSizeId');
      if (currentSizeId && currentSizeId !== lastSeenAccountSizeId) {
        lastSeenAccountSizeId = currentSizeId;
        addEvent('product_changed', `Account size changed to ${currentSizeId}`);
        captureProduct();
      }
    }, 500);

    // Poll for pricing every second (fallback for network intercept)
    setInterval(() => {
      if (purchaseData.discount_percent === null || purchaseData.final_price === null) {
        capturePricing();
      }
    }, 1000);

    // Poll for NEW account ID in subscriptions list
    let lastLoggedPreviousId = null;
    setInterval(() => {
      // Restore from localStorage if needed
      if (!previousFirstAccountId) {
        const stored = localStorage.getItem('__pfc_previous_account_id');
        if (stored) {
          previousFirstAccountId = stored;
          originalLog.call(console, '[TPT] Restored previous account ID from storage:', stored);
        }
      }

      // Also try chrome.storage restore
      if (!previousFirstAccountId) {
        // Non-blocking check - only runs once
        if (!previousFirstAccountId && !window.__tpt_chrome_restore_attempted) {
          window.__tpt_chrome_restore_attempted = true;
          restorePurchaseState();
        }
      }

      if (previousFirstAccountId && !purchaseData.account_id) {
        if (lastLoggedPreviousId !== previousFirstAccountId) {
          lastLoggedPreviousId = previousFirstAccountId;
          originalLog.call(console, '[TPT] Watching for account change (current baseline:', previousFirstAccountId + ')');
        }
        checkForNewAccountId();
      }
    }, 500);

    // Watch localStorage changes (backup)
    const origSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      origSetItem.apply(this, arguments);
      if (key === 'selectedAccountSizeId') {
        lastSeenAccountSizeId = value;
        captureProduct();
      }
      if (key === 'urlReferralCode') captureCoupon();
    };

    // Visibility change handler - check for new account when tab becomes visible
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        addEvent('tab_visible', 'Tab became visible');
        if (previousFirstAccountId && !purchaseData.account_id) {
          checkForNewAccountId();
        }
      }
    });

    // Persist state before page unload
    window.addEventListener('beforeunload', function() {
      persistPurchaseState();
      addEvent('page_unload', 'Page navigating away');
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECKOUT MODAL DETECTION (with fallback detection)
  // ═══════════════════════════════════════════════════════════════════

  let discountPollInterval = null;
  let promoInputWasVisible = false;
  let modalWasOpen = false;

  var checkoutDetectedOnce = false;
  function onCheckoutDetected(source) {
    if (checkoutDetectedOnce) return; // Prevent duplicate firing from multiple observers
    checkoutDetectedOnce = true;
    addEvent('checkout_modal_opened', `Checkout detected via ${source}`);

    // Clear stale account_id from previous session state restore
    // For new purchases: account_id should only come from network intercept during THIS checkout
    // For resets: account_id is set by the reset button click handler, not here
    if (!resetFlowActive && purchaseData.account_id && captureStatus !== 'submitting' && captureStatus !== 'success') {
      originalLog.call(console, '[TPT] New checkout detected, clearing stale account_id:', purchaseData.account_id);
      addEvent('account_id_cleared', `Cleared restored account_id ${purchaseData.account_id} for fresh checkout`);
      purchaseData.account_id = null;
      var t = tracker || window.__pfcTracker;
      if (t) t.clearField('order_id');
    }

    showTracker();
    storeCurrentFirstAccountId();
    checkEmailBeforePurchase();
    startDiscountPolling();
    startSuccessPolling();
    setTimeout(() => { performAutofill(); }, 1500);
  }

  function startDiscountPolling() {
    if (discountPollInterval) return;

    discountPollInterval = setInterval(() => {
      const modal = document.querySelector('.account-flow-modal');
      if (!modal) {
        if (modalWasOpen) {
          originalLog.call(console, '[TPT] Modal closed - starting to watch for new account...');
          addEvent('checkout_modal_closed', 'Checkout modal closed');
          modalWasOpen = false;

          // Auto-download tracking data when modal closes (purchase likely completed)
          // This fires regardless of submission status so data is never lost
          var mt = tracker || window.__pfcTracker;
          if (mt && mt.downloadData) {
            var modalClosePayload = {
              partner: PARTNER,
              email: purchaseData.email,
              customer_name: purchaseData.customer_name,
              product_name: purchaseData.product_name,
              original_price: purchaseData.original_price,
              final_price: purchaseData.final_price,
              coupon_code: purchaseData.coupon_code,
              order_number: purchaseData.account_id,
              purchase_type: purchaseData.purchase_type,
              platform: purchaseData.platform,
              transaction_id: purchaseData.transaction_id,
              checkout_url: window.location.href,
              _enriched: {
                session_id: sessionContext.session_id,
                adapter_version: sessionContext.adapter_version,
                checkout_duration_ms: Date.now() - sessionContext.started_timestamp,
                browser_summary: {
                  platform: sessionContext.browser.platform,
                  language: sessionContext.browser.language,
                  userAgent: sessionContext.browser.userAgent
                },
                page_url: sessionContext.page.url,
                event_count: eventTimeline.length,
                network_request_count: networkLog.length,
                error_count: errorLog.length,
                event_timeline: eventTimeline.slice(),
                network_summary: networkLog.map(function(n) {
                  return { t: n.elapsed_ms, m: n.method, p: n.url_path, s: n.status, d: n.duration_ms };
                }),
                price_changes: priceHistory.slice(),
                errors: errorLog.slice(),
                storage_snapshot: captureStorageSnapshot(),
                dom_snapshot: captureDOMSnapshot('modal_close')
              }
            };
            mt.downloadData(modalClosePayload, { trigger: 'modal_close', captureStatus: captureStatus });
          }

          startWatchingForNewAccount();
        }

        clearInterval(discountPollInterval);
        discountPollInterval = null;
        autofillAttempted = false;
        autofillInProgress = false;
        promoInputWasVisible = false;
        checkoutDetectedOnce = false; // Allow re-detection for next checkout
        return;
      }

      modalWasOpen = true;

      const promoInput = modal.querySelector('input[name="code"]');
      const promoInputVisible = promoInput && promoInput.offsetParent !== null;

      if (promoInputWasVisible && !promoInputVisible) {
        originalLog.call(console, '[TPT] Promo input closed, resetting autofill state');
        autofillAttempted = false;
        autofillInProgress = false;

        setTimeout(() => {
          if (!autofillAttempted) {
            performAutofill();
          }
        }, 1000);
      }

      promoInputWasVisible = promoInputVisible;
      capturePricing();
    }, 500);
  }

  function watchForCheckoutModal() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            // Primary detection: .account-flow-modal
            if (node.classList?.contains('account-flow-modal') ||
                node.querySelector?.('.account-flow-modal')) {
              onCheckoutDetected('mutation_observer');
            }

            // Fallback detection: modal/overlay with payment-related content
            else if ((node.classList?.contains('cdk-overlay-container') ||
                      node.classList?.contains('ant-modal-root') ||
                      node.querySelector?.('[class*="modal"]')) &&
                     !discountPollInterval) {
              // Check if it contains checkout-related content
              const text = (node.innerText || '').toLowerCase();
              if (text.includes('checkout') || text.includes('subscribe') || text.includes('payment') || text.includes('promo code')) {
                onCheckoutDetected('fallback_modal_detection');
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Check if modal already exists
    if (document.querySelector('.account-flow-modal')) {
      onCheckoutDetected('existing_modal');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DEBUG INTERFACE
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGE LISTENER — responds to popup/background requests
  // ═══════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'GET_LIVE_EXTRACTION') {
      sendResponse({
        partner: PARTNER,
        captureStatus: captureStatus,
        purchaseData: purchaseData,
        session: sessionContext,
        eventTimeline: eventTimeline,
        networkLog: networkLog,
        priceHistory: priceHistory,
        errorLog: errorLog,
        storageSnapshot: captureStorageSnapshot(),
        domSnapshot: captureDOMSnapshot('live_extraction')
      });
      return false;
    }
  });

  window.tptDebug = {
    data: () => purchaseData,
    status: () => captureStatus,
    isReset: () => resetFlowActive,
    showTracker,
    submit: submitPurchase,
    extractUser: captureUser,
    autofill: () => {
      autofillAttempted = false;
      autofillInProgress = false;
      performAutofill();
    },
    recapture: () => {
      captureUser();
      captureProduct();
      captureCoupon();
      capturePricing();
    },
    simulateReset: (accountId, productSize) => {
      purchaseData.account_id = accountId || '12345';
      purchaseData.product_name = (productSize || '25K') + ' Reset';
      purchaseData.original_price = RESET_PRICE;
      purchaseData.purchase_type = 'reset';
      resetFlowActive = true;
      showTracker();
      updateTrackerUI();
      setStatus('waiting', 'Waiting for reset payment...');
    },

    // New debug methods for enriched tracking data
    events: () => eventTimeline,
    network: () => networkLog,
    errors: () => errorLog,
    prices: () => priceHistory,
    session: () => sessionContext,
    snapshot: () => ({
      storage: captureStorageSnapshot(),
      dom: captureDOMSnapshot('debug')
    }),
    exportAll: () => {
      return JSON.stringify({
        session: sessionContext,
        purchaseData: purchaseData,
        captureStatus: captureStatus,
        couponConfirmed: couponConfirmed,
        resetFlowActive: resetFlowActive,
        eventTimeline: eventTimeline,
        networkLog: networkLog,
        priceHistory: priceHistory,
        errorLog: errorLog,
        storageSnapshot: captureStorageSnapshot(),
        domSnapshot: captureDOMSnapshot('export')
      }, null, 2);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════

  function init() {
    originalLog.call(console, '[TPT] TakeProfitTrader Adapter v6.0 (Enhanced Tracking)');
    addEvent('adapter_start', 'TPT Adapter v6.0 initializing');

    // SKIP FUNDED ACCOUNT RESETS - /control-center/pro
    if (window.location.pathname.includes('/control-center/pro')) {
      originalLog.call(console, '[TPT] Skipping - Funded account page (no tracking needed)');
      addEvent('skip_funded', 'Skipping funded account page');
      return;
    }

    // Try to restore state from chrome.storage (PayPal redirect resilience)
    restorePurchaseState().then(function(restored) {
      if (restored) {
        originalLog.call(console, '[TPT] State restored from chrome.storage');
      }
    });

    // Initialize tracker (may need to wait for TrackerUI to load)
    const tryInitTracker = () => {
      if (initTracker()) {
        captureUser();
        captureProduct();
        captureCoupon();
        capturePricing();
        setStatus('waiting', 'Waiting for checkout...');
        addEvent('stages_captured', 'Initial data capture complete', {
          email: !!purchaseData.email,
          product: !!purchaseData.product_name,
          coupon: !!purchaseData.coupon_code,
          pricing: !!purchaseData.final_price
        });
      } else {
        setTimeout(tryInitTracker, 100);
      }
    };

    lastSeenAccountSizeId = localStorage.getItem('selectedAccountSizeId');

    tryInitTracker();
    startWatchers();
    watchForCheckoutModal();
    setupResetButtonListeners();
    setupPostMessageListener();
    setupUrlMonitoring();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
