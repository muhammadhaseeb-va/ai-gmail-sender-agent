const STORAGE_KEY = 'professor_v1_data';
const ALARM_NAME = 'ai_gmail_sender_next_step';
const DASHBOARD_PATH = 'dashboard.html';
const GMAIL_URL_PATTERN = 'https://mail.google.com/*';

const JOB_STATES = Object.freeze({
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  COMPOSING: 'COMPOSING',
  SENDING: 'SENDING',
  WAITING: 'WAITING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED'
});

const DEFAULT_STORAGE_DATA = Object.freeze({
  settings: {
    limit: 50,
    delaySeconds: 15,
    isDryRun: true
  },
  templates: [],
  recipients: [],
  currentJob: {
    status: JOB_STATES.IDLE,
    logs: []
  }
});

// In-memory queue cursor kept in sync with storage and service worker lifecycle
let activeQueue = {
  items: [],
  nextIndex: 0,
  sentCount: 0,
  limit: 50,
  delaySeconds: 15,
  isDryRun: true,
  template: null,
  isProcessing: false
};

// ============================================================================
// Storage & Logging Helpers
// ============================================================================

function normalizeSettings(rawSettings = {}) {
  const rawLimit = Number(rawSettings.limit);
  const rawDelay = Number(rawSettings.delaySeconds);

  return {
    limit: Number.isFinite(rawLimit)
      ? Math.min(500, Math.max(1, Math.round(rawLimit)))
      : DEFAULT_STORAGE_DATA.settings.limit,
    delaySeconds: Number.isFinite(rawDelay)
      ? Math.min(3600, Math.max(1, Math.round(rawDelay)))
      : DEFAULT_STORAGE_DATA.settings.delaySeconds,
    isDryRun:
      typeof rawSettings.isDryRun === 'boolean'
        ? rawSettings.isDryRun
        : DEFAULT_STORAGE_DATA.settings.isDryRun
  };
}

async function getData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];

  if (!raw || typeof raw !== 'object') {
    const initial = {
      settings: { ...DEFAULT_STORAGE_DATA.settings },
      templates: [],
      recipients: [],
      currentJob: {
        status: JOB_STATES.IDLE,
        logs: []
      }
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: initial });
    return initial;
  }

  return {
    settings: normalizeSettings(raw.settings),
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    recipients: Array.isArray(raw.recipients) ? raw.recipients : [],
    currentJob: {
      status: raw.currentJob?.status || JOB_STATES.IDLE,
      logs: Array.isArray(raw.currentJob?.logs) ? raw.currentJob.logs : [],
      queueState: raw.currentJob?.queueState || null
    }
  };
}

async function saveData(nextData) {
  await chrome.storage.local.set({ [STORAGE_KEY]: nextData });
  return nextData;
}

function createLogEntry(level, message, meta = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
}

async function updateJobState(status, logEntry = null, extraJobFields = {}) {
  const data = await getData();
  const logs = [...data.currentJob.logs];

  if (logEntry) {
    logs.push(logEntry);
    if (logs.length > 500) {
      logs.splice(0, logs.length - 500);
    }
  }

  const updated = {
    ...data,
    currentJob: {
      ...data.currentJob,
      ...extraJobFields,
      status,
      logs
    }
  };

  await saveData(updated);
  return updated;
}

// ============================================================================
// Template & Placeholder Helpers
// ============================================================================

function parsePlaceholders(text, recipient = {}) {
  if (typeof text !== 'string' || !text) return '';

  const map = {
    name: recipient.name ?? '',
    company: recipient.company ?? '',
    website: recipient.website ?? '',
    email: recipient.email ?? ''
  };

  return text.replace(/\{\{\s*(name|company|website|email)\s*\}\}/gi, (_, key) => {
    return String(map[key.toLowerCase()] ?? '');
  });
}

function resolveActiveTemplate(data, messagePayload = {}) {
  if (messagePayload.template && typeof messagePayload.template === 'object') {
    return messagePayload.template;
  }

  if (messagePayload.templateId && Array.isArray(data.templates)) {
    const matched = data.templates.find((t) => t && t.id === messagePayload.templateId);
    if (matched) return matched;
  }

  if (Array.isArray(data.templates) && data.templates.length > 0) {
    return data.templates[0];
  }

  return {
    subject: messagePayload.subject || 'Hello {{name}}',
    html: messagePayload.html || messagePayload.body || '<p>Hi {{name}},</p>'
  };
}

function resolveRecipients(data, messagePayload = {}) {
  if (Array.isArray(messagePayload.recipients) && messagePayload.recipients.length > 0) {
    return messagePayload.recipients;
  }
  return Array.isArray(data.recipients) ? data.recipients : [];
}

// ============================================================================
// Tab & Content Script Communication
// ============================================================================

async function findTargetGmailTab() {
  const activeTabs = await chrome.tabs.query({
    active: true,
    url: GMAIL_URL_PATTERN
  });
  if (activeTabs.length > 0) {
    return activeTabs[0];
  }

  const allGmailTabs = await chrome.tabs.query({
    url: GMAIL_URL_PATTERN
  });
  if (allGmailTabs.length > 0) {
    return allGmailTabs[0];
  }

  return null;
}

async function ensureContentScriptReady(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'INSPECT' });
    if (ping && ping.ok) {
      return;
    }
  } catch {
    // Content script may not be attached yet; inject it programmatically
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['gmail-content.js']
  });
}

async function dispatchComposeToGmail(payload) {
  const tab = await findTargetGmailTab();
  if (!tab || typeof tab.id !== 'number') {
    throw new Error('No open Gmail tab (https://mail.google.com/*) found.');
  }

  await ensureContentScriptReady(tab.id);

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'COMPOSE_AND_FILL',
    payload
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || 'Content script failed to compose or send email.');
  }

  return response;
}

// ============================================================================
// Alarm & Queue Execution Engine
// ============================================================================

async function clearScheduledAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
}

async function scheduleNextStepAlarm(delaySeconds) {
  const clampedSeconds = Math.min(3600, Math.max(1, Math.round(Number(delaySeconds) || 15)));
  const delayInMinutes = clampedSeconds / 60;

  await clearScheduledAlarm();
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes
  });
}

function snapshotQueueState() {
  return {
    items: activeQueue.items,
    nextIndex: activeQueue.nextIndex,
    sentCount: activeQueue.sentCount,
    limit: activeQueue.limit,
    delaySeconds: activeQueue.delaySeconds,
    isDryRun: activeQueue.isDryRun,
    template: activeQueue.template
  };
}

async function restoreQueueStateIfNeeded() {
  if (activeQueue.items.length > 0) {
    return true;
  }

  const data = await getData();
  const savedQueue = data.currentJob?.queueState;
  if (savedQueue && Array.isArray(savedQueue.items) && savedQueue.items.length > 0) {
    activeQueue = {
      items: savedQueue.items,
      nextIndex: Number(savedQueue.nextIndex) || 0,
      sentCount: Number(savedQueue.sentCount) || 0,
      limit: Number(savedQueue.limit) || data.settings.limit,
      delaySeconds: Number(savedQueue.delaySeconds) || data.settings.delaySeconds,
      isDryRun:
        typeof savedQueue.isDryRun === 'boolean'
          ? savedQueue.isDryRun
          : data.settings.isDryRun,
      template: savedQueue.template || resolveActiveTemplate(data),
      isProcessing: false
    };
    return true;
  }

  return false;
}

async function processNextRecipient() {
  if (activeQueue.isProcessing) {
    return;
  }

  const ready = await restoreQueueStateIfNeeded();
  if (!ready) {
    await updateJobState(JOB_STATES.IDLE, null, { queueState: null });
    return;
  }

  activeQueue.isProcessing = true;

  try {
    const currentData = await getData();
    if (
      currentData.currentJob.status === JOB_STATES.PAUSED ||
      currentData.currentJob.status === JOB_STATES.IDLE ||
      currentData.currentJob.status === JOB_STATES.COMPLETED
    ) {
      return;
    }

    const reachedLimit = activeQueue.sentCount >= activeQueue.limit;
    const reachedEnd = activeQueue.nextIndex >= activeQueue.items.length;

    if (reachedLimit || reachedEnd) {
      await clearScheduledAlarm();
      activeQueue.items = [];
      activeQueue.nextIndex = 0;

      await updateJobState(
        JOB_STATES.COMPLETED,
        createLogEntry(
          'info',
          `Job completed. Processed ${activeQueue.sentCount} recipient(s) (limit: ${activeQueue.limit}).`
        ),
        { queueState: null }
      );
      return;
    }

    const recipient = activeQueue.items[activeQueue.nextIndex];
    const email = (recipient?.email || recipient?.to || '').trim();

    if (!email) {
      activeQueue.nextIndex += 1;
      await updateJobState(
        JOB_STATES.SENDING,
        createLogEntry('warn', `Skipped recipient at index ${activeQueue.nextIndex - 1}: missing email.`),
        { queueState: snapshotQueueState() }
      );
      await scheduleNextStepAlarm(1);
      return;
    }

    await updateJobState(
      JOB_STATES.SENDING,
      createLogEntry('info', `Processing ${email} (${activeQueue.sentCount + 1}/${activeQueue.limit})...`, {
        recipient: email,
        dryRun: activeQueue.isDryRun
      }),
      { queueState: snapshotQueueState() }
    );

    const subject = parsePlaceholders(activeQueue.template?.subject || '', recipient);
    const html = parsePlaceholders(
      activeQueue.template?.html ?? activeQueue.template?.body ?? '',
      recipient
    );

    await dispatchComposeToGmail({
      to: email,
      subject,
      html,
      isDryRun: activeQueue.isDryRun
    });

    activeQueue.sentCount += 1;
    activeQueue.nextIndex += 1;

    const actionVerb = activeQueue.isDryRun ? 'Dry-run composed' : 'Sent';
    await updateJobState(
      JOB_STATES.SENDING,
      createLogEntry('success', `${actionVerb} email to ${email}.`, {
        recipient: email,
        dryRun: activeQueue.isDryRun
      }),
      { queueState: snapshotQueueState() }
    );

    const hasMoreRecipients = activeQueue.nextIndex < activeQueue.items.length;
    const withinLimit = activeQueue.sentCount < activeQueue.limit;

    if (hasMoreRecipients && withinLimit) {
      await updateJobState(
        JOB_STATES.WAITING,
        createLogEntry(
          'info',
          `Waiting ${activeQueue.delaySeconds}s before next recipient...`
        ),
        { queueState: snapshotQueueState() }
      );
      await scheduleNextStepAlarm(activeQueue.delaySeconds);
    } else {
      await clearScheduledAlarm();
      activeQueue.items = [];
      activeQueue.nextIndex = 0;

      await updateJobState(
        JOB_STATES.COMPLETED,
        createLogEntry(
          'info',
          `Job finished. Total processed: ${activeQueue.sentCount}.`
        ),
        { queueState: null }
      );
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await clearScheduledAlarm();

    await updateJobState(
      JOB_STATES.PAUSED,
      createLogEntry('error', `Step failed: ${errorMessage}`),
      { queueState: snapshotQueueState() }
    );
  } finally {
    activeQueue.isProcessing = false;
  }
}

// ============================================================================
// Job Control Handlers (START_JOB, PAUSE_JOB, STOP_JOB)
// ============================================================================

async function handleStartJob(payload = {}) {
  const data = await getData();
  const currentStatus = data.currentJob.status;

  // Resume if currently PAUSED and a saved queue exists
  if (currentStatus === JOB_STATES.PAUSED && (await restoreQueueStateIfNeeded())) {
    const mergedSettings = normalizeSettings({
      ...data.settings,
      ...(payload.settings || {})
    });

    activeQueue.limit = mergedSettings.limit;
    activeQueue.delaySeconds = mergedSettings.delaySeconds;
    activeQueue.isDryRun = mergedSettings.isDryRun;

    const updated = {
      ...data,
      settings: mergedSettings
    };
    await saveData(updated);

    await updateJobState(
      JOB_STATES.SENDING,
      createLogEntry('info', 'Resuming paused job queue...'),
      { queueState: snapshotQueueState() }
    );

    await processNextRecipient();
    return { ok: true, status: JOB_STATES.SENDING };
  }

  const mergedSettings = normalizeSettings({
    ...data.settings,
    ...(payload.settings || {})
  });
  const recipients = resolveRecipients(data, payload);
  const template = resolveActiveTemplate(data, payload);

  if (!recipients.length) {
    throw new Error('Cannot start job: recipient list is empty.');
  }

  await clearScheduledAlarm();

  activeQueue = {
    items: recipients,
    nextIndex: 0,
    sentCount: 0,
    limit: mergedSettings.limit,
    delaySeconds: mergedSettings.delaySeconds,
    isDryRun: mergedSettings.isDryRun,
    template,
    isProcessing: false
  };

  await saveData({
    ...data,
    settings: mergedSettings
  });

  await updateJobState(
    JOB_STATES.SENDING,
    createLogEntry(
      'info',
      `Job started (${recipients.length} recipient(s), limit: ${mergedSettings.limit}, delay: ${mergedSettings.delaySeconds}s, dryRun: ${mergedSettings.isDryRun}).`
    ),
    { queueState: snapshotQueueState() }
  );

  await processNextRecipient();
  return { ok: true, status: JOB_STATES.SENDING };
}

async function handlePauseJob() {
  await clearScheduledAlarm();
  await restoreQueueStateIfNeeded();

  await updateJobState(
    JOB_STATES.PAUSED,
    createLogEntry('warn', 'Job paused by user.'),
    { queueState: snapshotQueueState() }
  );

  return { ok: true, status: JOB_STATES.PAUSED };
}

async function handleStopJob() {
  await clearScheduledAlarm();

  activeQueue = {
    items: [],
    nextIndex: 0,
    sentCount: 0,
    limit: activeQueue.limit,
    delaySeconds: activeQueue.delaySeconds,
    isDryRun: activeQueue.isDryRun,
    template: null,
    isProcessing: false
  };

  await updateJobState(
    JOB_STATES.IDLE,
    createLogEntry('warn', 'Job stopped and queue reset to IDLE.'),
    { queueState: null }
  );

  return { ok: true, status: JOB_STATES.IDLE };
}

// ============================================================================
// Extension Event Listeners
// ============================================================================

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PATH);
  const matchingTabs = await chrome.tabs.query({ url: dashboardUrl });

  if (matchingTabs.length > 0 && typeof matchingTabs[0].id === 'number') {
    const existingTab = matchingTabs[0];
    if (typeof existingTab.windowId === 'number') {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    await chrome.tabs.update(existingTab.id, { active: true });
    return;
  }

  await chrome.tabs.create({ url: dashboardUrl });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) {
    processNextRecipient();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  const payload =
    message.payload && typeof message.payload === 'object' ? message.payload : message;

  if (message.type === 'START_JOB') {
    (async () => {
      try {
        const res = await handleStartJob(payload);
        sendResponse(res);
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return true;
  }

  if (message.type === 'PAUSE_JOB') {
    (async () => {
      try {
        const res = await handlePauseJob();
        sendResponse(res);
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return true;
  }

  if (message.type === 'STOP_JOB') {
    (async () => {
      try {
        const res = await handleStopJob();
        sendResponse(res);
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })();
    return true;
  }

  return false;
});
