/* Mis PDF — visor de PDF instalable; comparte por el menú de Android (WhatsApp, Drive, correo...) */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const MAX_RECENTS = 30;

const state = {
  current: null,      // { id, name, size, date, blob }
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
        <div class="info">${fmtSize(r.size)} · ${fmtDate(r.date)}</div>
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

$('btnShare').onclick = () => state.current && shareFile(state.current, 'Elige WhatsApp, Drive o la app que quieras');

/* ---------------------------------------------------------------- imprimir */
const PRINT_DPI = 200;          // calidad de impresión
const printOpts = { color: true, mode: 'all', range: '' };

function currentPage() {
  const m = /Página (\d+)/.exec($('pageInfo').textContent);
  return m ? +m[1] : 1;
}

// "1-3, 5, 8-10" → [1,2,3,5,8,9,10]; devuelve null si hay un error
function parseRange(txt, max) {
  const out = new Set();
  const parts = txt.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return null;
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > max) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

function openPrintSheet() {
  if (!state.pdf) { toast('Espera a que cargue el PDF'); return; }
  const total = state.pdf.numPages;
  const cur = currentPage();
  openSheet('Imprimir', `
    <label>Color</label>
    <div class="seg" id="segColor">
      <button type="button" data-v="1" class="${printOpts.color ? 'on' : ''}">🎨 Color</button>
      <button type="button" data-v="0" class="${printOpts.color ? '' : 'on'}">⚫ Blanco y negro</button>
    </div>

    <label>Páginas <span class="muted">(el documento tiene ${total})</span></label>
    <div class="radios">
      <label class="check"><input type="radio" name="pmode" value="all" ${printOpts.mode === 'all' ? 'checked' : ''}><span>Todas</span></label>
      <label class="check"><input type="radio" name="pmode" value="current" ${printOpts.mode === 'current' ? 'checked' : ''}><span>Solo la página actual (${cur})</span></label>
      <label class="check"><input type="radio" name="pmode" value="custom" ${printOpts.mode === 'custom' ? 'checked' : ''}><span>Elegir páginas</span></label>
    </div>
    <input id="pRange" type="text" inputmode="numeric" placeholder="Ejemplo: 1-3, 5, 8" value="${esc(printOpts.range)}" class="${printOpts.mode === 'custom' ? '' : 'hidden'}">
    <p id="pErr" class="err hidden"></p>

    <p class="note">Al tocar <b>Imprimir</b>, Android busca las impresoras Wi-Fi de tu red y te deja elegir una, junto con el número de copias y el tamaño de papel.</p>`,
    [
      { text: 'Imprimir', cls: 'primary', fn: startPrint },
      { text: 'Cancelar', fn: closeSheet },
    ]);

  for (const b of $('segColor').children) {
    b.onclick = () => {
      printOpts.color = b.dataset.v === '1';
      for (const x of $('segColor').children) x.classList.toggle('on', x === b);
    };
  }
  for (const r of document.querySelectorAll('input[name=pmode]')) {
    r.onchange = () => {
      $('pRange').classList.toggle('hidden', r.value !== 'custom');
      $('pErr').classList.add('hidden');
      if (r.value === 'custom') $('pRange').focus();
    };
  }
}

async function startPrint() {
  const total = state.pdf.numPages;
  const mode = document.querySelector('input[name=pmode]:checked').value;
  let pages;
  if (mode === 'all') pages = Array.from({ length: total }, (_, i) => i + 1);
  else if (mode === 'current') pages = [currentPage()];
  else {
    pages = parseRange($('pRange').value, total);
    if (!pages) {
      $('pErr').textContent = `Revisa las páginas. Usa números del 1 al ${total}, separados por comas o con guion (1-3, 5).`;
      $('pErr').classList.remove('hidden');
      return;
    }
    printOpts.range = $('pRange').value.trim();
  }
  printOpts.mode = mode;

  openSheet('Preparando impresión', `
    <p id="prMsg">Preparando…</p>
    <div class="progress"><div id="prBar"></div></div>`, []);

  const area = $('printArea');
  clearPrintArea();
  const pdf = state.pdf;
  try {
    for (let k = 0; k < pages.length; k++) {
      $('prMsg').textContent = `Preparando página ${k + 1} de ${pages.length}…`;
      $('prBar').style.width = Math.round((k / pages.length) * 100) + '%';
      const url = await renderForPrint(pdf, pages[k], printOpts.color);
      const div = document.createElement('div');
      div.className = 'print-page';
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      div.appendChild(img);
      area.appendChild(div);
    }
  } catch (err) {
    clearPrintArea();
    openSheet('No se pudo preparar', `<p>${esc(err.message || err)}</p>`, [{ text: 'Cerrar', fn: closeSheet }]);
    return;
  }
  closeSheet();
  document.title = state.current.name.replace(/\.pdf$/i, '');   // nombre del trabajo de impresión
  setTimeout(() => {
    try { window.print(); }
    catch { toast('Este navegador no permite imprimir'); }
  }, 50);
}

async function renderForPrint(pdf, n, color) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: PRINT_DPI / 72 });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (!color) toGray(ctx, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  c.width = c.height = 0; // liberar memoria
  return URL.createObjectURL(blob);
}

function toGray(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

function clearPrintArea() {
  const area = $('printArea');
  for (const img of area.querySelectorAll('img')) URL.revokeObjectURL(img.src);
  area.innerHTML = '';
}
window.addEventListener('afterprint', () => {
  document.title = 'Mis PDF';
  setTimeout(clearPrintArea, 1000);
});

$('btnPrint').onclick = openPrintSheet;

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
