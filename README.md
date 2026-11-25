# Ai GMAIL SENDER AGENT (v1.0.3)

**Ai GMAIL SENDER AGENT** is a Manifest V3 Chrome Extension built for sequential, personalized email outreach directly through Gmail's native browser interface. It eliminates external SMTP setups by automating compose, recipient insertion, dynamic placeholder replacement, and controlled delay queues right inside your active Gmail tab.

---

## Key Features & Specialties

* **Native Gmail DOM Automation:** Interacts directly with Gmail's compose interface (`https://mail.google.com/*`) without requiring third-party email APIs or app passwords.
* **Dynamic Personalization Placeholders:** Automatically replaces `{{name}}`, `{{company}}`, and `{{website}}` tokens in both the subject line and HTML proposal body for every recipient.
* **Safe Dry-Run Mode:** Populates the recipient, subject, and body inside Gmail's compose window without clicking **Send**, allowing safe formatting and variable checks before live campaigns.
* **Sequential Queue & Delay Control:** Uses the Chrome Alarms API (`chrome.alarms`) to enforce configurable intervals (`1` to `3600` seconds) and maximum batch caps (`1` to `500` emails) per run.
* **Full Job Lifecycle Controls:** Start, pause, resume, or stop active email queues at any time with persistent state recovery in `chrome.storage.local`.
* **Rich Proposal Editor & Template Manager:** Includes debounced draft auto-saving, one-click placeholder insertion buttons, and reusable proposal templates stored locally.
* **Real-Time Activity Feed & Telemetry:** Displays live counts for Total, Sent, Failed, and Remaining recipients alongside timestamped execution logs.

---

## Project Folder Structure

```text
ai-gmail-sender-agent/
├── manifest.json          # Chrome Extension Manifest V3 configuration
├── background.js          # Service worker managing job queue, alarms, and tab messaging
├── gmail-content.js       # Content script automating Gmail compose and send DOM actions
├── storage.js             # Local storage schema, state normalization, and persistence helpers
├── utils.js               # Placeholder parser, sleep promise, and time formatting utilities
├── proposal-editor.js     # Rich-text editor initialization, tag insertion, and debounced auto-save
├── templates.js           # Saved templates CRUD rendering and editor loading logic
├── dashboard.html         # Full-tab agent control center and workspace UI
├── dashboard.css          # Modern 3D blue-and-white dashboard theme
├── dashboard.js           # Dashboard UI controller, CSV parser, and live log polling
├── assets/
│   ├── icon16.png         # 16x16 toolbar/favicon icon
│   ├── icon32.png         # 32x32 extension icon
│   ├── icon48.png         # 48x48 extension management icon
│   └── icon128.png        # 128x128 Chrome Web Store / detail icon
└── README.md              # Project documentation
