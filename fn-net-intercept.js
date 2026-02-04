/**
 * FundedNext Network Interceptor — Runs in MAIN WORLD
 *
 * This script overrides fetch/XHR/console.log in the page's main execution
 * context (where FundedNext's app runs). Captured data is dispatched back
 * to the content script via CustomEvent on the document.
 *
 * Registered in manifest.json with "world": "MAIN" to bypass CSP.
 */
(function() {
  'use strict';
  if (window.__pfcFnNetInterceptInstalled) return;
  window.__pfcFnNetInterceptInstalled = true;

  function isFnReq(url) {
    if (!url) return false;
    if (url.includes('fundednext.com')) return true;
    if (url.startsWith('/')) return true;
    if (url.startsWith('api/') || url.startsWith('./')) return true;
    if (/^https?:\/\//.test(url) && !url.includes('fundednext.com')) return false;
    return true;
  }

  function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch(e) { return null; }
  }

  function dispatch(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent('__pfc_fn_net', {
        detail: JSON.stringify({ type: type, data: detail })
      }));
    } catch(e) { /* ignore */ }
  }

  // --- Fetch override ---
  var origFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    var resource = args[0];
    var options = args[1] || {};
    var url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
    var method = options.method || 'GET';
    var startTime = Date.now();
    var reqBody = options.body || null;

    if (!isFnReq(url)) return origFetch.apply(this, args);

    return origFetch.apply(this, args).then(function(response) {
      var clone = response.clone();
      var status = response.status;
      clone.text().then(function(text) {
        var jsonData = null;
        try { jsonData = JSON.parse(text); } catch(e) {}
        dispatch('fetch', {
          url: url, method: method, status: status, startTime: startTime,
          requestBody: typeof reqBody === 'string' ? reqBody : safeStringify(reqBody),
          responseData: jsonData, error: null
        });
      }).catch(function() {});
      return response;
    }).catch(function(err) {
      dispatch('fetch', {
        url: url, method: method, status: null, startTime: startTime,
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
    this.__pfc_start = Date.now();
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this;
    var url = xhr.__pfc_url;

    if (url && isFnReq(url)) {
      xhr.addEventListener('load', function() {
        var jsonData = null;
        try { jsonData = JSON.parse(xhr.responseText); } catch(e) {}
        dispatch('xhr', {
          url: url, method: xhr.__pfc_method, status: xhr.status, startTime: xhr.__pfc_start,
          requestBody: typeof body === 'string' ? body : safeStringify(body),
          responseData: jsonData, error: null
        });
      });
      xhr.addEventListener('error', function() {
        dispatch('xhr', {
          url: url, method: xhr.__pfc_method, status: 0, startTime: xhr.__pfc_start,
          requestBody: typeof body === 'string' ? body : safeStringify(body),
          responseData: null, error: 'XHR network error'
        });
      });
    }

    return origSend.apply(this, arguments);
  };

  // --- Console.log override (for payment processor callbacks) ---
  var origLog = console.log;
  console.log = function() {
    origLog.apply(console, arguments);
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      // Look for payment-related objects with transaction/order IDs
      if (arg && typeof arg === 'object') {
        // Check for transaction ID (various naming conventions)
        var txId = arg.transactionId || arg.transaction_id || arg.txId || arg.tx_id || null;
        // Check for order ID
        var orderId = arg.orderId || arg.order_id || arg.orderNumber || arg.order_number || null;
        // Check for payment status
        var status = arg.result || arg.status || arg.paymentStatus || null;

        if (txId || orderId || (status && (status === 'APPROVED' || status === 'success' || status === 'completed'))) {
          dispatch('console_payment', {
            result: status,
            transactionId: txId,
            orderId: orderId,
            errorCode: arg.errorCode || arg.error_code || null
          });
        }
      }
    }
  };

  // --- PostMessage listener (for iframe payment processors like Stripe) ---
  window.addEventListener('message', function(event) {
    try {
      var data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch(e) { return; }
      }
      if (!data || typeof data !== 'object') return;

      // Look for payment-related messages
      var txId = data.transactionId || data.transaction_id || data.paymentIntentId || null;
      var orderId = data.orderId || data.order_id || null;
      var status = data.result || data.status || data.paymentStatus || null;

      // Stripe-specific: look for payment intent IDs
      if (typeof data.id === 'string' && data.id.startsWith('pi_')) {
        txId = data.id;
      }

      if (txId || orderId || (status && (status === 'succeeded' || status === 'APPROVED' || status === 'completed'))) {
        dispatch('postmessage_payment', {
          origin: event.origin,
          result: status,
          transactionId: txId,
          orderId: orderId
        });
      }
    } catch(e) { /* ignore */ }
  });

  // --- Debug bridge: expose intercepted request count in main world ---
  var capturedRequests = [];
  window.__pfcFnNet = {
    log: capturedRequests,
    count: function() { return capturedRequests.length; },
    show: function() {
      origLog.call(console, '[PFC-FN] Captured network requests:', capturedRequests.length);
      capturedRequests.forEach(function(r, i) {
        origLog.call(console, '  [' + i + ']', r.method, r.url, '→', r.status);
      });
      return capturedRequests;
    }
  };

  // Hook into dispatch to also store locally
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
    }
    origDispatch(type, detail);
  };
})();
