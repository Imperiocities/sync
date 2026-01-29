// auth-listener.js
// Injected into propfirm.compare/extension-auth pages
// Listens for authentication messages from the web page and relays to background script

(function() {
  // Wrap in IIFE to avoid variable conflicts with content.js
  const AUTH_DEBUG = true; // Enable for testing

  const authLog = (...args) => {
    if (AUTH_DEBUG) {
      console.log('[PropFirm Auth Listener]', ...args);
    }
  };

  authLog('🔐 Auth listener script loaded on:', window.location.href);

  // Listen for postMessage from the auth page
  window.addEventListener("message", (event) => {
    // Verify the message origin matches our domains
    const allowedOrigins = [
      'https://propfirm.compare',
      'https://prop-firm-compare-env-develop-junos-projects-17951c31.vercel.app'
    ];
    
    if (!allowedOrigins.some(origin => event.origin.startsWith(origin))) {
      authLog('❌ Ignoring message from untrusted origin:', event.origin);
      return;
    }

    // Check for our specific auth message type
    if (event.data?.type === "PROPFIRM_COMPARE_AUTH" && event.data.success) {
      authLog('✅ Received auth success message:', {
        user_id: event.data.user_id,
        email: event.data.email,
        name: event.data.name,
        hasToken: !!event.data.token
      });
      
      // Send to background script
      chrome.runtime.sendMessage({
        action: "AUTH_SUCCESS",
        token: event.data.token,
        user_id: event.data.user_id,
        email: event.data.email,
        name: event.data.name
      }, (response) => {
        if (chrome.runtime.lastError) {
          authLog('❌ Error sending auth to background:', chrome.runtime.lastError);
        } else {
          authLog('✅ Auth successfully sent to background script');
        }
      });
    }
  });

  // Also listen for auth via custom events (fallback method)
  document.addEventListener("propfirm-auth-success", (event) => {
    const detail = event.detail;
    
    if (detail?.success && detail?.token) {
      authLog('✅ Received auth via custom event:', {
        user_id: detail.user_id,
        email: detail.email
      });
      
      chrome.runtime.sendMessage({
        action: "AUTH_SUCCESS",
        token: detail.token,
        user_id: detail.user_id,
        email: detail.email,
        name: detail.name
      });
    }
  });

  authLog('🎯 Auth listener ready and waiting for authentication');
})();

