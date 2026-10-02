const accountsList = document.getElementById('accounts');
const accountsEmpty = document.getElementById('accounts-empty');
const accountTemplate = document.getElementById('account-template');
const flash = document.getElementById('flash');

function showFlash(type, message) {
  flash.className = `flash ${type}`;
  flash.textContent = message;
  flash.hidden = false;
}

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function renderAccounts(accounts) {
  accountsList.replaceChildren();
  accountsEmpty.hidden = accounts.length > 0;

  for (const account of accounts) {
    const item = accountTemplate.content.firstElementChild.cloneNode(true);
    const avatar = item.querySelector('.avatar');
    avatar.textContent = account.channel_title.charAt(0).toUpperCase();
    if (account.thumbnail_url) {
      const img = new Image();
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => avatar.replaceChildren(img);
      img.src = account.thumbnail_url;
    }
    item.querySelector('.account-title').textContent = account.channel_title;
    item.querySelector('.account-handle').textContent = account.channel_handle || account.channel_id;

    const button = item.querySelector('button');
    button.addEventListener('click', () => disconnect(account, button));
    accountsList.append(item);
  }
}

async function loadAccounts() {
  try {
    renderAccounts(await api('/accounts'));
  } catch (err) {
    showFlash('error', err.message);
  }
}

async function disconnect(account, button) {
  if (!confirm(`Disconnect "${account.channel_title}"? You can reconnect it any time.`)) return;
  button.disabled = true;
  try {
    await api(`/accounts/${account.id}`, { method: 'DELETE' });
    showFlash('success', `Disconnected ${account.channel_title}.`);
    await loadAccounts();
  } catch (err) {
    button.disabled = false;
    showFlash('error', err.message);
  }
}

// Messages passed back after the Google sign-in redirect.
const params = new URLSearchParams(location.search);
if (params.has('connected')) showFlash('success', `Connected ${params.get('connected')}.`);
if (params.has('error')) showFlash('error', params.get('error'));
if (params.size) history.replaceState(null, '', '/');

loadAccounts();
