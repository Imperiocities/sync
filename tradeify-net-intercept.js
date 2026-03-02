/**
 * Tradeify Network Interceptor — Runs in MAIN WORLD
 *
 * Intercepts fetch/XHR to capture plan details, pricing, and user data.
 * Dispatches events to content script via CustomEvent.
 *
 * AUTO-COUPON: Automatically applies LAB coupon via couponsCheck API
 */
(function() {
  'use strict';
  if (window.__pfcTradeifyNetInterceptInstalled) return;
  window.__pfcTradeifyNetInterceptInstalled = true;

  var COUPON_CODE = 'LAB';
  var couponApplied = false;

  function isRelevantReq(url) {
    if (!url) return false;
    if (url.includes('tradeify.co')) return true;
    if (url.includes('klaviyo')) return true;
    if (url.includes('intercom')) return true;
    if (url.startsWith('/api/')) return true;
    if (url.startsWith('/')) return true;
    return false;
  }

  function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch(e) { return null; }
  }

  function dispatch(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent('__pfc_tradeify_net', {
        detail: JSON.stringify({ type: type, data: detail })
      }));
    } catch(e) {}
  }

  // --- Auto-apply coupon via API ---
  function applyCouponAPI(planId) {
    if (couponApplied) return;
    couponApplied = true;

    var apiUrl = 'https://app-f.tradeify.co/api/dashboard/couponsCheck/' + planId;
    console.log('[PFC-Tradeify] Auto-applying coupon LAB for plan:', planId);

    origFetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ coupon_code: COUPON_CODE }),
      credentials: 'include'
    }).then(function(response) {
      return response.json();
    }).then(function(data) {
      console.log('[PFC-Tradeify] Coupon applied:', data);
      dispatch('coupon_applied', { coupon_code: COUPON_CODE, response: data });
      // Also dispatch as a regular fetch event so processNetworkResponse handles it
      // even if the coupon_applied CustomEvent is lost crossing MAIN↔ISOLATED world boundary
      dispatch('fetch', {
        url: apiUrl, method: 'POST', status: 200,
        requestBody: JSON.stringify({ coupon_code: COUPON_CODE }),
        responseData: data, error: null
      });
    }).catch(function(err) {
      console.log('[PFC-Tradeify] Coupon apply error:', err);
      couponApplied = false; // Allow retry
    });
  }

  // --- Extract plan ID from URL ---
  function getPlanIdFromUrl() {
    var match = window.location.search.match(/plan_id=([^&]+)/);
    return match ? match[1] : null;
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

    // When plandetails is fetched, also apply coupon
    if (url.includes('plandetails') && !couponApplied) {
      var planId = getPlanIdFromUrl();
      if (planId) {
        // Apply coupon immediately (don't wait)
        applyCouponAPI(planId);
      }
    }

    return origFetch.apply(this, args).then(function(response) {
      var clone = response.clone();
      var status = response.status;
      clone.text().then(function(text) {
        var jsonData = null;
        try { jsonData = JSON.parse(text); } catch(e) {}
        dispatch('fetch', {
          url: url, method: method, status: status,
          requestBody: typeof reqBody === 'string' ? reqBody : safeStringify(reqBody),
          responseData: jsonData, error: null
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
      // Trigger coupon apply when plandetails is fetched via XHR (not just fetch)
      if (url.includes('plandetails') && !couponApplied) {
        var planId = getPlanIdFromUrl();
        if (planId) {
          applyCouponAPI(planId);
        }
      }

      xhr.addEventListener('load', function() {
        var jsonData = null;
        try { jsonData = JSON.parse(xhr.responseText); } catch(e) {}
        dispatch('xhr', {
          url: url, method: xhr.__pfc_method, status: xhr.status,
          requestBody: typeof body === 'string' ? body : safeStringify(body),
          responseData: jsonData, error: null
        });
      });
    }

    return origSend.apply(this, arguments);
  };

  // --- Debug bridge ---
  var capturedRequests = [];
  window.__pfcTradeifyNet = {
    log: capturedRequests,
    count: function() { return capturedRequests.length; },
    show: function() {
      console.log('[PFC-Tradeify] Captured requests:', capturedRequests.length);
      capturedRequests.forEach(function(r, i) {
        console.log('  [' + i + ']', r.method, r.url, '→', r.status);
      });
      return capturedRequests;
    }
  };

  // --- Auto-apply coupon on checkout page load ---
  var lastCheckedUrl = '';
  function initCouponOnCheckout() {
    var currentUrl = window.location.href;
    // Skip if we already checked this exact URL
    if (currentUrl === lastCheckedUrl) return;
    lastCheckedUrl = currentUrl;

    if (window.location.pathname.includes('/checkout')) {
      var planId = getPlanIdFromUrl();
      if (planId && !couponApplied) {
        console.log('[PFC-Tradeify] Checkout detected, applying coupon...');
        // Small delay to ensure cookies are set
        setTimeout(function() {
          applyCouponAPI(planId);
        }, 100);
      }
    } else {
      // Reset couponApplied when navigating away from checkout
      // so it can re-apply on the next checkout visit
      couponApplied = false;
    }
  }

  // Run on script load
  initCouponOnCheckout();

  // SPA navigation: re-check when URL changes (pushState/replaceState)
  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function() {
    origPushState.apply(this, arguments);
    setTimeout(initCouponOnCheckout, 100);
  };
  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    setTimeout(initCouponOnCheckout, 100);
  };
  window.addEventListener('popstate', function() {
    setTimeout(initCouponOnCheckout, 100);
  });

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
})();
