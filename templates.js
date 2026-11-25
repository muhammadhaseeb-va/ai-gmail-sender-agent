import { getStorageData, saveStorageData } from './storage.js';

const DEFAULT_CONTAINER_SELECTOR = '#templates-list';

/**
 * Escapes plain text before injecting into HTML strings.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Strips HTML tags to create a concise plain-text preview snippet.
 * @param {string} html
 * @returns {string}
 */
function toSnippet(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  const text = (temp.textContent || temp.innerText || '').trim().replace(/\s+/g, ' ');
  return text.length > 110 ? `${text.slice(0, 110)}...` : text;
}

/**
 * Loads a template's subject and body into the editor fields, updates the
 * active draft in storage, and notifies listeners.
 * @param {object} template
 */
async function loadTemplateIntoEditor(template) {
  const subjectInput = document.querySelector('#proposal-subject');
  const bodyEditor = document.querySelector('#proposal-body');

  const subject = template.subject ?? '';
  const body = template.body ?? template.html ?? '';

  if (subjectInput) {
    subjectInput.value = subject;
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (bodyEditor) {
    bodyEditor.innerHTML = body;
    bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const data = await getStorageData();
  await saveStorageData({
    ...data,
    activeDraft: {
      subject,
      body,
      loadedTemplateId: template.id,
      updatedAt: new Date().toISOString()
    }
  });

  document.dispatchEvent(
    new CustomEvent('template:loaded', {
      detail: { template }
    })
  );
}

/**
 * Deletes a template by ID from chrome.storage.local and re-renders the list.
 * @param {string} templateId
 * @param {HTMLElement} container
 */
async function deleteTemplateById(templateId, container) {
  const data = await getStorageData();
  const templates = Array.isArray(data.templates) ? data.templates : [];
  const remaining = templates.filter((item) => String(item.id) !== String(templateId));

  await saveStorageData({
    ...data,
    templates: remaining
  });

  document.dispatchEvent(
    new CustomEvent('template:deleted', {
      detail: { id: templateId }
    })
  );

  await renderTemplatesList(container);
}

/**
 * Saves a new template from the current editor inputs if a save form/button exists.
 * @param {HTMLElement} container
 */
async function bindSaveNewTemplateTrigger(container) {
  const saveBtn = document.querySelector('#save-template-btn');
  const nameInput = document.querySelector('#template-name-input');
  const subjectInput = document.querySelector('#proposal-subject');
  const bodyEditor = document.querySelector('#proposal-body');

  if (!saveBtn || saveBtn.dataset.bound === 'true') return;
  saveBtn.dataset.bound = 'true';

  saveBtn.addEventListener('click', async (event) => {
    event.preventDefault();

    const subject = subjectInput ? subjectInput.value.trim() : '';
    const body = bodyEditor ? bodyEditor.innerHTML.trim() : '';
    const rawName = nameInput ? nameInput.value.trim() : '';
    const name = rawName || subject || 'Untitled Proposal';

    if (!subject && !body) return;

    const data = await getStorageData();
    const currentTemplates = Array.isArray(data.templates) ? data.templates : [];

    const newTemplate = {
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      subject,
      body,
      updatedAt: new Date().toISOString()
    };

    await saveStorageData({
      ...data,
      templates: [newTemplate, ...currentTemplates]
    });

    if (nameInput) nameInput.value = '';
    await renderTemplatesList(container);
  });
}

/**
 * Renders saved proposal templates into the target container and attaches
 * event delegation for loading and deleting template cards.
 * @param {HTMLElement | string} [target=DEFAULT_CONTAINER_SELECTOR]
 * @returns {Promise<void>}
 */
export async function renderTemplatesList(target = DEFAULT_CONTAINER_SELECTOR) {
  const container =
    typeof target === 'string' ? document.querySelector(target) : target;

  if (!container) {
    console.warn('[templates] Templates container not found in DOM.');
    return;
  }

  await bindSaveNewTemplateTrigger(container);

  const data = await getStorageData();
  const templates = Array.isArray(data.templates) ? data.templates : [];

  if (templates.length === 0) {
    container.innerHTML = `
      <div class="templates-empty" role="status">
        <p>No saved proposal templates yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = templates
    .map((tpl) => {
      const id = escapeHtml(tpl.id);
      const title = escapeHtml(tpl.name || tpl.subject || 'Untitled Template');
      const subject = escapeHtml(tpl.subject || '(No subject)');
      const snippet = escapeHtml(toSnippet(tpl.body ?? tpl.html ?? ''));

      return `
        <article class="template-card" data-template-id="${id}">
          <div class="template-card-header">
            <h3 class="template-title">${title}</h3>
            <div class="template-actions">
              <button type="button" class="btn-load-template" data-action="load" data-id="${id}">
                Load
              </button>
              <button type="button" class="btn-delete-template" data-action="delete" data-id="${id}">
                Delete
              </button>
            </div>
          </div>
          <p class="template-subject"><strong>Subject:</strong> ${subject}</p>
          <p class="template-preview">${snippet}</p>
        </article>
      `;
    })
    .join('');

  if (container.dataset.delegationBound !== 'true') {
    container.dataset.delegationBound = 'true';

    container.addEventListener('click', async (event) => {
      const actionBtn = event.target.closest('button[data-action][data-id]');
      if (!actionBtn || !container.contains(actionBtn)) return;

      const action = actionBtn.dataset.action;
      const templateId = actionBtn.dataset.id;
      if (!templateId) return;

      if (action === 'load') {
        const latestData = await getStorageData();
        const latestTemplates = Array.isArray(latestData.templates) ? latestData.templates : [];
        const matched = latestTemplates.find((item) => String(item.id) === String(templateId));
        if (matched) {
          await loadTemplateIntoEditor(matched);
        }
      } else if (action === 'delete') {
        await deleteTemplateById(templateId, container);
      }
    });
  }
}
