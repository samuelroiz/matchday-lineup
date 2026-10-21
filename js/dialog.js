// In-page dialogs and toasts, used instead of the browser's alert/confirm/prompt.

let toastHost = null;

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/**
 * Show a modal. actions: [{ label, value, variant }]. Resolves with the clicked action's value,
 * or null if dismissed (Esc / Cancel). If beforeClose(value) returns false the dialog stays open.
 */
export function openDialog({ title, body, actions = [{ label: 'OK', value: true, variant: 'primary' }], beforeClose, className = '' }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: `modal ${className}`, 'aria-labelledby': 'modal-title' });
    const footer = el('div', { class: 'modal-actions' });
    const finish = async (value) => {
      if (value !== null && beforeClose) {
        const ok = await beforeClose(value);
        if (ok === false) return;
      }
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    for (const a of actions) {
      footer.append(el('button', {
        type: 'button',
        class: `btn ${a.variant ? 'btn-' + a.variant : ''}`,
        dataset: { action: String(a.value) },
        onclick: () => finish(a.value),
      }, a.label));
    }
    dlg.append(
      el('header', { class: 'modal-header' },
        el('h2', { id: 'modal-title' }, title),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => finish(null) }, '×')),
      el('div', { class: 'modal-body' }, body),
      footer,
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    const focusable = dlg.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    (focusable || footer.querySelector('.btn-primary, .btn-danger') || footer.lastChild)?.focus();
  });
}

export async function confirmDialog(message, { title = 'Are you sure?', okLabel = 'OK', danger = false } = {}) {
  const value = await openDialog({
    title,
    body: el('p', {}, message),
    actions: [
      { label: 'Cancel', value: false },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return value === true;
}

export function toast(message, { type = 'info', timeout = 4000 } = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: `toast toast-${type}` }, message);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 300); }, timeout);
  return t;
}
