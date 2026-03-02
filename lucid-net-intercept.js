/**
 * Lucid Trading Network Interceptor — Runs in MAIN WORLD
 *
 * Intercepts fetch/XHR to capture:
 * - /?wc-ajax=update_order_review - cart data, pricing, coupon status
 * - apply_coupon_action - coupon application
 * - checkout form submissions - billing data, order ID
 *
 * Dispatches events to content script via CustomEvent.
 *
 * AUTO-COUPON: Automatically applies LAB coupon via WooCommerce AJAX
 */
(function() {
  'use strict';
  if (window.__pfcLucidNetInterceptInstalled) return;
  window.__pfcLucidNetInterceptInstalled = true;

  var COUPON_CODE = 'LAB';
  var couponApplied = false;
  var couponApplyAttempted = false;

  function isRelevantReq(url) {
    if (!url) return false;
    if (url.includes('lucidtrading.com')) return true;
    if (url.includes('wc-ajax')) return true;
    if (url.includes('apply_coupon')) return true;
    if (url.includes('admin-ajax.php')) return true;
    return false;
  }

  function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch(e) { return null; }
  }

  function dispatch(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent('__pfc_lucid_net', {
        detail: JSON.stringify({ type: type, data: detail })
      }));
    } catch(e) {}
  }

  // --- Parse URL-encoded form data ---
  function parseFormData(text) {
    if (!text) return {};
    var result = {};
    var pairs = text.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].split('=');
      var key = decodeURIComponent(pair[0] || '');
      var value = decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
      result[key] = value;
    }
    return result;
  }

  // --- Parse nested post_data from WooCommerce ---
  function parseNestedPostData(formData) {
    if (formData.post_data) {
      var nested = parseFormData(formData.post_data);
      // Merge nested into main
      for (var key in nested) {
        if (nested.hasOwnProperty(key) && !formData[key]) {
          formData[key] = nested[key];
        }
      }
    }
    return formData;
  }

  // --- Auto-apply coupon via WooCommerce AJAX ---
  function applyCouponAPI() {
    if (couponApplied || couponApplyAttempted) return;
    couponApplyAttempted = true;

    // Find the coupon form or use direct AJAX
    var ajaxUrl = '/wp-admin/admin-ajax.php';
    var formData = new FormData();
    formData.append('action', 'apply_coupon_action');
    formData.append('coupon_code', COUPON_CODE);

    console.log('[PFC-Lucid] Auto-applying coupon LAB via AJAX');

    origFetch(ajaxUrl, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    }).then(function(response) {
      return response.text();
    }).then(function(text) {
      console.log('[PFC-Lucid] Coupon apply response:', text.substring(0, 200));

      // Check for success indicators
      if (text.includes('success') || text.includes('applied') || text.includes('Coupon')) {
        couponApplied = true;
        dispatch('coupon_applied', { coupon_code: COUPON_CODE, response: text.substring(0, 500) });

        // Trigger WooCommerce checkout update to reflect new price
        try {
          if (window.jQuery) {
            window.jQuery('body').trigger('update_checkout');
          }
        } catch(e) {}
      } else {
        console.log('[PFC-Lucid] Coupon may have failed or already applied');
        couponApplyAttempted = false; // Allow retry
      }
    }).catch(function(err) {
      console.log('[PFC-Lucid] Coupon apply error:', err);
      couponApplyAttempted = false; // Allow retry
    });
  }

  // --- Alternative: Apply via coupon input form ---
  function applyCouponViaForm() {
    if (couponApplied) return;

    // Look for WooCommerce coupon input
    var couponInput = document.querySelector('input[name="coupon_code"], input#coupon_code, .woocommerce-form-coupon input[type="text"]');
    var applyButton = document.querySelector('.woocommerce-form-coupon button[type="submit"], button[name="apply_coupon"], .apply-coupon');

    if (couponInput && applyButton) {
      console.log('[PFC-Lucid] Found coupon form, filling LAB');
      couponInput.value = COUPON_CODE;
      couponInput.dispatchEvent(new Event('input', { bubbles: true }));
      couponInput.dispatchEvent(new Event('change', { bubbles: true }));

      setTimeout(function() {
        applyButton.click();
        couponApplied = true;
        dispatch('coupon_applied', { coupon_code: COUPON_CODE, method: 'form' });
      }, 300);
    }
  }

  // --- Fetch override ---
  var origFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    var resource = args[0];
    var options = args[1] || {};
    var url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
    var method = options.method || 'GET';
    var reqBody = options.body || null;

    if (!isRelevantReq(url)) return origFetch.apply(this, args);

    return origFetch.apply(this, args).then(function(response) {
      var clone = response.clone();
      var status = response.status;
      clone.text().then(function(text) {
        var jsonData = null;
        try { jsonData = JSON.parse(text); } catch(e) {}

        // Parse form data from request body
        var parsedReqBody = null;
        if (typeof reqBody === 'string') {
          parsedReqBody = parseFormData(reqBody);
          parsedReqBody = parseNestedPostData(parsedReqBody);
        }

        dispatch('fetch', {
          url: url, method: method, status: status,
          requestBody: typeof reqBody === 'string' ? reqBody : safeStringify(reqBody),
          parsedRequestBody: parsedReqBody,
          responseData: jsonData,
          responseText: text ? text.substring(0, 5000) : null,
          error: null
        });
      }).catch(function() {});
      return response;
    }).catch(function(err) {
      dispatch('fetch', {
        url: url, method: method, status: null,
        requestBody: typeof reqBody === 'string' ? reqBody : safeStringify(reqBody),
        responseData: null, error: err.message || String(err)
      });
      throw err;
    });
  };

  // --- XHR override ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__pfc_url = url;
    this.__pfc_method = method;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this;
    var url = xhr.__pfc_url;

    if (url && isRelevantReq(url)) {
      xhr.addEventListener('load', function() {
        var jsonData = null;
        try { jsonData = JSON.parse(xhr.responseText); } catch(e) {}

        // Parse form data from request body
        var parsedReqBody = null;
        if (typeof body === 'string') {
          parsedReqBody = parseFormData(body);
          parsedReqBody = parseNestedPostData(parsedReqBody);
        }

        dispatch('xhr', {
          url: url, method: xhr.__pfc_method, status: xhr.status,
          requestBody: typeof body === 'string' ? body : safeStringify(body),
          parsedRequestBody: parsedReqBody,
          responseData: jsonData,
          responseText: xhr.responseText ? xhr.responseText.substring(0, 5000) : null,
          error: null
        });
      });
    }

    return origSend.apply(this, arguments);
  };

  // --- Auto-apply coupon on checkout page load ---
  function isDashCheckout() {
    var hostname = window.location.hostname.toLowerCase();
    var hash = window.location.hash.toLowerCase();
    return hostname.includes('dash.lucidtrading') || hash.includes('add-account');
  }

  function initCouponOnCheckout() {
    var path = window.location.pathname.toLowerCase();
    if (path.includes('checkout') || path.includes('cart') || isDashCheckout()) {
      console.log('[PFC-Lucid] Checkout/cart page detected');

      // Wait for page to load then check for existing coupon
      setTimeout(function() {
        // Check if coupon already applied (look for discount in cart)
        var discountRow = document.querySelector('.cart-discount, .coupon-lab, [class*="coupon"]');
        if (discountRow && discountRow.textContent.toLowerCase().includes('lab')) {
          console.log('[PFC-Lucid] LAB coupon already applied');
          couponApplied = true;
          dispatch('coupon_already_applied', { coupon_code: COUPON_CODE });
          return;
        }

        // Try form-based application first
        applyCouponViaForm();

        // If no form found, try API
        if (!couponApplied && !couponApplyAttempted) {
          setTimeout(applyCouponAPI, 1000);
        }
      }, 1500);
    }
  }

  // Run on script load
  initCouponOnCheckout();

  // Also watch for SPA navigation (pathname + hash for dashboard)
  var lastPath = window.location.pathname;
  var lastHash = window.location.hash;
  setInterval(function() {
    if (window.location.pathname !== lastPath || window.location.hash !== lastHash) {
      lastPath = window.location.pathname;
      lastHash = window.location.hash;
      couponApplyAttempted = false;
      initCouponOnCheckout();
    }
  }, 1000);

  // --- Debug bridge ---
  var capturedRequests = [];
  window.__pfcLucidNet = {
    log: capturedRequests,
    count: function() { return capturedRequests.length; },
    show: function() {
      console.log('[PFC-Lucid] Captured requests:', capturedRequests.length);
      capturedRequests.forEach(function(r, i) {
        console.log('  [' + i + ']', r.method, r.url, '→', r.status);
      });
      return capturedRequests;
    },
    applyCoupon: function() {
      couponApplied = false;
      couponApplyAttempted = false;
      applyCouponAPI();
    },
    applyCouponForm: function() {
      couponApplied = false;
      applyCouponViaForm();
    }
  };

  var origDispatch = dispatch;
  dispatch = function(type, detail) {
    if (type === 'fetch' || type === 'xhr') {
      capturedRequests.push({
        type: type,
        method: detail.method,
        url: detail.url,
        status: detail.status,
        time: new Date().toISOString()
      });
      if (capturedRequests.length > 100) {
        capturedRequests.splice(0, capturedRequests.length - 100);
      }
    }
    origDispatch(type, detail);
  };

  var isIframe = (window.self !== window.top);
  console.log('[PFC-Lucid] Network interceptor installed' + (isIframe ? ' (iframe context)' : ''));
})();
