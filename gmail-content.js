(() => {
  if (window.__AI_GMAIL_SENDER_AGENT_LOADED__) {
    return;
  }
  window.__AI_GMAIL_SENDER_AGENT_LOADED__ = true;

  const SELECTORS = Object.freeze({
    composeButton: ['div[gh="cm"]', '.T-I-KE'],
    composeDialog: ['div[role="dialog"]', '.nH.Hd', '.AD'],
    toInput: [
      'input[aria-label="To recipients"]',
      'input[aria-label*="To"]',
      'input[peoplekit-id]',
      'div[name="to"] input',
      'textarea[name="to"]'
    ],
    subjectInput: [
      'input[name="subjectbox"]',
      'input[aria-label="Add a subject"]',
      'input[placeholder*="Subject"]'
    ],
    bodyTextbox: [
      'div[role="textbox"][aria-label*="Message Body"]',
      'div[role="textbox"][contenteditable="true"]',
      'div.Am.Al.editable[contenteditable="true"]'
    ],
    sendButton: [
      'div[role="button"][data-tooltip^="Send"]',
      'div[role="button"][aria-label^="Send"]',
      'div[data-testid="send-button"]',
      '.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3'
    ]
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const matches = root.querySelectorAll(selector);
      for (const el of matches) {
        if (isVisible(el)) {
          return el;
        }
      }
      if (matches.length > 0) {
        return matches[0];
      }
    }
    return null;
  }

  async function waitForElement(selectors, { root = document, timeoutMs = 8000, intervalMs = 150 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = queryFirst(selectors, root);
      if (el) {
        return el;
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for element matching: ${selectors.join(', ')}`);
  }

  function dispatchKeyEvent(target, type, key, code, keyCode) {
    const eventInit = {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    target.dispatchEvent(new KeyboardEvent(type, eventInit));
  }

  function triggerHumanClick(el) {
    el.focus();
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function getActiveComposeRoot() {
    const dialogs = Array.from(document.querySelectorAll(SELECTORS.composeDialog.join(','))).filter(isVisible);
    if (dialogs.length > 0) {
      return dialogs[dialogs.length - 1];
    }
    return document;
  }

  async function openComposeEditor() {
    let composeRoot = getActiveComposeRoot();
    const existingSubject = queryFirst(SELECTORS.subjectInput, composeRoot);
    const existingBody = queryFirst(SELECTORS.bodyTextbox, composeRoot);

    if (existingSubject && existingBody) {
      return composeRoot;
    }

    const composeBtn = await waitForElement(SELECTORS.composeButton, {
      root: document,
      timeoutMs: 8000
    });
    triggerHumanClick(composeBtn);

    await sleep(300);
    composeRoot = getActiveComposeRoot();
    await waitForElement(SELECTORS.bodyTextbox, {
      root: composeRoot,
      timeoutMs: 8000
    });

    return getActiveComposeRoot();
  }

  async function fillRecipient(composeRoot, email) {
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new Error('Recipient email address is required.');
    }

    const cleanEmail = email.trim();
    const toInput = await waitForElement(SELECTORS.toInput, {
      root: composeRoot,
      timeoutMs: 6000
    });

    triggerHumanClick(toInput);
    await sleep(100);

    toInput.value = cleanEmail;
    toInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    toInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    await sleep(120);
    dispatchKeyEvent(toInput, 'keydown', 'Enter', 'Enter', 13);
    dispatchKeyEvent(toInput, 'keypress', 'Enter', 'Enter', 13);
    dispatchKeyEvent(toInput, 'keyup', 'Enter', 'Enter', 13);

    await sleep(250);
  }

  async function fillSubject(composeRoot, subject) {
    const subjectInput = await waitForElement(SELECTORS.subjectInput, {
      root: composeRoot,
      timeoutMs: 6000
    });

    triggerHumanClick(subjectInput);
    subjectInput.value = subject ?? '';
    subjectInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    subjectInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    await sleep(120);
  }

  async function fillBody(composeRoot, htmlBody) {
    const bodyBox = await waitForElement(SELECTORS.bodyTextbox, {
      root: composeRoot,
      timeoutMs: 6000
    });

    triggerHumanClick(bodyBox);
    bodyBox.innerHTML = htmlBody ?? '';
    bodyBox.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    bodyBox.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    await sleep(150);
  }

  async function clickSend(composeRoot) {
    const sendBtn = await waitForElement(SELECTORS.sendButton, {
      root: composeRoot,
      timeoutMs: 6000
    });

    triggerHumanClick(sendBtn);
    await sleep(400);
  }

  function handleInspect() {
    const composeBtn = queryFirst(SELECTORS.composeButton, document);
    const composeRoot = getActiveComposeRoot();
    const toInput = queryFirst(SELECTORS.toInput, composeRoot);
    const subjectInput = queryFirst(SELECTORS.subjectInput, composeRoot);
    const bodyTextbox = queryFirst(SELECTORS.bodyTextbox, composeRoot);
    const sendButton = queryFirst(SELECTORS.sendButton, composeRoot);

    const isGmailInterface =
      window.location.hostname === 'mail.google.com' &&
      Boolean(composeBtn || bodyTextbox || document.querySelector('[gh="tl"]'));

    return {
      ok: true,
      action: 'INSPECT',
      isGmailInterface,
      url: window.location.href,
      elements: {
        composeButton: Boolean(composeBtn),
        toInput: Boolean(toInput),
        subjectInput: Boolean(subjectInput),
        bodyTextbox: Boolean(bodyTextbox),
        sendButton: Boolean(sendButton)
      }
    };
  }

  async function handleComposeAndFill(payload = {}) {
    const {
      to,
      recipient,
      email,
      subject = '',
      html = '',
      body = '',
      isDryRun = true
    } = payload;

    const targetEmail = to || recipient || email;
    const targetHtml = html || body;

    const composeRoot = await openComposeEditor();
    await fillRecipient(composeRoot, targetEmail);
    await fillSubject(composeRoot, subject);
    await fillBody(composeRoot, targetHtml);

    if (Boolean(isDryRun)) {
      return {
        ok: true,
        action: 'COMPOSE_AND_FILL',
        dryRun: true,
        sent: false,
        recipient: targetEmail.trim(),
        message: 'Composed and populated draft in dry-run mode without clicking Send.'
      };
    }

    await clickSend(composeRoot);

    return {
      ok: true,
      action: 'COMPOSE_AND_FILL',
      dryRun: false,
      sent: true,
      recipient: targetEmail.trim(),
      message: 'Composed email and triggered Send button.'
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }

    if (message.type === 'INSPECT') {
      (async () => {
        try {
          const result = handleInspect();
          sendResponse(result);
        } catch (err) {
          sendResponse({
            ok: false,
            action: 'INSPECT',
            error: err instanceof Error ? err.message : String(err)
          });
        }
      })();
      return true;
    }

    if (message.type === 'COMPOSE_AND_FILL') {
      (async () => {
        try {
          const payload = message.payload && typeof message.payload === 'object'
            ? message.payload
            : message;
          const result = await handleComposeAndFill(payload);
          sendResponse(result);
        } catch (err) {
          sendResponse({
            ok: false,
            action: 'COMPOSE_AND_FILL',
            error: err instanceof Error ? err.message : String(err)
          });
        }
      })();
      return true;
    }

    return false;
  });
})();
