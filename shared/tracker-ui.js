// tracker-ui.js — Real-time checkout tracking widget for PropFirm Compare
// Provides the on-page floating UI that shows tracking status, captured fields,
// and status messages during checkout-to-purchase flow.
(function () {
  'use strict';

  const FIELD_LABELS = {
    product: 'Product',
    price: 'Price',
    coupon: 'Coupon',
    email: 'Email',
    order_id: 'Order #'
  };

  class TrackerUI {
    constructor(config = {}) {
      this.fields = config.fields || ['product', 'price', 'coupon', 'email'];
      this.afterPurchaseFields = config.afterPurchaseFields || [];
      this.fieldValues = {};
      this.currentStatus = '';
      this.currentStatusMessage = '';
      this.isVisible = false;
      this.isMinimized = false;
      this.container = null;
      this.autoFillEl = null;
      this.messageTimeout = null;

      this._buildDOM();

      // Store globally so other scripts can access
      window.__pfcTracker = this;
    }

    _buildDOM() {
      // Only render UI in top-level frame, never in iframes
      if (window.self !== window.top) return;

      // Remove any existing tracker
      const existing = document.getElementById('pfc-checkout-tracker');
      if (existing) existing.remove();

      this.container = document.createElement('div');
      this.container.id = 'pfc-checkout-tracker';
      this.container.className = 'propfirm-checkout-tracker';
      this.container.innerHTML = this._html();

      // Wire up close/minimize button
      const closeBtn = this.container.querySelector('.propfirm-tracker-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this._toggleMinimize());
      }

      // Drag-to-move: mousedown on header starts drag
      const header = this.container.querySelector('.propfirm-tracker-header');
      if (header) {
        header.style.cursor = 'grab';
        let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;

        header.addEventListener('mousedown', (e) => {
          if (e.target.closest('.propfirm-tracker-close')) return; // Don't drag on close btn
          dragging = true;
          startX = e.clientX;
          startY = e.clientY;
          const rect = this.container.getBoundingClientRect();
          origX = rect.left;
          origY = rect.top;
          header.style.cursor = 'grabbing';
          this.container.style.transition = 'none';
          e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          this.container.style.left = (origX + dx) + 'px';
          this.container.style.top = (origY + dy) + 'px';
          this.container.style.right = 'auto';
          this.container.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
          if (!dragging) return;
          dragging = false;
          header.style.cursor = 'grab';
          this.container.style.transition = '';
        });
      }

      // Add inline styles for tracker item label/value layout
      const style = document.createElement('style');
      style.textContent = `
        .propfirm-tracker-item-label {
          font-weight: 600 !important;
          min-width: 55px !important;
          font-size: 11px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.3px !important;
          opacity: 0.7 !important;
        }
        .propfirm-tracker-item-value {
          flex: 1 !important;
          text-align: right !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          color: inherit !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        .propfirm-tracker-item.captured .propfirm-tracker-item-value {
          color: #00E5A0 !important;
        }
        .propfirm-tracker-body {
          padding: 0 !important;
        }
        .propfirm-tracker-autofill {
          margin: 0 0 8px 0 !important;
        }
        .propfirm-tracker-recording {
          display: inline-flex !important;
          align-items: center !important;
          gap: 5px !important;
          font-size: 10px !important;
          font-weight: 700 !important;
          color: #ff4444 !important;
          text-transform: uppercase !important;
          letter-spacing: 1px !important;
          margin-right: 8px !important;
        }
        .rec-dot {
          width: 8px !important;
          height: 8px !important;
          border-radius: 50% !important;
          background: #ff4444 !important;
          display: inline-block !important;
          animation: pfc-rec-pulse 1.2s ease-in-out infinite !important;
        }
        @keyframes pfc-rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `;
      this.container.appendChild(style);

      document.documentElement.appendChild(this.container);
    }

    _html() {
      const fieldItems = this.fields.map(f => {
        const label = FIELD_LABELS[f] || f;
        return `<li class="propfirm-tracker-item pending" data-field="${f}">
          <span class="propfirm-tracker-item-icon"></span>
          <span class="propfirm-tracker-item-label">${label}:</span>
          <span class="propfirm-tracker-item-value" data-field-value="${f}">--</span>
        </li>`;
      }).join('');

      return `
        <div class="propfirm-tracker-header">
          <span class="propfirm-tracker-recording" style="display:none;">
            <span class="rec-dot"></span> REC
          </span>
          <span class="propfirm-tracker-title">PropFirm Tracker</span>
          <button class="propfirm-tracker-close" title="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div class="propfirm-tracker-body">
          <div class="propfirm-tracker-status">
            <div class="propfirm-tracker-spinner"></div>
            <span class="propfirm-tracker-status-text">Initializing...</span>
          </div>
          <div class="propfirm-tracker-autofill" style="display:none;"></div>
          <ul class="propfirm-tracker-checklist">${fieldItems}</ul>
          <div class="propfirm-tracker-message" style="display:none;"></div>
        </div>
      `;
    }

    // --- Public API ---

    show() {
      if (!this.container) this._buildDOM();
      this.isVisible = true;
      this.isMinimized = false;
      this.container.classList.add('visible');
      const body = this.container.querySelector('.propfirm-tracker-body');
      if (body) body.style.display = '';
    }

    hide() {
      this.isVisible = false;
      if (this.container) this.container.classList.remove('visible');
    }

    setStatus(status, message) {
      this.currentStatus = status;
      this.currentStatusMessage = message || '';

      const statusEl = this.container?.querySelector('.propfirm-tracker-status');
      const textEl = this.container?.querySelector('.propfirm-tracker-status-text');
      if (!statusEl || !textEl) return;

      // Remove old state classes
      statusEl.classList.remove('success', 'error', 'warning', 'waiting-order', 'order-confirmed');

      // Map status to CSS class
      const classMap = {
        success: 'success',
        error: 'error',
        warning: 'warning',
        waiting: '',
        capturing: '',
        submitting: '',
        idle: ''
      };

      const cls = classMap[status];
      if (cls) statusEl.classList.add(cls);

      // Update border color on container
      if (this.container) {
        this.container.classList.remove('success', 'warning', 'error');
        if (cls === 'success' || cls === 'warning' || cls === 'error') {
          this.container.classList.add(cls);
        }
      }

      textEl.textContent = message || status || 'Ready';
    }

    showMessage(type, message) {
      const msgEl = this.container?.querySelector('.propfirm-tracker-message');
      if (!msgEl) return;

      // Clear previous timeout
      if (this.messageTimeout) {
        clearTimeout(this.messageTimeout);
        this.messageTimeout = null;
      }

      // Set class based on type
      msgEl.className = 'propfirm-tracker-message';
      if (type === 'success') msgEl.className += ' propfirm-tracker-success';
      else if (type === 'error') msgEl.className += ' propfirm-tracker-error';
      else if (type === 'warning') msgEl.className += ' propfirm-tracker-warning';
      else msgEl.className += ' propfirm-tracker-success'; // info defaults to success style

      msgEl.textContent = message;
      msgEl.style.display = 'block';

      // Auto-hide after 8 seconds for success/info, keep errors visible
      if (type !== 'error') {
        this.messageTimeout = setTimeout(() => {
          msgEl.style.display = 'none';
        }, 8000);
      }
    }

    updateField(fieldName, value, displayText) {
      this.fieldValues[fieldName] = { value, displayText };

      const itemEl = this.container?.querySelector(`.propfirm-tracker-item[data-field="${fieldName}"]`);
      const valueEl = this.container?.querySelector(`[data-field-value="${fieldName}"]`);
      if (!itemEl || !valueEl) return;

      // Mark as captured
      itemEl.classList.remove('pending', 'waiting-purchase');
      itemEl.classList.add('captured');

      // Show display text if provided, otherwise value
      const display = displayText || value || '--';
      // Truncate long values
      valueEl.textContent = String(display).length > 40
        ? String(display).substring(0, 37) + '...'
        : String(display);
      valueEl.title = String(display);
    }

    clearField(fieldName) {
      delete this.fieldValues[fieldName];

      const itemEl = this.container?.querySelector(`.propfirm-tracker-item[data-field="${fieldName}"]`);
      const valueEl = this.container?.querySelector(`[data-field-value="${fieldName}"]`);
      if (!itemEl || !valueEl) return;

      itemEl.classList.remove('captured', 'waiting-purchase');
      itemEl.classList.add('pending');
      valueEl.textContent = '--';
      valueEl.title = '';
    }

    setAutoFillStatus(status, message) {
      const el = this.container?.querySelector('.propfirm-tracker-autofill');
      if (!el) return;

      if (status === 'hidden' || !message) {
        el.style.display = 'none';
        el.textContent = '';
        return;
      }

      el.style.display = 'block';
      el.textContent = message;
      el.className = 'propfirm-tracker-autofill';

      if (status === 'success') {
        el.style.color = '#00E5A0';
        el.style.background = 'rgba(0, 229, 160, 0.1)';
        el.style.border = '1px solid rgba(0, 229, 160, 0.3)';
      } else if (status === 'error') {
        el.style.color = '#ff5252';
        el.style.background = 'rgba(255, 82, 82, 0.1)';
        el.style.border = '1px solid rgba(255, 82, 82, 0.3)';
      } else if (status === 'warning') {
        el.style.color = '#ff9800';
        el.style.background = 'rgba(255, 152, 0, 0.1)';
        el.style.border = '1px solid rgba(255, 152, 0, 0.3)';
      }

      el.style.padding = '6px 10px';
      el.style.borderRadius = '6px';
      el.style.fontSize = '11px';
      el.style.marginBottom = '8px';

      // Auto-hide after 5 seconds
      setTimeout(() => {
        el.style.display = 'none';
      }, 5000);
    }

    formatPrice(originalPrice, finalPrice) {
      const fmt = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
        if (isNaN(n)) return String(v);
        return '$' + n.toFixed(2);
      };

      const orig = fmt(originalPrice);
      const final_ = fmt(finalPrice);

      if (orig && final_ && orig !== final_) {
        return `${orig} → ${final_}`;
      }
      return final_ || orig || '';
    }

    // --- Recording indicator ---

    startRecording() {
      const el = this.container?.querySelector('.propfirm-tracker-recording');
      if (el) el.style.display = 'inline-flex';
    }

    stopRecording() {
      const el = this.container?.querySelector('.propfirm-tracker-recording');
      if (el) el.style.display = 'none';
    }

    // --- Private helpers ---

    _toggleMinimize() {
      if (this.isMinimized) {
        // Expand
        this.isMinimized = false;
        const body = this.container.querySelector('.propfirm-tracker-body');
        if (body) body.style.display = '';
        const closeBtn = this.container.querySelector('.propfirm-tracker-close svg');
        if (closeBtn) {
          closeBtn.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"/>';
        }
      } else {
        // Minimize
        this.isMinimized = true;
        const body = this.container.querySelector('.propfirm-tracker-body');
        if (body) body.style.display = 'none';
        const closeBtn = this.container.querySelector('.propfirm-tracker-close svg');
        if (closeBtn) {
          closeBtn.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
        }
      }
    }
  }

  // Expose globally
  window.TrackerUI = TrackerUI;
})();
