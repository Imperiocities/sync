# PropFirm Compare Chrome Extension - Installation & Testing Guide

## Table of Contents
1. [Download & Installation](#download--installation)
2. [Creating an Account](#creating-an-account)
3. [Connecting Your Account](#connecting-your-account)
4. [Testing the Features](#testing-the-features)
5. [Troubleshooting](#troubleshooting)

---

## Download & Installation

### Step 1: Get the Extension Files

**Option A: Download from Repository**
1. Go to the GitHub repository
2. Click the green **"Code"** button
3. Select **"Download ZIP"**
4. Extract the ZIP file to a folder on your computer (e.g., `Desktop/propfirmcompare-extension`)

**Option B: Clone with Git**
```bash
git clone https://github.com/your-repo/propfirmcompare-chrome-extension.git
```

### Step 2: Load the Extension in Chrome

1. Open Google Chrome
2. Navigate to `chrome://extensions/` (type this in the address bar)
3. Enable **"Developer mode"** (toggle in the top-right corner)
4. Click **"Load unpacked"** button (top-left)
5. Select the folder containing the extension files (where `manifest.json` is located)
6. The extension should now appear in your extensions list

### Step 3: Pin the Extension

1. Click the puzzle piece icon (🧩) in Chrome's toolbar
2. Find **"PropFirm Compare Rewards"**
3. Click the pin icon to pin it to your toolbar

✅ **Installation Complete!** You should see the PropFirm Compare icon in your toolbar.

---

## Creating an Account

### Step 1: Visit PropFirm Compare Website

1. Go to [https://propfirm.compare](https://propfirm.compare)
2. Click **"Sign Up"** or **"Create Account"**

### Step 2: Complete Registration

1. **Option 1: Email Registration**
   - Enter your email address
   - Create a password
   - Verify your email via the confirmation link

2. **Option 2: Social Login**
   - Click **"Continue with Google"** or **"Continue with Discord"**
   - Authorize the connection

### Step 3: Complete Your Profile (Optional)

1. Add a display name (this will show in the extension)
2. Upload an avatar (optional)
3. Set up your rewards email for each prop firm (important for tracking purchases)

---

## Connecting Your Account

### Step 1: Open the Extension

1. Click the PropFirm Compare icon in your Chrome toolbar
2. You'll see a welcome screen with onboarding slides
3. Click through the onboarding (5 steps) to learn about features:
   - Welcome
   - Floating Icon
   - Checkout Reminder
   - Auto-fill Feature
   - All Set!

### Step 2: Navigate to Rewards Tab

1. In the extension popup, click the **"Rewards"** tab
2. You'll see the "Not Connected" state with a **"Connect Account"** button

### Step 3: Connect Your Account

1. Click **"Connect Account"**
2. A popup window will open with the PropFirm Compare login page
3. **If already logged in**: The connection happens automatically
4. **If not logged in**: Sign in with your credentials
5. Once authenticated, the popup will close automatically
6. Your extension is now connected! You'll see:
   - Your display name
   - Your loyalty points
   - Total saved amount
   - Recent purchases

---

## Testing the Features

### Test 1: Floating Icon on Prop Firm Websites

1. Visit any supported prop firm website:
   - [FundedNext](https://fundednext.com)
   - [My Funded Futures](https://myfundedfutures.com)
   - [Tradeify](https://tradeify.co)
   - [Take Profit Trader](https://takeprofittrader.com)
   - [Alpha Futures](https://alpha-futures.com)

2. Look for the floating icon on the right side of the screen
   - It appears as a dark box with the PropFirm Compare logo
   - Shows a green accent stripe on the right edge
   - Displays a tooltip with the discount percentage on hover

3. **NEW: You can drag the icon up/down!**
   - Click and drag the icon vertically
   - It stays locked to the right edge
   - Your position is saved and persists across page loads

4. Click the floating icon to:
   - See the available discount code
   - Copy the code with one click
   - View the discount percentage

### Test 2: Auto-Fill on Checkout

1. Go to a prop firm checkout page (e.g., select an account type and proceed to checkout)
2. Watch for:
   - **Checkout Reminder Popup**: A modal appears asking if you want to apply the discount
   - **Auto-Fill**: The discount code is automatically entered and applied
   - The coupon field gets filled with our partner code (e.g., "LAB")

3. Example test flow for **My Funded Futures**:
   - Visit [myfundedfutures.com](https://myfundedfutures.com)
   - Select any account (e.g., 50K Starter)
   - Click "Buy Now" → You'll be taken to checkout
   - Watch the extension auto-fill the discount code
   - Verify the discount is applied to your total

### Test 3: Purchase Tracking

1. Complete a test purchase (or a real one!)
2. After successful payment, you should see:
   - The thank-you/confirmation page
   - The extension captures: product name, price, discount, email, order number
   
3. Open the extension popup → **Rewards** tab
4. You should see:
   - Updated "Total Saved" amount
   - The purchase in "Recent Purchases"
   - Loyalty points awarded

### Test 4: Manual Submission (If Tracking Fails)

If a purchase wasn't tracked automatically:

1. Open the extension → **Rewards** tab
2. If there's a pending purchase, you'll see an **orange alert**:
   ```
   ⚠️ Purchase Not Tracked
   My Funded Futures: Pro 150K ($315.00)
   Captured 5m ago
   [Submit Now] [Wrong Data? Clear]
   ```

3. Click **"Submit Now"** if the data is correct
4. Click **"Wrong Data? Clear"** if it captured the wrong product

### Test 5: Settings Toggle

1. Open the extension → **Settings** tab
2. Test toggling each feature:
   - **Checkout Reminders**: Turn off to disable the popup on checkout pages
   - **Floating Icon**: Turn off to hide the icon on prop firm sites
   - **Auto-fill Codes**: Turn off to prevent automatic code entry

3. Visit a prop firm site and verify the settings take effect

---

## Troubleshooting

### Extension Not Loading

1. Check `chrome://extensions/` for errors
2. Click **"Reload"** on the extension card
3. Check the background script console:
   - Click **"Service Worker"** link on the extension card
   - Look for error messages in red

### Floating Icon Not Appearing

1. Ensure you're on a supported prop firm website
2. Check Settings → "Floating Icon" is enabled
3. The icon may take 1-2 seconds to appear after page load
4. Try refreshing the page (Cmd/Ctrl + R)

### Auto-Fill Not Working

1. Check Settings → "Auto-fill Codes" is enabled
2. Some sites have unique checkout flows that may require manual code entry
3. Open DevTools (F12) → Console to see debug logs prefixed with 🎯

### Account Not Connecting

1. Ensure you're logged into propfirm.compare
2. Try clearing extension storage:
   - Open DevTools on any page
   - Go to Application → Storage → Local Storage
   - Clear entries starting with `propfirm`
3. Click "Connect Account" again

### Purchases Not Being Tracked

1. Ensure you're logged into the extension
2. The extension tracks purchases when:
   - A valid discount code was used (e.g., "LAB")
   - You complete the checkout and reach the thank-you page
3. Check for the orange "Pending Purchase" alert in the Rewards tab
4. If stuck, use "Submit Now" or contact support

### Debug Mode

For advanced troubleshooting, open the browser console (F12 → Console) on a prop firm page:

```javascript
// View current pending purchase data
chrome.storage.local.get('pending_purchase', console.log);

// View user auth data
chrome.storage.local.get(['token', 'user_id', 'email'], console.log);

// Export debug data (on prop firm pages)
PropFirmDebugTracker.exportData();
```

---

## Supported Prop Firms

| Prop Firm | Auto-Fill | Purchase Tracking | Status |
|-----------|-----------|-------------------|--------|
| My Funded Futures | ✅ | ✅ | Fully Supported |
| FundedNext | ✅ | ✅ | Fully Supported |
| Tradeify | ✅ | ✅ | Fully Supported |
| Take Profit Trader | ✅ | ✅ | Fully Supported |
| Alpha Futures | ✅ | ✅ | Fully Supported |
| Lucid Trading | N/A | ✅ (via webhook) | Server-side |

---

## Quick Reference

| Action | How To |
|--------|--------|
| Install Extension | `chrome://extensions/` → Developer Mode → Load Unpacked |
| Create Account | [propfirm.compare](https://propfirm.compare) → Sign Up |
| Connect Account | Extension Popup → Rewards Tab → Connect Account |
| Move Floating Icon | Click and drag up/down (stays on right edge) |
| Copy Discount Code | Click floating icon → Copy Code button |
| Check Rewards | Extension Popup → Rewards Tab |
| Submit Stuck Purchase | Rewards Tab → Orange Alert → Submit Now |
| Clear Wrong Data | Rewards Tab → Orange Alert → Wrong Data? Clear |
| Toggle Features | Extension Popup → Settings Tab |

---

## Need Help?

- **Email**: support@propfirm.compare
- **Discord**: [Join our community](https://discord.gg/propfirmcompare)
- **Twitter/X**: [@propfirmcompare](https://twitter.com/propfirmcompare)
- **Website**: [propfirm.compare](https://propfirm.compare)
