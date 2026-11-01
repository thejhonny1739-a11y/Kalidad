/* Kalidad · interfaz y flujo */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fotos = [];      // fotos pendientes (con blob y miniatura)
  var pdfs = [];       // PDF creados
  var sel = [];        // ids seleccionados, en el orden del PDF
  var urls = {};       // id -> object URL de la miniatura
  var lastPdf = null;  // PDF recién creado
  var CHUNK = 20;

  function ic(n) { return '<svg class="ic"><use href="#i-' + n + '"/></svg>'; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function byId(id) { for (var i = 0; i < fotos.length; i++) if (fotos[i].id === id) return fotos[i]; return null; }
  function shortDate(ms) { var d = new Date(ms); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' · ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }

  var toastT;
  function toast(t) { var e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(function () { e.classList.add('hidden'); }, 2600); }

  // ---------- Tema ----------
  function setTheme(dark) {
    document.documentElement.classList.toggle('oscuro', dark);
    $('themeIc').innerHTML = '<use href="#i-' + (dark ? 'sun' : 'moon') + '"/>';
    try { localStorage.setItem('kalidad_tema', dark ? 'oscuro' : 'claro'); } catch (e) {}
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#09090B' : '#F4F4F5';
  }

  // ---------- Vistas ----------
  var view = 'fotos';
  function go(v) {
    view = v;
    $('v-fotos').classList.toggle('hidden', v !== 'fotos');
    $('v-armar').classList.toggle('hidden', v !== 'armar');
    document.querySelectorAll('.ni[data-go]').forEach(function (b) { b.classList.toggle('on', b.dataset.go === v); });
    if (v === 'armar' && !lastPdf) renderArmar();
    if (v === 'fotos') lastPdf = null;
    window.scrollTo(0, 0);
    renderBars();
  }

  // ---------- Agregar fotos ----------
  function sig(f) { return f.name + '|' + f.size + '|' + f.lastModified; }

  async function makeThumb(blob) {
    try {
      var bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 480, resizeQuality: 'medium' });
      var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
      return await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.8); });
    } catch (e) {
      try {
        var u = URL.createObjectURL(blob);
        var im = await new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = no; i.src = u; });
        var s = Math.min(1, 480 / im.naturalWidth), c2 = document.createElement('canvas');
        c2.width = Math.round(im.naturalWidth * s); c2.height = Math.round(im.naturalHeight * s);
        c2.getContext('2d').drawImage(im, 0, 0, c2.width, c2.height); URL.revokeObjectURL(u);
        return await new Promise(function (r) { c2.toBlob(r, 'image/jpeg', 0.8); });
      } catch (e2) { return null; }
    }
  }

  async function addFiles(list, fromCamera) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name); });
    if (!files.length) return;
    var known = {}; fotos.forEach(function (f) { known[f.sig] = 1; });
    var added = 0, dup = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], s = sig(f);
      if (known[s] && !fromCamera) { dup++; continue; }
      known[s] = 1;
      var info = { orientation: 1, date: null };
      if (/jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name)) {
        try { info = Core.exifInfo(new Uint8Array(await f.slice(0, 262144).arrayBuffer())); } catch (e) {}
      }
      var oi = Core.orientationInfo(info.orientation);
      var rec = {
        blob: f, name: f.name || 'foto.jpg', type: f.type || 'image/jpeg', size: f.size, sig: s,
        takenAt: (info.date || new Date(f.lastModified || Date.now())).getTime(),
        addedAt: Date.now(), saved: false, exifRot: oi.rot, mirrored: oi.mirrored, userRot: 0,
        thumb: await makeThumb(f)
      };
      try { rec.id = await DB.add('fotos', rec); } catch (e) { toast('No se pudo guardar una foto en la app'); continue; }
      fotos.push(rec); added++;
      if (fromCamera) sel.push(rec.id);
    }
    fotos.sort(function (a, b) { return a.takenAt - b.takenAt; });
    renderFotos();
    toast(added ? (added === 1 ? 'Foto agregada' : added + ' fotos agregadas') + (dup ? ' · ' + dup + ' repetidas omitidas' : '') : (dup ? 'Esas fotos ya estaban en la lista' : 'No se agregó ninguna foto'));
  }

  // ---------- Guardar en galería ----------
  function stamp(ms) { var d = new Date(ms); return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()); }
  function toFile(f) {
    var ext = /png/i.test(f.type) ? 'png' : 'jpg';
    return new File([f.blob], 'Kalidad_' + stamp(f.takenAt) + '_' + f.id + '.' + ext, { type: f.type || 'image/jpeg' });
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  async function markSaved(recs) {
    for (var i = 0; i < recs.length; i++) { recs[i].saved = true; await DB.put('fotos', recs[i]); }
    renderFotos();
  }
  // Devuelve true si se guardó todo, false si se canceló
  async function saveToGallery(recs) {
    if (!recs.length) return true;
    var canShare = navigator.canShare && navigator.share;
    if (canShare) {
      for (var i = 0; i < recs.length; i += CHUNK) {
        var part = recs.slice(i, i + CHUNK), files = part.map(toFile);
        if (!navigator.canShare({ files: files })) { canShare = false; break; }
        try { await navigator.share({ files: files }); await markSaved(part); }
        catch (e) { if (e && e.name === 'AbortError') { toast('Cancelaste. Quedan fotos sin guardar'); return false; } canShare = false; break; }
        if (i + CHUNK < recs.length) {
          var go = await ask('Guardar en galería', 'Van ' + Math.min(i + CHUNK, recs.length) + ' de ' + recs.length + '. Faltan ' + (recs.length - i - CHUNK) + ' fotos.', [['Continuar', 'pri', true], ['Después', '', false]]);
          if (!go) return false;
        }
      }
      if (canShare) { toast(recs.length === 1 ? 'Foto guardada' : 'Fotos guardadas'); return true; }
    }
    // Sin menú de compartir (escritorio): descarga normal
    recs.forEach(function (r, k) { setTimeout(function () { var f = toFile(r); download(f, f.name); }, k * 250); });
    await markSaved(recs); toast('Fotos descargadas en tu equipo'); return true;
  }

  // ---------- Diálogos ----------
  function ask(title, text, buttons) {
    return new Promise(function (resolve) {
      $('mTitle').textContent = title; $('mText').textContent = text;
      var box = $('mAct'); box.innerHTML = '';
      buttons.forEach(function (b) {
        var el = document.createElement('button'); el.className = 'btn ' + (b[1] || ''); el.textContent = b[0];
        el.onclick = function () { $('modal').classList.add('hidden'); resolve(b[2]); };
        box.appendChild(el);
      });
      $('modal').classList.remove('hidden');
    });
  }

  // ---------- Selección ----------
  function toggle(id) { var k = sel.indexOf(id); if (k < 0) sel.push(id); else sel.splice(k, 1); renderFotos(); }

  // ---------- Dibujo: Mis fotos ----------
  function thumbUrl(r) {
    if (!urls[r.id]) urls[r.id] = URL.createObjectURL(r.thumb || r.blob);
    return urls[r.id];
  }
  function renderFotos() {
    sel = sel.filter(function (id) { return byId(id); });
    var uns = fotos.filter(function (f) { return !f.saved; });
    $('kTot').textContent = fotos.length; $('kUns').textContent = uns.length; $('kSel').textContent = sel.length;
    $('saveN').textContent = uns.length || ''; $('btnSave').disabled = !uns.length;
    $('empty').classList.toggle('hidden', fotos.length > 0);
    var g = $('grid'); g.innerHTML = '';
    fotos.forEach(function (r) {
      var k = sel.indexOf(r.id), d = document.createElement('div');
      d.className = 'card ph' + (k >= 0 ? ' sel' : '');
      d.innerHTML = '<div class="thumb" data-t="' + r.id + '"><img alt="" src="' + thumbUrl(r) + '">' +
        '<span class="chk">' + (k >= 0 ? k + 1 : '') + '</span>' +
        '<span class="pill ' + (r.saved ? 'lista' : 'pend') + '">' + (r.saved ? 'En galería' : 'Sin guardar') + '</span></div>' +
        '<div class="pfoot"><span>' + shortDate(r.takenAt) + '</span><button data-d="' + r.id + '" aria-label="Quitar">' + ic('trash-can') + '</button></div>';
      g.appendChild(d);
    });
    renderPdfs(); renderBars();
  }
  function renderBars() {
    var n = sel.length;
    $('selbar').classList.toggle('hidden', !(n && view === 'fotos'));
    $('selN').textContent = n;
    $('navBadge').textContent = n; $('navBadge').classList.toggle('hidden', !n);
  }
  function renderPdfs() {
    $('pdfBox').classList.toggle('hidden', !pdfs.length);
    $('pdfCount').textContent = pdfs.length;
    var h = '';
    pdfs.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (p) {
      h += '<div class="prow"><div class="pi">' + ic('file-pdf') + '</div><div class="pn"><b>' + esc(p.name) + '</b><small>' + p.pages + (p.pages === 1 ? ' hoja' : ' hojas') + ' · ' + fmtSize(p.size) + '</small></div>' +
        '<button data-ps="' + p.id + '" aria-label="Compartir">' + ic('share-nodes') + '</button>' +
        '<button data-pd="' + p.id + '" aria-label="Descargar">' + ic('download') + '</button>' +
        '<button class="del" data-px="' + p.id + '" aria-label="Eliminar">' + ic('trash-can') + '</button></div>';
    });
    $('pdfList').innerHTML = h;
  }

  // ---------- Dibujo: Armar ----------
  function titleNow() { return Core.titleText(new Date()); }
  function renderArmar() {
    $('result').classList.add('hidden');
    var items = sel.map(byId).filter(Boolean);
    $('armarEmpty').classList.toggle('hidden', items.length > 0);
    $('armarMain').classList.toggle('hidden', !items.length);
    if (!items.length) return;
    var h = '';
    items.forEach(function (r, i) {
      h += '<div class="card ai"><div class="thumb"><img alt="" src="' + thumbUrl(r) + '" style="transform:rotate(' + r.userRot + 'deg)' + (r.userRot % 180 ? ' scale(.72)' : '') + '"><span class="num">' + (i + 1) + '</span>' +
        '<span class="pill ' + (r.saved ? 'lista' : 'pend') + '">' + (r.saved ? 'En galería' : 'Sin guardar') + '</span></div>' +
        '<div class="tk">Tomada el ' + Core.takenText(new Date(r.takenAt)) + '</div>' +
        '<div class="tb"><button data-m="' + r.id + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Mover antes">' + ic('arrow-left') + '</button>' +
        '<button data-m="' + r.id + '" data-dir="1"' + (i === items.length - 1 ? ' disabled' : '') + ' aria-label="Mover después">' + ic('arrow-right') + '</button>' +
        '<button data-r="' + r.id + '" aria-label="Girar">' + ic('rotate-right') + '</button>' +
        '<button class="del" data-q="' + r.id + '" aria-label="Quitar de este PDF">' + ic('xmark') + '</button></div></div>';
    });
    $('armarList').innerHTML = h;
    $('sumTitle').textContent = titleNow(); $('sumPages').textContent = items.length;
    var u = items.filter(function (r) { return !r.saved; }).length;
    $('sumWarn').classList.toggle('hidden', !u);
    $('sumWarnTx').textContent = u + (u === 1 ? ' foto no está' : ' fotos no están') + ' en tu galería';
  }

  // ---------- Crear PDF ----------
  async function makePdf() {
    var items = sel.map(byId).filter(Boolean);
    if (!items.length) return;
    var uns = items.filter(function (r) { return !r.saved; });
    if (uns.length) {
      var c = await ask(uns.length + (uns.length === 1 ? ' foto no está' : ' fotos no están') + ' en tu galería',
        'Al crear el PDF salen de esta lista. Si no las guardas ahora, solo quedarán dentro del PDF.',
        [['Guardar en galería y crear PDF', 'pri', 'save'], ['Crear sin guardar', '', 'skip'], ['Cancelar', 'ghost', 'no']]);
      if (c === 'no') return;
      if (c === 'save') { var ok = await saveToGallery(uns); if (!ok) return; renderArmar(); }
    }
    $('prog').classList.remove('hidden'); $('pFill').style.width = '0'; $('pSub').textContent = '';
    var now = new Date(), title = Core.titleText(now);
    try {
      var bytes = await Core.buildPdf(PDFLib, items, getImage, {
        title: title,
        onProgress: function (i, n) { $('pFill').style.width = Math.round(i / n * 100) + '%'; $('pSub').textContent = 'Foto ' + i + ' de ' + n; }
      });
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var rec = { name: Core.fileNameFor(now), blob: blob, pages: items.length, size: blob.size, createdAt: now.getTime() };
      rec.id = await DB.add('pdfs', rec); pdfs.push(rec);
      var ids = items.map(function (r) { return r.id; });
      await DB.remove('fotos', ids);
      ids.forEach(function (id) { if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; } });
      fotos = fotos.filter(function (f) { return ids.indexOf(f.id) < 0; });
      sel = []; lastPdf = rec;
      $('prog').classList.add('hidden');
      $('armarMain').classList.add('hidden'); $('armarEmpty').classList.add('hidden');
      $('rName').textContent = rec.name; $('rInfo').textContent = rec.pages + (rec.pages === 1 ? ' hoja' : ' hojas') + ' · ' + fmtSize(rec.size);
      $('result').classList.remove('hidden');
      renderFotos(); window.scrollTo(0, 0);
    } catch (e) {
      $('prog').classList.add('hidden');
      ask('No se pudo crear el PDF', 'Prueba con menos fotos. Tus fotos siguen en la lista. (' + (e && e.message || e) + ')', [['Entendido', 'pri', true]]);
    }
  }

  // Convierte la foto en lo que necesita el PDF
  async function getImage(r) {
    var isJpg = /jpe?g/i.test(r.type), isPng = /png/i.test(r.type);
    if (isJpg && !r.mirrored) return { kind: 'jpg', bytes: new Uint8Array(await r.blob.arrayBuffer()), rotation: r.exifRot + r.userRot };
    if (isPng) return { kind: 'png', bytes: new Uint8Array(await r.blob.arrayBuffer()), rotation: r.userRot };
    // espejo, HEIC, WebP…: se pasa a JPEG de alta calidad ya derecho
    var bmp = await createImageBitmap(r.blob, { imageOrientation: 'from-image' });
    var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
    var b = await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.95); });
    c.width = c.height = 0;
    return { kind: 'jpg', bytes: new Uint8Array(await b.arrayBuffer()), rotation: r.userRot };
  }

  // ---------- Compartir / descargar PDF ----------
  async function sharePdf(rec) {
    var f = new File([rec.blob], rec.name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: rec.name }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(rec.blob, rec.name); toast('PDF descargado');
  }
  function pdfById(id) { for (var i = 0; i < pdfs.length; i++) if (pdfs[i].id === id) return pdfs[i]; return null; }

  // ---------- Eventos ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button,[data-t]'); if (!t) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.t) return toggle(+t.dataset.t);
    if (t.dataset.d) { var id = +t.dataset.d; return ask('¿Quitar esta foto?', 'Se borra de la app. Si la guardaste en tu galería, allí se queda.', [['Quitar', 'pri', true], ['Cancelar', 'ghost', false]]).then(function (ok) {
      if (!ok) return; DB.remove('fotos', id); if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; }
      fotos = fotos.filter(function (f) { return f.id !== id; }); renderFotos(); }); }
    if (t.dataset.m) { var i = sel.indexOf(+t.dataset.m), j = i + +t.dataset.dir; if (j >= 0 && j < sel.length) { var x = sel[i]; sel[i] = sel[j]; sel[j] = x; renderArmar(); } return; }
    if (t.dataset.r) { var r = byId(+t.dataset.r); r.userRot = (r.userRot + 90) % 360; DB.put('fotos', r); return renderArmar(); }
    if (t.dataset.q) { sel = sel.filter(function (v) { return v !== +t.dataset.q; }); renderArmar(); renderBars(); return renderFotos(); }
    if (t.dataset.ps) return sharePdf(pdfById(+t.dataset.ps));
    if (t.dataset.pd) { var p = pdfById(+t.dataset.pd); return download(p.blob, p.name); }
    if (t.dataset.px) { var pid = +t.dataset.px; return ask('¿Eliminar este PDF?', 'Se borra de la app.', [['Eliminar', 'pri', true], ['Cancelar', 'ghost', false]]).then(function (ok) {
      if (!ok) return; DB.remove('pdfs', pid); pdfs = pdfs.filter(function (q) { return q.id !== pid; }); renderPdfs(); }); }
  });
  $('btnCam').onclick = $('navCam').onclick = function () { if (view !== 'fotos') go('fotos'); $('inCam').click(); };
  $('btnGal').onclick = function () { $('inGal').click(); };
  $('inCam').onchange = function (e) { addFiles(e.target.files, true); e.target.value = ''; };
  $('inGal').onchange = function (e) { addFiles(e.target.files, false); e.target.value = ''; };
  $('btnSave').onclick = function () { saveToGallery(fotos.filter(function (f) { return !f.saved; })); };
  $('selClear').onclick = function () { sel = []; renderFotos(); };
  $('selGo').onclick = function () { go('armar'); };
  $('btnMake').onclick = makePdf;
  $('rShare').onclick = function () { if (lastPdf) sharePdf(lastPdf); };
  $('rDown').onclick = function () { if (lastPdf) download(lastPdf.blob, lastPdf.name); };
  $('rBack').onclick = function () { go('fotos'); };
  $('navTheme').onclick = function () { setTheme(!document.documentElement.classList.contains('oscuro')); };

  // ---------- Inicio ----------
  (async function init() {
    setTheme(document.documentElement.classList.contains('oscuro'));
    try {
      fotos = await DB.all('fotos'); pdfs = await DB.all('pdfs');
      fotos.sort(function (a, b) { return a.takenAt - b.takenAt; });
    } catch (e) { toast('No se pudo abrir el almacenamiento de la app'); }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    renderFotos();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {});
    window.__kalidad = { go: go, state: function () { return { fotos: fotos, pdfs: pdfs, sel: sel }; }, select: function (ids) { sel = ids; renderFotos(); } };
  })();
})();
