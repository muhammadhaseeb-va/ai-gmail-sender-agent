export const STORAGE_KEY = 'professor_v1_data';

export const JOB_STATES = Object.freeze({
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  COMPOSING: 'COMPOSING',
  SENDING: 'SENDING',
  WAITING: 'WAITING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED'
});

export const DEFAULT_STORAGE_DATA = Object.freeze({
  settings: {
    limit: 50,
    delaySeconds: 15,
    isDryRun: true
  },
  templates: [],
  recipients: [],
  activeDraft: null,
  currentJob: {
    status: JOB_STATES.IDLE,
    logs: [],
    queueState: null
  }
});

function normalizeSettings(rawSettings = {}) {
  const rawLimit = Number(rawSettings.limit);
  const rawDelay = Number(rawSettings.delaySeconds);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(500, Math.max(1, Math.round(rawLimit)))
    : DEFAULT_STORAGE_DATA.settings.limit;

  const delaySeconds = Number.isFinite(rawDelay)
    ? Math.min(3600, Math.max(1, Math.round(rawDelay)))
    : DEFAULT_STORAGE_DATA.settings.delaySeconds;

  const isDryRun =
    typeof rawSettings.isDryRun === 'boolean'
      ? rawSettings.isDryRun
      : DEFAULT_STORAGE_DATA.settings.isDryRun;

  return { limit, delaySeconds, isDryRun };
}

function normalizeStorageData(rawData) {
  const source = rawData && typeof rawData === 'object' ? rawData : {};
  const rawJob = source.currentJob && typeof source.currentJob === 'object'
    ? source.currentJob
    : {};

  const validStatuses = new Set(Object.values(JOB_STATES));
  const status = validStatuses.has(rawJob.status)
    ? rawJob.status
    : JOB_STATES.IDLE;

  return {
    settings: normalizeSettings(source.settings),
    templates: Array.isArray(source.templates) ? source.templates : [],
    recipients: Array.isArray(source.recipients) ? source.recipients : [],
    activeDraft: source.activeDraft && typeof source.activeDraft === 'object'
      ? source.activeDraft
      : null,
    currentJob: {
      status,
      logs: Array.isArray(rawJob.logs) ? rawJob.logs : [],
      queueState: rawJob.queueState && typeof rawJob.queueState === 'object'
        ? rawJob.queueState
        : null
    }
  };
}

export async function getStorageData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const existing = result[STORAGE_KEY];

  if (!existing) {
    const initial = normalizeStorageData(DEFAULT_STORAGE_DATA);
    await chrome.storage.local.set({ [STORAGE_KEY]: initial });
    return initial;
  }

  return normalizeStorageData(existing);
}

export async function saveStorageData(data) {
  const normalized = normalizeStorageData(data);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}
