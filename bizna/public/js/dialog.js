/**
 * Modal dialogs built on the native <dialog> element, which handles focus
 * trapping and the Escape key. formDialog collects values and runs an async
 * submit handler; errors it throws are shown inside the dialog so the person
 * can fix the input without losing it.
 */

import { $, esc, setBusy } from './util.js';

const dialog = () => $('#dialog');

document.addEventListener('click', (event) => {
  const el = dialog();
  if (el && event.target === el) el.close();
});

function fieldHtml(field, index) {
  const id = `df-${index}`;
  const common = `id="${id}" name="${esc(field.name)}" ${field.required === false ? '' : 'required'}`;
  let control;
  if (field.type === 'select') {
    control = `<select ${common}>${field.options
      .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(field.value) ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select>`;
  } else {
    const attrs = ['min', 'max', 'step', 'maxlength', 'inputmode', 'placeholder']
      .filter((a) => field[a] !== undefined)
      .map((a) => `${a}="${esc(field[a])}"`)
      .join(' ');
    control = `<input ${common} type="${field.type || 'text'}" value="${esc(field.value ?? '')}" ${attrs}>`;
  }
  return `<div class="field"><label for="${id}">${esc(field.label)}</label>${control}${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}</div>`;
}

/**
 * Opens a form dialog.
 * @param {{title:string,note?:string,fields:object[],submitLabel?:string,onSubmit:(values:object)=>Promise<void>}} options
 */
export function formDialog({ title, note = '', fields, submitLabel = 'Save', onSubmit }) {
  const el = dialog();
  el.innerHTML = `
    <form novalidate>
      <h2>${esc(title)}</h2>
      ${note ? `<p class="dlg-note">${esc(note)}</p>` : ''}
      ${fields.map(fieldHtml).join('')}
      <p class="form-error" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" class="btn quiet" data-cancel>Cancel</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;

  const form = $('form', el);
  const error = $('.form-error', el);
  const submit = $('[type="submit"]', el);
  $('[data-cancel]', el).addEventListener('click', () => el.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (submit.getAttribute('aria-busy')) return;
    error.textContent = '';
    setBusy(submit, true);
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await onSubmit(values);
      el.close();
    } catch (err) {
      error.textContent = err.message || 'Something went wrong.';
    } finally {
      setBusy(submit, false);
    }
  });

  el.showModal();
  $('input, select', el)?.focus();
}

/**
 * Asks for confirmation.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const el = dialog();
  el.innerHTML = `
    <form>
      <h2>${esc(title)}</h2>
      <p class="dlg-note">${esc(message)}</p>
      <div class="dlg-actions">
        <button type="button" class="btn quiet" data-cancel>Cancel</button>
        <button type="submit" class="btn ${danger ? 'danger-solid' : 'primary'}">${esc(confirmLabel)}</button>
      </div>
    </form>`;

  return new Promise((resolve) => {
    let answer = false;
    $('form', el).addEventListener('submit', (event) => {
      event.preventDefault();
      answer = true;
      el.close();
    });
    $('[data-cancel]', el).addEventListener('click', () => el.close());
    el.addEventListener('close', () => resolve(answer), { once: true });
    el.showModal();
  });
}
