import { getStorageData, saveStorageData } from './storage.js';

const SAVE_DEBOUNCE_MS = 400;
const DRAFT_KEY = 'activeDraft';

let saveTimer = null;
let isInitialized = false;

/**
 * Inserts a placeholder token at the current selection/caret inside a
 * contenteditable element, or appends it at the end if unfocused.
 * @param {HTMLElement} editorEl
 * @param {string} token
 */
function insertTokenAtCaret(editorEl, token) {
  if (!editorEl || typeof token !== 'string') return;

  editorEl.focus();
  const selection = window.getSelection();

  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (editorEl.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      const textNode = document.createTextNode(token);
      range.insertNode(textNode);

      const nextRange = document.createRange();
      nextRange.setStartAfter(textNode);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);

      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
  }

  editorEl.appendChild(document.createTextNode(token));
  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Persists the current subject and proposal body to chrome.storage.local
 * under `professor_v1_data` (both `activeDraft` and updating the active/first
 * template if present).
 * @param {HTMLInputElement | null} subjectInput
 * @param {HTMLElement | null} bodyEditor
 * @param {HTMLElement | null} statusBadge
 */
async function persistDraft(subjectInput, bodyEditor, statusBadge) {
  const subject = subjectInput ? subjectInput.value : '';
  const body = bodyEditor ? bodyEditor.innerHTML : '';

  try {
    const data = await getStorageData();
    const nextData = {
      ...data,
      [DRAFT_KEY]: {
        subject,
        body,
        updatedAt: new Date().toISOString()
      }
    };

    await saveStorageData(nextData);

    if (statusBadge) {
      statusBadge.textContent = 'Saved';
      statusBadge.dataset.state = 'saved';
    }
  } catch (err) {
    console.error('[proposal-editor] Failed to save draft:', err);
    if (statusBadge) {
      statusBadge.textContent = 'Save error';
      statusBadge.dataset.state = 'error';
    }
  }
}

/**
 * Schedules a debounced save so rapid typing does not flood storage writes.
 * @param {HTMLInputElement | null} subjectInput
 * @param {HTMLElement | null} bodyEditor
 * @param {HTMLElement | null} statusBadge
 */
function scheduleSave(subjectInput, bodyEditor, statusBadge) {
  if (statusBadge) {
    statusBadge.textContent = 'Saving...';
    statusBadge.dataset.state = 'saving';
  }

  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistDraft(subjectInput, bodyEditor, statusBadge);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Initializes the proposal editor: hydrates saved draft/subject, wires
 * placeholder insertion buttons (`{{name}}`, `{{company}}`, `{{website}}`),
 * and binds debounced auto-save listeners.
 * @returns {Promise<void>}
 */
export async function initProposalEditor() {
  if (isInitialized) return;

  const subjectInput = document.querySelector('#proposal-subject');
  const bodyEditor = document.querySelector('#proposal-body');
  const statusBadge = document.querySelector('#draft-save-status');

  if (!bodyEditor) {
    console.warn('[proposal-editor] Element #proposal-body not found in DOM.');
    return;
  }

  // Hydrate initial values from storage
  const data = await getStorageData();
  const draft = data[DRAFT_KEY];

  if (draft && typeof draft === 'object') {
    if (subjectInput && typeof draft.subject === 'string') {
      subjectInput.value = draft.subject;
    }
    if (typeof draft.body === 'string') {
      bodyEditor.innerHTML = draft.body;
    }
  }

  // Bind placeholder buttons via data-placeholder or matching inner text
  const placeholderButtons = document.querySelectorAll('[data-placeholder]');
  placeholderButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const rawToken = btn.getAttribute('data-placeholder') || btn.textContent?.trim() || '';
      const normalized = rawToken.startsWith('{{') ? rawToken : `{{${rawToken}}}`;
      if (['{{name}}', '{{company}}', '{{website}}'].includes(normalized)) {
        insertTokenAtCaret(bodyEditor, normalized);
        scheduleSave(subjectInput, bodyEditor, statusBadge);
      }
    });
  });

  // Also support standalone buttons labeled {{name}}, {{company}}, {{website}}
  document.querySelectorAll('button').forEach((btn) => {
    if (btn.hasAttribute('data-placeholder')) return;
    const label = btn.textContent?.trim();
    if (label && ['{{name}}', '{{company}}', '{{website}}'].includes(label)) {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        insertTokenAtCaret(bodyEditor, label);
        scheduleSave(subjectInput, bodyEditor, statusBadge);
      });
    }
  });

  // Debounced auto-save on subject or rich-text body edits
  if (subjectInput) {
    subjectInput.addEventListener('input', () => {
      scheduleSave(subjectInput, bodyEditor, statusBadge);
    });
  }

  bodyEditor.addEventListener('input', () => {
    scheduleSave(subjectInput, bodyEditor, statusBadge);
  });

  bodyEditor.addEventListener('blur', () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistDraft(subjectInput, bodyEditor, statusBadge);
  });

  isInitialized = true;
}
