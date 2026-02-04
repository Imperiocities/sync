/**
 * MyFundedFutures Network Interceptor — Runs in MAIN WORLD
 *
 * This script overrides fetch/XHR in the page's main execution
 * context (where MFF's Next.js app runs). Captured data is dispatched back
 * to the content script via CustomEvent on the document.
 *
 * Registered in manifest.json with "world": "MAIN" to bypass CSP.
 */
(function() {
  'use strict';
  if (window.__pfcMffNetInterceptInstalled) return;
  window.__pfcMffNetInterceptInstalled = true;

  function isMffReq(url) {
    if (!url) return false;
    if (url.includes('myfundedfutures.com')) return true;
    if (url.includes('fundedcms.com')) return true;
    if (url.startsWith('/')) return true;
    if (url.startsWith('api/') || url.startsWith('./')) return true;
    if (/^https?:\/\//.test(url) &&
        !url.includes('myfundedfutures.com') &&
        !url.includes('fundedcms.com')) return false;
    return true;
  }

  function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch(e) { return null; }
  }

  function dispatch(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent('__pfc_mff_net', {
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

    if (!isMffReq(url)) return origFetch.apply(this, args);

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

    if (url && isMffReq(url)) {
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

  // --- Debug bridge ---
  var capturedRequests = [];
  window.__pfcMffNet = {
    log: capturedRequests,
    count: function() { return capturedRequests.length; },
    show: function() {
      console.log('[PFC-MFF] Captured network requests:', capturedRequests.length);
      capturedRequests.forEach(function(r, i) {
        console.log('  [' + i + ']', r.method, r.url, '→', r.status);
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
