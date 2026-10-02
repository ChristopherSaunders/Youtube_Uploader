const $ = (id) => document.getElementById(id);

const accountsList = $('accounts');
const accountsEmpty = $('accounts-empty');
const accountTemplate = $('account-template');
const flash = $('flash');

const form = $('upload-form');
const uploadHint = $('upload-hint');
const fileInput = $('video');
const dropzone = $('dropzone');
const dropzoneText = $('dropzone-text');
const accountSelect = $('accountId');
const titleInput = $('title');
const titleCount = $('title-count');
const progressPanel = $('progress');
const result = $('result');

const thumbInput = $('thumbnail');
const thumbPicker = $('thumb-picker');
const thumbPreview = $('thumb-preview');

let uploading = false;

function showFlash(type, message) {
  flash.className = `flash ${type}`;
  flash.textContent = message;
  flash.hidden = false;
  flash.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideFlash() {
  flash.hidden = true;
}

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ---------- Channels ----------

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

  const previous = accountSelect.value;
  accountSelect.replaceChildren(
    ...accounts.map((account) => new Option(account.channel_title, account.id)),
  );
  if (accounts.some((account) => String(account.id) === previous)) accountSelect.value = previous;

  if (!uploading) {
    form.hidden = accounts.length === 0 || !result.hidden;
    uploadHint.hidden = accounts.length > 0;
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

// ---------- File picker ----------

function showChosenFile() {
  const file = fileInput.files[0];
  dropzone.classList.toggle('has-file', Boolean(file));
  if (!file) {
    dropzoneText.innerHTML = '<strong>Choose a video</strong> or drag it here';
    return;
  }
  dropzoneText.textContent = `${file.name} · ${formatBytes(file.size)}`;
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
    updateTitleCount();
  }
}

fileInput.addEventListener('change', showChosenFile);

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('dragging'));
}
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  if (event.dataTransfer.files.length) {
    fileInput.files = event.dataTransfer.files;
    showChosenFile();
  }
});

function showChosenThumbnail() {
  const image = thumbInput.files[0];
  if (thumbPreview.src) URL.revokeObjectURL(thumbPreview.src);
  thumbPreview.hidden = !image;
  $('thumb-placeholder').hidden = Boolean(image);
  $('thumb-remove').hidden = !image;
  thumbPicker.classList.toggle('has-image', Boolean(image));
  if (image) thumbPreview.src = URL.createObjectURL(image);
  else thumbPreview.removeAttribute('src');
}

thumbInput.addEventListener('change', () => {
  const image = thumbInput.files[0];
  const problem = image && thumbnailProblem(image);
  if (problem) {
    thumbInput.value = '';
    showFlash('error', problem);
  }
  showChosenThumbnail();
});

$('thumb-remove').addEventListener('click', () => {
  thumbInput.value = '';
  showChosenThumbnail();
});

function thumbnailProblem(image) {
  if (!['image/jpeg', 'image/png'].includes(image.type)) return 'Thumbnails must be JPG or PNG images.';
  if (image.size > 2 * 1024 * 1024) return `That thumbnail is ${formatBytes(image.size)}; YouTube allows up to 2 MB.`;
  return null;
}

function updateTitleCount() {
  const length = titleInput.value.length;
  titleCount.textContent = `${length} / 100`;
  titleCount.classList.toggle('over', length > 100);
}
titleInput.addEventListener('input', updateTitleCount);

// ---------- Upload ----------

function validate() {
  if (!fileInput.files[0]) return 'Choose a video file.';
  if (!accountSelect.value) return 'Choose a channel.';
  const title = titleInput.value.trim();
  if (!title) return 'Add a title.';
  if (/[<>]/.test(title)) return 'Titles cannot contain < or >.';
  if (/[<>]/.test($('description').value)) return 'Descriptions cannot contain < or >.';
  if (!form.querySelector('input[name="madeForKids"]:checked')) {
    return 'Say whether the video is made for kids (YouTube requires this).';
  }
  return null;
}

function setProgress(stage, fraction, detail) {
  const percent = Math.min(100, Math.round(fraction * 100));
  $('progress-stage').textContent = stage;
  $('progress-percent').textContent = `${percent}%`;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-detail').textContent = detail || '';
}

// Step 1: browser → this app, with progress from the browser itself.
function sendToApp(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(
          'Step 1 of 2 · Sending video to the app…',
          event.loaded / event.total,
          `${formatBytes(event.loaded)} of ${formatBytes(event.total)}`,
        );
      }
    };
    xhr.onload = () => {
      if (xhr.status === 202) resolve(xhr.response);
      else reject(new Error(xhr.response?.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Lost connection to the app. Is it still running?'));
    xhr.send(formData);
  });
}

// Step 2: this app → YouTube. The server does the work; we just check in.
async function waitForYouTube(uploadId) {
  for (;;) {
    const job = await api(`/uploads/${uploadId}`);
    if (job.status === 'done') return job;
    if (job.status === 'error') throw new Error(job.error);
    if (job.status === 'thumbnail') {
      setProgress('Step 2 of 2 · Setting the thumbnail…', 1);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const fraction = job.totalBytes ? job.bytesSent / job.totalBytes : 0;
    setProgress(
      'Step 2 of 2 · Uploading to YouTube…',
      fraction,
      fraction >= 1
        ? 'Finishing up with YouTube…'
        : `${formatBytes(job.bytesSent)} of ${formatBytes(job.totalBytes)} · you can close this page now`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideFlash();
  const problem = validate();
  if (problem) return showFlash('error', problem);

  // Text fields first so the server reads them before the (large) file.
  const formData = new FormData();
  for (const name of ['accountId', 'title', 'description', 'tags', 'privacy', 'categoryId']) {
    formData.append(name, form.elements[name].value);
  }
  formData.append('madeForKids', form.querySelector('input[name="madeForKids"]:checked').value);
  formData.append('notifySubscribers', String($('notifySubscribers').checked));
  if (thumbInput.files[0]) formData.append('thumbnail', thumbInput.files[0]);
  formData.append('video', fileInput.files[0]);

  uploading = true;
  form.hidden = true;
  progressPanel.hidden = false;
  setProgress('Step 1 of 2 · Sending video to the app…', 0);

  try {
    const job = await sendToApp(formData);
    const done = await waitForYouTube(job.id);
    showResult(done);
  } catch (err) {
    progressPanel.hidden = true;
    form.hidden = false;
    showFlash('error', err.message);
  } finally {
    uploading = false;
    loadHistory();
  }
});

window.addEventListener('beforeunload', (event) => {
  // Only step 1 needs the page open; step 2 continues on the server.
  if (uploading && $('progress-stage').textContent.startsWith('Step 1')) event.preventDefault();
});

function showResult(job) {
  progressPanel.hidden = true;
  result.hidden = false;
  const privacyNote =
    job.privacy === 'private'
      ? ' It is private for now. Change the visibility in YouTube Studio when you are ready.'
      : '';
  $('result-text').textContent = `Uploaded! YouTube is now processing your video.${privacyNote}`;
  $('result-warning').textContent = job.warning || '';
  $('result-warning').hidden = !job.warning;
  $('result-watch').href = `https://youtu.be/${job.videoId}`;
  $('result-studio').href = `https://studio.youtube.com/video/${job.videoId}/edit`;
}

$('upload-another').addEventListener('click', () => {
  result.hidden = true;
  const keepChannel = accountSelect.value;
  form.reset();
  accountSelect.value = keepChannel;
  showChosenFile();
  showChosenThumbnail();
  updateTitleCount();
  form.hidden = false;
});

// ---------- History ----------

const STATUS_LABELS = { done: 'Uploaded', error: 'Failed', uploading: 'Uploading…' };

async function loadHistory() {
  try {
    const uploads = await api('/uploads');
    $('history-card').hidden = uploads.length === 0;
    $('history').replaceChildren(
      ...uploads.map((upload) => {
        const item = document.createElement('li');
        const main = document.createElement('div');
        main.className = 'history-main';
        const title = document.createElement('div');
        title.className = 'history-title';
        if (upload.video_id) {
          const link = document.createElement('a');
          link.href = `https://youtu.be/${upload.video_id}`;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = upload.title;
          title.append(link);
        } else {
          title.textContent = upload.title;
        }
        const meta = document.createElement('div');
        meta.className = 'muted small';
        meta.textContent = [upload.channel_title, upload.error, upload.warning]
          .filter(Boolean)
          .join(' · ');
        main.append(title, meta);

        const status = document.createElement('span');
        status.className = `status ${upload.warning ? 'warning' : upload.status}`;
        status.textContent = upload.warning
          ? 'Uploaded, no thumbnail'
          : STATUS_LABELS[upload.status] || upload.status;
        item.append(main, status);
        return item;
      }),
    );
  } catch {
    // History is a nice-to-have; ignore errors here.
  }
}

// ---------- Start ----------

const params = new URLSearchParams(location.search);
if (params.has('connected')) showFlash('success', `Connected ${params.get('connected')}.`);
if (params.has('error')) showFlash('error', params.get('error'));
if (params.size) history.replaceState(null, '', '/');

loadAccounts();
loadHistory();
