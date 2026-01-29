# PropFirm Compare - Chrome Extension

A Chrome extension that automatically detects trading prop firm forms and applies available discount codes, similar to Honey.com but specialized for prop firms.

## 🚀 Features

- ✅ **Automatic detection** of popular prop firms (FTMO, MyForexFunds, The5ers, etc.)
- ✅ **Automatic application** of discount codes
- ✅ **Visual banner** showing available codes
- ✅ **Interactive popup** with statistics and settings
- ✅ **Copy codes** to clipboard with one click
- ✅ **Usage statistics** and money saved
- ✅ **Customizable settings** (auto-apply, notifications)
- ✅ **Modern and responsive** interface

## 📦 Installation

### Method 1: Developer Installation (Recommended for testing)

1. **Clone or download** this repository
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer mode** (toggle in top right corner)
4. **Click "Load unpacked extension"**
5. **Select the project folder**
6. **Done!** The extension will appear in your toolbar

### Method 2: Installation from Chrome Web Store (Coming Soon)

*The extension will be available on Chrome Web Store soon.*

## 🎯 Supported Prop Firms

Currently the extension detects and works with:

- **My Funded Futures** (50% OFF) - myfundedfutures.com
- **Apex Trader Funding** (80% OFF) - apextraderfunding.com  
- **Lucid Trading** (40% OFF) - lucidtrading.com
- **Tradeify** (35% OFF) - tradeify.co
- **Funding Ticks** (10% OFF) - fundingticks.com
- **PropFirm Compare** (20% OFF) - propfirm.compare

All firms use the universal discount code: **LAB**

### 🆕 JSON Configuration System v2.1.0

The extension now uses a **flexible JSON configuration system** with advanced features:

- ✅ **Add new prop firms** without coding
- ✅ **Update discount codes** instantly  
- ✅ **Modify CSS selectors** for different sites
- ✅ **Enable/disable codes** dynamically
- ✅ **Automatic subdomain support**
- 🆕 **Trigger button detection** - automatically clicks "Have a discount?" buttons
- 🆕 **Hidden field expansion** - reveals coupon fields that are initially hidden

**Configuration**: `config/propfirms.json`  
**Documentation**: `config/README.md`  
**Test Page**: `test-trigger-buttons.html`

```bash
# Validate configuration
cd config && node validate-config.js
```

#### 🔘 Trigger Button Support

Many prop firms hide coupon fields behind buttons like:
- "Have a discount code?" 
- "Apply coupon"
- "Use promo code"

The extension now **automatically detects and clicks** these buttons to reveal hidden coupon fields!

## 🔧 Usage

### Automatic
1. **Navigate** to any supported prop firm page
2. **Go to a checkout/payment page**
3. The extension will **automatically detect** forms
4. **A banner will appear** showing available codes
5. If you have **auto-apply enabled**, the best code will be applied

### Manual
1. **Click** the extension icon in your toolbar
2. **View available codes** for the current prop firm
3. **Copy codes** or **apply automatically**
4. **Configure** options according to your preferences

## ⚙️ Settings

The extension includes the following configurable options:

- **Auto-apply**: Automatically applies the best available code
- **Notifications**: Shows notifications when a code is applied
- **Statistics**: Tracks codes applied and money saved

Access settings by clicking the extension icon.

## 🏗️ Project Structure

```
propfirmcompare-plugin/
├── manifest.json          # Extension configuration
├── background.js          # Background script
├── content.js            # Content script (injected into pages)
├── content.css           # Styles for injected elements
├── popup.html            # Popup interface
├── popup.css             # Popup styles
├── popup.js              # Popup logic
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # This file
```

## 🔍 How It Works

### 1. Prop Firm Detection
The extension analyzes the current URL and compares it with a database of known prop firm domains.

### 2. Form Detection
Uses intelligent CSS selectors to find:
- Checkout/payment forms
- Discount code/coupon fields
- Apply/submit buttons

### 3. Code Application
- Simulates human typing character by character
- Searches for and clicks apply buttons
- Verifies if the code was applied successfully
- Tries multiple codes until finding one that works

### 4. User Interface
- Non-intrusive banner near coupon fields
- Complete popup with statistics and settings
- Success/error notifications
- Smooth animations and modern design

## 🛠️ Development

### Prerequisites
- Google Chrome (or Chromium)
- Code editor (VS Code recommended)
- Basic knowledge of HTML, CSS, JavaScript

### Development Environment Setup

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd propfirmcompare-plugin
   ```

2. **Load extension in developer mode**
   - Go to `chrome://extensions/`
   - Enable developer mode
   - Load unpacked extension

3. **Make changes and reload**
   - Modify files as needed
   - Click "Reload" on extensions page
   - Test changes

### Adding New Prop Firms

To add support for a new prop firm, edit the `background.js` file:

```javascript
// In the fetchPropFirmsData() function, add:
{
  name: "NewPropFirm",
  domains: ["newpropfirm.com", "www.newpropfirm.com"],
  selectors: {
    couponField: "input[name='discount_code']",
    submitButton: "button.apply-code",
    priceElement: ".total-price"
  },
  codes: [
    { 
      code: "DISCOUNT10", 
      discount: "10%", 
      description: "10% discount on challenges" 
    }
  ]
}
```

### Adding New Codes

Codes can be added directly to the database in `background.js` or connected to an external API for dynamic codes.

## 📈 Roadmap

### Version 1.1
- [ ] More supported prop firms
- [ ] External API for dynamic codes
- [ ] Applied codes history
- [ ] Export statistics

### Version 1.2
- [ ] Cross-device synchronization
- [ ] Exclusive codes and notifications
- [ ] Points/rewards system integration
- [ ] Advanced savings analysis

### Version 2.0
- [ ] Multi-browser support (Firefox, Edge)
- [ ] Price comparison between prop firms
- [ ] New codes available alerts
- [ ] User community for code sharing

## 🐛 Bug Reports

Found a bug or have a suggestion? 

1. **Check** that the issue isn't already reported in Issues
2. **Create a new Issue** with:
   - Detailed problem description
   - Steps to reproduce
   - Screenshots if possible
   - Browser and extension version information

## 🤝 Contributing

Contributions are welcome! 

1. **Fork** the repository
2. **Create** a branch for your feature (`git checkout -b feature/new-feature`)
3. **Commit** your changes (`git commit -m 'Add new feature'`)
4. **Push** to the branch (`git push origin feature/new-feature`)
5. **Open** a Pull Request

## 📄 License

This project is under the MIT License - see the [LICENSE](LICENSE) file for more details.

## 🙏 Acknowledgments

- Inspired by Honey.com for user experience
- Trading community for feedback and suggestions
- Chrome Extensions API documentation

## 📞 Contact

- **Website**: [PropFirm Compare](https://propfirmcompare.com)
- **Email**: support@propfirmcompare.com
- **Twitter**: [@PropFirmCompare](https://twitter.com/propfirmcompare)

---

**⚠️ Disclaimer**: This extension is an independent tool not officially affiliated with the mentioned prop firms. Use it at your own responsibility and always verify the terms and conditions of each prop firm before using discount codes. 