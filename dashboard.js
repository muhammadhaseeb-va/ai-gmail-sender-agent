// dashboard.js - UI Controller connecting elements and storage
import { getStorageData, saveStorageData } from './storage.js';
import { initProposalEditor } from './proposal-editor.js';
import { renderTemplatesList } from './templates.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize sub-modules
  await initProposalEditor();
  await renderTemplatesList();

  // Elements
  const btnSaveRecipients = document.getElementById('btn-save-recipients');
  const recipientsInput = document.getElementById('recipients-input');
  const recipientsSummary = document.getElementById('recipients-summary');
  const toggleDryRun = document.getElementById('toggle-dry-run');
  const settingLimit = document.getElementById('setting-limit');
  const settingDelay = document.getElementById('setting-delay');
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const activityLogs = document.getElementById('activity-logs');

  // Load Saved Storage
  let data = await getStorageData();

  // Render Settings
  if (toggleDryRun) toggleDryRun.checked = data.settings.isDryRun;
  if (settingLimit) settingLimit.value = data.settings.limit;
  if (settingDelay) settingDelay.value = data.settings.delaySeconds;

  // Render Saved Recipients
  if (data.recipients && data.recipients.length > 0 && recipientsSummary) {
    recipientsSummary.innerHTML = `<strong>${data.recipients.length}</strong> recipients loaded.`;
  }

  // Update Stats & Logs
  updateUIStats(data);
  checkGmailConnection();

  // 1. Save Recipients Handler
  btnSaveRecipients?.addEventListener('click', async () => {
    const rawText = recipientsInput.value.trim();
    if (!rawText) return;
    const lines = rawText.split('\n');
    const parsed = lines.map(line => {
      const parts = line.split(',');
      return {
        email: parts[0]?.trim() || '',
        name: parts[1]?.trim() || '',
        company: parts[2]?.trim() || '',
        website: parts[3]?.trim() || ''
      };
    }).filter(r => r.email.includes('@'));

    const latest = await getStorageData();
    latest.recipients = parsed;
    data = await saveStorageData(latest);

    if (recipientsSummary) {
      recipientsSummary.innerHTML = `<strong>${parsed.length}</strong> recipients loaded successfully!`;
    }
    updateUIStats(data);
  });

  // 2. Settings Change Handlers
  toggleDryRun?.addEventListener('change', async (e) => {
    const latest = await getStorageData();
    latest.settings.isDryRun = e.target.checked;
    data = await saveStorageData(latest);
  });

  settingLimit?.addEventListener('change', async (e) => {
    const latest = await getStorageData();
    latest.settings.limit = parseInt(e.target.value, 10) || 50;
    data = await saveStorageData(latest);
  });

  settingDelay?.addEventListener('change', async (e) => {
    const latest = await getStorageData();
    latest.settings.delaySeconds = parseInt(e.target.value, 10) || 15;
    data = await saveStorageData(latest);
  });

  // 3. Control Buttons Handlers (Matched with background.js message protocol)
  btnStart?.addEventListener('click', async () => {
    const latest = await getStorageData();
    const subjectEl = document.getElementById('proposal-subject');
    const bodyEl = document.getElementById('proposal-body');

    const payload = {
      settings: latest.settings,
      recipients: latest.recipients,
      template: {
        subject: subjectEl?.value || latest.activeDraft?.subject || '',
        html: bodyEl?.innerHTML || latest.activeDraft?.body || ''
      }
    };

    chrome.runtime.sendMessage({ type: 'START_JOB', payload }, (res) => {
      if (chrome.runtime.lastError) {
        alert(chrome.runtime.lastError.message);
        return;
      }
      if (!res || !res.ok) {
        alert(res?.error || 'Failed to start job.');
      }
      refreshDashboardState();
    });
  });

  btnPause?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_JOB' }, () => refreshDashboardState());
  });

  btnStop?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_JOB' }, () => refreshDashboardState());
  });

  btnClearLogs?.addEventListener('click', async () => {
    const latest = await getStorageData();
    latest.currentJob.logs = [];
    data = await saveStorageData(latest);
    if (activityLogs) {
      activityLogs.innerHTML = '<div class="log-entry">Logs cleared.</div>';
    }
  });

  // Poll state every 2 seconds for dynamic log & connection updates
  setInterval(() => {
    refreshDashboardState();
    checkGmailConnection();
  }, 2000);
});

async function checkGmailConnection() {
  const pill = document.getElementById('gmail-status-pill');
  if (!pill) return;

  try {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    if (tabs.length > 0) {
      pill.innerHTML = '<span class="dot green"></span> Gmail Tab Connected';
    } else {
      pill.innerHTML = '<span class="dot yellow"></span> Open Gmail Tab Required';
    }
  } catch {
    pill.innerHTML = '<span class="dot yellow"></span> Checking Gmail Tab...';
  }
}

async function refreshDashboardState() {
  const data = await getStorageData();
  updateUIStats(data);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function updateUIStats(data) {
  const { currentJob, recipients } = data;
  const queueState = currentJob.queueState || {};

  const total = recipients?.length || 0;
  const sent = Number(queueState.sentCount) || 0;
  const processedIndex = Number(queueState.nextIndex) || 0;
  const failed = (currentJob.logs || []).filter((l) => l && l.level === 'error').length;
  const remaining = Math.max(total - processedIndex, 0);

  const statTotal = document.getElementById('stat-total');
  const statSent = document.getElementById('stat-sent');
  const statFailed = document.getElementById('stat-failed');
  const statRemaining = document.getElementById('stat-remaining');

  if (statTotal) statTotal.innerText = total;
  if (statSent) statSent.innerText = sent;
  if (statFailed) statFailed.innerText = failed;
  if (statRemaining) statRemaining.innerText = remaining;

  // Control Buttons States
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const status = currentJob.status || 'IDLE';

  if (status === 'SENDING' || status === 'WAITING') {
    if (btnStart) btnStart.disabled = true;
    if (btnPause) btnPause.disabled = false;
    if (btnStop) btnStop.disabled = false;
  } else {
    if (btnStart) btnStart.disabled = false;
    if (btnPause) btnPause.disabled = true;
    if (btnStop) btnStop.disabled = (status === 'IDLE');
  }

  // Render Structured Log Objects
  const activityLogs = document.getElementById('activity-logs');
  if (activityLogs && Array.isArray(currentJob.logs)) {
    if (currentJob.logs.length === 0) {
      activityLogs.innerHTML = '<div class="log-entry system">System initialized. Ready for task.</div>';
    } else {
      activityLogs.innerHTML = currentJob.logs.map((log) => {
        if (typeof log === 'string') {
          return `<div class="log-entry">${escapeHtml(log)}</div>`;
        }
        const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
        const level = (log.level || 'info').toUpperCase();
        const msg = escapeHtml(log.message || '');
        return `<div class="log-entry">[${time}] [${level}] ${msg}</div>`;
      }).join('');
      activityLogs.scrollTop = activityLogs.scrollHeight;
    }
  }
}
