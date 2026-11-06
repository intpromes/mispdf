/* Mis PDF — visor de PDF instalable con envío a WhatsApp y Google Drive */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const MAX_RECENTS = 30;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const state = {
  current: null,      // { id, name, size, date, blob, driveId, driveLink }
  pdf: null,
  zoom: 1,            // 1 = ajustado al ancho
  baseWidth: 0,
  pageSizes: [],
  renderToken: 0,
  observer: null,
};

/* ---------------------------------------------------------------- utilidades */
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function settings() {
  try { return JSON.parse(localStorage.getItem('mispdf-settings') || '{}'); } catch { return {}; }
}
function saveSettings(s) {
  try { localStorage.setItem('mispdf-settings', JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}
function fileOf(rec) {
  return new File([rec.blob], rec.name, { type: 'application/pdf', lastModified: rec.date });
}

/* ---------------------------------------------------------------- IndexedDB (recientes) */
const db = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('mispdf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('files', mode);
      const out = fn(t.objectStore('files'));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    put: (rec) => tx('readwrite', (s) => s.put(rec)),
    del: (id) => tx('readwrite', (s) => s.delete(id)),
    clear: () => tx('readwrite', (s) => s.clear()),
  };
})();

async function addFiles(files) {
  const pdfs = [...files].filter((f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
  if (!pdfs.length) { toast('Ese archivo no es un PDF'); return null; }
  let first = null;
  for (const f of pdfs) {
    const rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: f.name || 'documento.pdf',
      size: f.size,
      date: Date.now(),
      blob: f,
    };
    try { await db.put(rec); } catch { /* si no hay espacio, se abre igual */ }
    first = first || rec;
  }
  await trimRecents();
  renderRecents();
  return first;
}
async function trimRecents() {
  try {
    const all = (await db.all()).sort((a, b) => b.date - a.date);
    for (const r of all.slice(MAX_RECENTS)) await db.del(r.id);
  } catch { /* nada */ }
}

async function renderRecents() {
  let items = [];
  try { items = (await db.all()).sort((a, b) => b.date - a.date); } catch { /* nada */ }
  const ul = $('recentList');
  ul.innerHTML = '';
  $('emptyMsg').classList.toggle('hidden', items.length > 0);
  $('btnClearAll').classList.toggle('hidden', items.length === 0);
  for (const r of items) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.innerHTML = `
      <div class="badge">PDF</div>
      <div class="meta">
        <div class="name">${esc(r.name)}</div>
        <div class="info">${fmtSize(r.size)} · ${fmtDate(r.date)}${r.driveId ? ' · <span class="drive-tag">en Drive</span>' : ''}</div>
      </div>
      <button class="icon-btn" data-act="share" aria-label="Compartir"><svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 0 0-2.2.9l-7-4.1a3.3 3.3 0 0 0 0-1.6l7-4a3 3 0 1 0-1-2.2 3.3 3.3 0 0 0 .1.8l-7 4.1a3 3 0 1 0 0 4.3l7 4.1a2.8 2.8 0 0 0-.1.7A3 3 0 1 0 18 16z"/></svg></button>
      <button class="icon-btn" data-act="del" aria-label="Quitar de recientes"><svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg></button>`;
    li.querySelector('.meta').onclick = () => openRecord(r);
    li.querySelector('.badge').onclick = () => openRecord(r);
    li.querySelector('[data-act=share]').onclick = () => shareFile(r, 'Elige la app para compartir');
    li.querySelector('[data-act=del]').onclick = async () => { await db.del(r.id); renderRecents(); };
    ul.appendChild(li);
  }
}

/* ---------------------------------------------------------------- navegación */
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === view);
}
function goHome(fromPop) {
  closePdf();
  show('home');
  renderRecents();
  if (!fromPop && history.state && history.state.viewer) history.back();
}
window.addEventListener('popstate', () => {
  if (!$('sheet').classList.contains('hidden') && $('viewer').classList.contains('active')) { closeSheet(); history.pushState({ viewer: true }, ''); return; }
  closeSheet();
  if ($('viewer').classList.contains('active')) goHome(true);
});

/* ---------------------------------------------------------------- visor */
async function openRecord(rec) {
  state.current = rec;
  rec.date = Date.now();
  db.put(rec).catch(() => {});
  $('docName').textContent = rec.name;
  $('pageInfo').textContent = 'Cargando…';
  show('viewer');
  if (!(history.state && history.state.viewer)) history.pushState({ viewer: true }, '');
  await loadPdf(rec);
}

async function loadPdf(rec, password) {
  closePdf();
  $('loading').classList.remove('hidden');
  $('loading').textContent = 'Cargando…';
  try {
    const data = new Uint8Array(await rec.blob.arrayBuffer());
    const task = pdfjsLib.getDocument({ data, password });
    state.pdf = await task.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      $('loading').classList.add('hidden');
      askPassword(rec, err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
      return;
    }
    $('loading').textContent = 'No se pudo abrir este PDF.';
    $('pageInfo').textContent = 'Error';
    return;
  }
  // tamaños de todas las páginas para reservar espacio
  state.pageSizes = [];
  for (let i = 1; i <= state.pdf.numPages; i++) {
    const p = await state.pdf.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    state.pageSizes.push({ w: vp.width, h: vp.height });
  }
  state.zoom = 1;
  $('loading').classList.add('hidden');
  layoutPages();
  $('pagesWrap').scrollTop = 0;
}

function closePdf() {
  state.renderToken++;
  if (state.observer) state.observer.disconnect();
  if (state.pdf) { state.pdf.destroy(); state.pdf = null; }
  $('pages').innerHTML = '';
}

function fitWidth() {
  const avail = $('pagesWrap').clientWidth - 20;
  const maxW = Math.max(...state.pageSizes.map((s) => s.w));
  return avail / maxW; // escala que ajusta la página más ancha al ancho de pantalla
}

function layoutPages(keepRatio) {
  if (!state.pdf) return;
  const wrap = $('pagesWrap');
  const ratio = keepRatio ? (wrap.scrollTop + wrap.clientHeight / 2) / Math.max(1, wrap.scrollHeight) : 0;
  state.renderToken++;
  if (state.observer) state.observer.disconnect();
  const scale = fitWidth() * state.zoom;
  const box = $('pages');
  box.style.transform = '';
  box.innerHTML = '';
  state.pageSizes.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'page';
    d.dataset.n = i + 1;
    d.style.width = Math.floor(s.w * scale) + 'px';
    d.style.height = Math.floor(s.h * scale) + 'px';
    d.innerHTML = `<span class="num">${i + 1}</span>`;
    box.appendChild(d);
  });
  $('zoomLbl').textContent = Math.round(state.zoom * 100) + '%';

  const token = state.renderToken;
  state.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (e.isIntersecting) { if (!el.dataset.done) renderPage(el, scale, token); }
      else if (el.dataset.done && Math.abs(e.boundingClientRect.top) > wrap.clientHeight * 4) {
        // liberar memoria de páginas lejanas
        const c = el.querySelector('canvas'); if (c) c.remove();
        delete el.dataset.done;
      }
    }
    updatePageInfo();
  }, { root: wrap, rootMargin: '150% 0px' });
  for (const el of box.children) state.observer.observe(el);
  if (keepRatio) wrap.scrollTop = ratio * wrap.scrollHeight - wrap.clientHeight / 2;
  updatePageInfo();
}

async function renderPage(el, scale, token) {
  el.dataset.done = '1';
  const page = await state.pdf.getPage(+el.dataset.n);
  if (token !== state.renderToken) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const vp = page.getViewport({ scale: scale * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch { delete el.dataset.done; return; }
  if (token !== state.renderToken) return;
  el.prepend(canvas);
}

function updatePageInfo() {
  if (!state.pdf) return;
  const wrap = $('pagesWrap');
  const mid = wrap.scrollTop + wrap.clientHeight / 3;
  let n = 1;
  for (const el of $('pages').children) { if (el.offsetTop <= mid) n = +el.dataset.n; else break; }
  $('pageInfo').textContent = `Página ${n} de ${state.pdf.numPages}`;
}
$('pagesWrap').addEventListener('scroll', () => requestAnimationFrame(updatePageInfo), { passive: true });

function setZoom(z) {
  state.zoom = Math.min(5, Math.max(0.5, z));
  layoutPages(true);
}
$('btnZoomIn').onclick = () => setZoom(state.zoom * 1.25);
$('btnZoomOut').onclick = () => setZoom(state.zoom / 1.25);
$('btnZoomFit').onclick = () => setZoom(1);
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => layoutPages(true), 200); });

// pellizcar para hacer zoom
(() => {
  const wrap = $('pagesWrap');
  let d0 = 0, factor = 1;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  wrap.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); factor = 1; } }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && d0) {
      e.preventDefault();
      factor = dist(e.touches) / d0;
      const z = Math.min(5, Math.max(0.5, state.zoom * factor));
      $('pages').style.transform = `scale(${z / state.zoom})`;
      $('zoomLbl').textContent = Math.round(z * 100) + '%';
    }
  }, { passive: false });
  wrap.addEventListener('touchend', (e) => {
    if (d0 && e.touches.length < 2) { d0 = 0; if (Math.abs(factor - 1) > 0.03) setZoom(state.zoom * factor); else $('pages').style.transform = ''; }
  });
})();

function askPassword(rec, wrong) {
  openSheet(
    'PDF protegido',
    `<p>${wrong ? 'Contraseña incorrecta. Intenta de nuevo.' : 'Este archivo tiene contraseña.'}</p>
     <label for="pwd">Contraseña</label><input id="pwd" type="password" autocomplete="off">`,
    [
      { text: 'Abrir', cls: 'primary', fn: () => { const v = $('pwd').value; closeSheet(); loadPdf(rec, v); } },
      { text: 'Cancelar', fn: () => { closeSheet(); goHome(); } },
    ]
  );
  setTimeout(() => $('pwd').focus(), 100);
}

/* ---------------------------------------------------------------- compartir */
async function shareFile(rec, hint) {
  const file = fileOf(rec);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    if (hint) toast(hint, 3500);
    try {
      await navigator.share({ files: [file], title: rec.name });
    } catch (err) {
      if (err.name !== 'AbortError') toast('No se pudo compartir: ' + err.message);
    }
    return true;
  }
  openSheet('Compartir no disponible',
    `<p>Este navegador no permite compartir archivos. Abre la app instalada en Android (desde Chrome) para enviar PDFs por WhatsApp o Drive.</p>`,
    [{ text: 'Entendido', fn: closeSheet }]);
  return false;
}

$('btnShare').onclick = () => state.current && shareFile(state.current, 'Elige la app para compartir');

$('btnWhats').onclick = () => {
  const rec = state.current; if (!rec) return;
  if (rec.driveLink) {
    openSheet('Enviar por WhatsApp', `<p>Este PDF ya está en tu Drive. ¿Qué quieres enviar?</p>`, [
      { text: 'Enviar el archivo PDF', cls: 'whats', fn: () => { closeSheet(); shareFile(rec, 'Elige WhatsApp en la lista'); } },
      { text: 'Enviar el enlace de Drive', cls: 'primary', fn: () => { closeSheet(); sendLinkWhatsApp(rec); } },
      { text: 'Cancelar', fn: closeSheet },
    ]);
    return;
  }
  shareFile(rec, 'Elige WhatsApp en la lista');
};

function sendLinkWhatsApp(rec) {
  const text = `${rec.name}\n${rec.driveLink}`;
  // wa.me abre WhatsApp directamente con el mensaje listo para elegir el contacto
  location.href = 'https://wa.me/?text=' + encodeURIComponent(text);
}

/* ---------------------------------------------------------------- Google Drive */
$('btnDrive').onclick = () => {
  const rec = state.current; if (!rec) return;
  const s = settings();
  if (rec.driveLink) { showDriveDone(rec); return; }
  if (!s.clientId) {
    openSheet('Guardar en Google Drive', `
      <p>Se abrirá el menú de compartir de Android: elige <b>Drive</b> («Guardar en Drive»), escoge la carpeta y toca <b>Guardar</b>.</p>
      <p>¿Prefieres subirlo directo desde la app y obtener un enlace para mandarlo por WhatsApp? Activa la <b>subida directa</b> en Ajustes.</p>`,
      [
        { text: 'Guardar en Drive', cls: 'drive', fn: () => { closeSheet(); shareFile(rec, 'Elige «Drive» en la lista'); } },
        { text: 'Configurar subida directa', fn: () => { closeSheet(); openSettings(); } },
        { text: 'Cancelar', fn: closeSheet },
      ]);
    return;
  }
  uploadToDrive(rec);
};

let gisPromise = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = res;
    sc.onerror = () => { gisPromise = null; rej(new Error('Sin conexión con Google')); };
    document.head.appendChild(sc);
  });
  return gisPromise;
}

let token = null; // { access_token, exp }
function getToken() {
  if (token && token.exp > Date.now() + 60000) return Promise.resolve(token.access_token);
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: settings().clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.error) { rej(new Error(r.error_description || r.error)); return; }
        token = { access_token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        res(r.access_token);
      },
      error_callback: (e) => rej(new Error(e.type === 'popup_closed' ? 'Cancelaste el inicio de sesión' : (e.message || 'No se pudo iniciar sesión'))),
    });
    client.requestAccessToken({ prompt: token ? '' : undefined });
  });
}

function uploadSheet(pct, msg) {
  openSheet('Subiendo a Drive', `
    <p id="upMsg">${esc(msg)}</p>
    <div class="progress"><div id="upBar" style="width:${pct}%"></div></div>`, []);
}

async function uploadToDrive(rec) {
  if (!navigator.onLine) { toast('Sin conexión a internet'); return; }
  try {
    uploadSheet(0, 'Conectando con Google…');
    await loadGis();
    const at = await getToken();
    const s = settings();
    const meta = { name: rec.name, mimeType: 'application/pdf' };
    if (s.folderId) meta.parents = [s.folderId];

    // 1) iniciar subida reanudable
    const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(rec.size) },
      body: JSON.stringify(meta),
    });
    if (!init.ok) throw new Error(await apiError(init));
    const uploadUrl = init.headers.get('Location');
    if (!uploadUrl) throw new Error('Google no devolvió la dirección de subida');

    // 2) enviar el archivo con barra de progreso
    const file = await new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('PUT', uploadUrl);
      x.setRequestHeader('Content-Type', 'application/pdf');
      x.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.round((e.loaded / e.total) * 100);
        const bar = $('upBar'); if (bar) bar.style.width = p + '%';
        const m = $('upMsg'); if (m) m.textContent = `Subiendo «${rec.name}»… ${p}%`;
      };
      x.onload = () => (x.status >= 200 && x.status < 300) ? res(JSON.parse(x.responseText)) : rej(new Error('Error ' + x.status + ' al subir'));
      x.onerror = () => rej(new Error('Se perdió la conexión'));
      x.send(rec.blob);
    });

    rec.driveId = file.id;
    rec.driveLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
    rec.drivePublic = false;
    await db.put(rec).catch(() => {});
    showDriveDone(rec);
  } catch (err) {
    openSheet('No se pudo subir', `<p>${esc(err.message || err)}</p>`, [
      { text: 'Reintentar', cls: 'drive', fn: () => { closeSheet(); uploadToDrive(rec); } },
      { text: 'Usar «Guardar en Drive» de Android', fn: () => { closeSheet(); shareFile(rec, 'Elige «Drive» en la lista'); } },
      { text: 'Cerrar', fn: closeSheet },
    ]);
  }
}

async function apiError(res) {
  try { const j = await res.json(); return (j.error && j.error.message) || ('Error ' + res.status); } catch { return 'Error ' + res.status; }
}

function showDriveDone(rec) {
  openSheet('Guardado en Drive ✓', `
    <p><b>${esc(rec.name)}</b> está en tu Google Drive.</p>
    <label class="check"><input type="checkbox" id="chkPublic" ${rec.drivePublic ? 'checked disabled' : ''}>
      <span>Cualquier persona con el enlace puede verlo${rec.drivePublic ? ' (ya activado)' : ' (necesario para que lo abran desde WhatsApp)'}</span></label>`,
    [
      { text: 'Enviar enlace por WhatsApp', cls: 'whats', fn: async () => {
        if ($('chkPublic').checked && !rec.drivePublic) {
          try { await makePublic(rec); } catch (e) { toast('No se pudo cambiar el permiso: ' + e.message); return; }
        }
        closeSheet(); sendLinkWhatsApp(rec);
      } },
      { text: 'Abrir en Drive', cls: 'drive', href: rec.driveLink },
      { text: 'Listo', fn: closeSheet },
    ]);
}

async function makePublic(rec) {
  await loadGis();
  const at = await getToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${rec.driveId}/permissions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!r.ok) throw new Error(await apiError(r));
  rec.drivePublic = true;
  await db.put(rec).catch(() => {});
}

/* ---------------------------------------------------------------- ajustes */
function openSettings() {
  const s = settings();
  const origin = location.origin;
  openSheet('Ajustes', `
    <p><b>Subida directa a Google Drive (opcional).</b> Sin esto la app usa «Guardar en Drive» del menú de compartir, que funciona sin configurar nada.</p>
    <label for="cid">ID de cliente OAuth de Google</label>
    <input id="cid" type="text" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${esc(s.clientId || '')}" autocomplete="off" spellcheck="false">
    <label for="fid">ID de carpeta de Drive (opcional)</label>
    <input id="fid" type="text" placeholder="Vacío = carpeta raíz «Mi unidad»" value="${esc(s.folderId || '')}" autocomplete="off" spellcheck="false">
    <p>Para obtener el ID de cliente:</p>
    <ol>
      <li>Entra a <b>console.cloud.google.com</b>, crea un proyecto y habilita <b>Google Drive API</b>.</li>
      <li>En <b>Pantalla de consentimiento OAuth</b> elige «Externo» y agrega tu correo como usuario de prueba.</li>
      <li>En <b>Credenciales → Crear credenciales → ID de cliente OAuth</b>, tipo «Aplicación web».</li>
      <li>En «Orígenes autorizados de JavaScript» agrega: <code>${esc(origin)}</code></li>
      <li>Copia el ID de cliente y pégalo arriba.</li>
    </ol>`,
    [
      { text: 'Guardar', cls: 'primary', fn: () => {
        const n = settings();
        n.clientId = $('cid').value.trim();
        n.folderId = $('fid').value.trim().replace(/^.*\/folders\//, '').replace(/[?#].*$/, '');
        saveSettings(n); token = null; closeSheet();
        toast(n.clientId ? 'Subida directa a Drive activada' : 'Ajustes guardados');
        if (n.clientId) loadGis().catch(() => {});
      } },
      { text: 'Cancelar', fn: closeSheet },
    ]);
}
$('btnSettings').onclick = openSettings;

/* ---------------------------------------------------------------- hoja inferior */
function openSheet(title, html, actions) {
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = html;
  const box = $('sheetActions');
  box.innerHTML = '';
  for (const a of actions) {
    const el = document.createElement(a.href ? 'a' : 'button');
    el.className = 'btn ' + (a.cls || '');
    el.textContent = a.text;
    if (a.href) { el.href = a.href; el.target = '_blank'; el.rel = 'noopener'; }
    else { el.type = 'button'; el.onclick = a.fn; }
    box.appendChild(el);
  }
  $('sheet').classList.remove('hidden');
}
function closeSheet() { $('sheet').classList.add('hidden'); }
$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' && $('sheetActions').children.length) closeSheet(); });

/* ---------------------------------------------------------------- entrada de archivos */
$('filePicker').onchange = async (e) => {
  const first = await addFiles(e.target.files);
  e.target.value = '';
  if (first) openRecord(first);
};
$('btnBack').onclick = () => goHome();
$('btnClearAll').onclick = () => openSheet('Borrar recientes', '<p>Se quitarán todos los PDF de la lista de esta app. Los archivos originales y los de Drive no se borran.</p>', [
  { text: 'Borrar todo', cls: 'primary', fn: async () => { await db.clear(); closeSheet(); renderRecents(); } },
  { text: 'Cancelar', fn: closeSheet },
]);

// PDFs recibidos desde el menú «Compartir» de otras apps
async function receiveShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('mispdf-shared');
    const keys = await cache.keys();
    const files = [];
    for (const k of keys) {
      const r = await cache.match(k);
      const name = decodeURIComponent(r.headers.get('X-File-Name') || 'documento.pdf');
      files.push(new File([await r.blob()], name, { type: 'application/pdf' }));
      await cache.delete(k);
    }
    if (files.length) {
      const first = await addFiles(files);
      if (first) openRecord(first);
      if (files.length > 1) toast(`Se recibieron ${files.length} PDF`);
    }
  } catch { toast('No se pudo recibir el archivo'); }
}

// «Abrir con…» en escritorio / ChromeOS
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    const first = await addFiles(files);
    if (first) openRecord(first);
  });
}

// arrastrar y soltar (computadora)
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const first = await addFiles(e.dataTransfer.files);
  if (first) openRecord(first);
});

/* ---------------------------------------------------------------- instalación */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('btnInstall').classList.remove('hidden');
});
$('btnInstall').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('btnInstall').classList.add('hidden');
};
window.addEventListener('appinstalled', () => { $('btnInstall').classList.add('hidden'); toast('¡App instalada!'); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------------------------------------------------------------- inicio */
renderRecents();
receiveShared();
if (settings().clientId && navigator.onLine) loadGis().catch(() => {});
