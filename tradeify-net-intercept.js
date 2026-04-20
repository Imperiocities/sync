/**
 * Tradeify Network Interceptor — Runs in MAIN WORLD
 *
 * Intercepts fetch/XHR to capture plan details, pricing, and user data.
 * Dispatches events to content script via CustomEvent.
 *
 * NOTE: As of April 2026, Tradeify renamed their API endpoints:
 *   plandetails → plan-details, orderdetails → order-details
 *   couponsCheck endpoint was removed entirely.
 *   Coupon application now handled via DOM autofill in content script.
 */
(function() {
  'use strict';
  if (window.__pfcTradeifyNetInterceptInstalled) return;
  window.__pfcTradeifyNetInterceptInstalled = true;

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

  // --- SPA navigation monitoring ---
  // Dispatch a navigation event so the content script can re-check the page
  function onNavigation() {
    dispatch('navigation', { url: window.location.href });
  }

  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function() {
    origPushState.apply(this, arguments);
    setTimeout(onNavigation, 100);
  };
  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    setTimeout(onNavigation, 100);
  };
  window.addEventListener('popstate', function() {
    setTimeout(onNavigation, 100);
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
