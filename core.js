/* Kalidad · lógica pura: EXIF (orientación y fecha), distribución en hoja A4, textos y armado del PDF.
   Funciona en el navegador (window.Core) y en Node (module.exports) para poder probarla. */
(function (root) {
  'use strict';

  var A4 = { w: 595.28, h: 841.89 }; // puntos PDF (1 pt = 1/72 pulgada)
  var MARGIN = 18;
  var HEAD = 36;  // espacio reservado arriba para el título
  var FOOT = 30;  // espacio reservado abajo para la fecha de la foto

  // ---------- EXIF ----------
  // Devuelve { orientation: 1..8, date: Date|null } leyendo el encabezado de un JPEG.
  function exifInfo(u8) {
    var out = { orientation: 1, date: null };
    if (!u8 || u8.length < 12 || u8[0] !== 0xff || u8[1] !== 0xd8) return out;
    var off = 2;
    while (off + 4 < u8.length) {
      if (u8[off] !== 0xff) return out;
      var marker = u8[off + 1];
      if (marker === 0xda || marker === 0xd9) return out;
      var len = (u8[off + 2] << 8) | u8[off + 3];
      var isExif = marker === 0xe1 && len >= 14 &&
        u8[off + 4] === 0x45 && u8[off + 5] === 0x78 && u8[off + 6] === 0x69 &&
        u8[off + 7] === 0x66 && u8[off + 8] === 0 && u8[off + 9] === 0;
      if (isExif) { parseTiff(u8, off + 10, out); return out; }
      off += 2 + len;
    }
    return out;
  }

  function parseTiff(u8, t, out) {
    var le = u8[t] === 0x49;
    function r16(p) { return le ? (u8[p] | (u8[p + 1] << 8)) : ((u8[p] << 8) | u8[p + 1]); }
    function r32(p) {
      return le
        ? ((u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0)
        : (((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0);
    }
    function ascii(p, n) {
      var s = '';
      for (var i = 0; i < n && p + i < u8.length; i++) { if (u8[p + i] === 0) break; s += String.fromCharCode(u8[p + i]); }
      return s;
    }
    function readIfd(ifd, tags) {
      var res = {};
      if (ifd + 2 > u8.length) return res;
      var n = r16(ifd);
      for (var i = 0; i < n; i++) {
        var e = ifd + 2 + i * 12;
        if (e + 12 > u8.length) break;
        var tag = r16(e);
        if (tags.indexOf(tag) === -1) continue;
        var type = r16(e + 2), cnt = r32(e + 4);
        if (type === 3) res[tag] = r16(e + 8);                         // SHORT
        else if (type === 4) res[tag] = r32(e + 8);                    // LONG
        else if (type === 2) res[tag] = ascii(cnt > 4 ? t + r32(e + 8) : e + 8, cnt); // ASCII
      }
      return res;
    }
    var ifd0 = readIfd(t + r32(t + 4), [0x0112, 0x0132, 0x8769]);
    if (ifd0[0x0112] >= 1 && ifd0[0x0112] <= 8) out.orientation = ifd0[0x0112];
    var raw = null;
    if (ifd0[0x8769]) {
      var ex = readIfd(t + ifd0[0x8769], [0x9003, 0x9004]);
      raw = ex[0x9003] || ex[0x9004] || null;
    }
    raw = raw || ifd0[0x0132] || null;
    var m = raw && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
    if (m && +m[1] > 1990) out.date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  // Giro en sentido horario (grados) que hay que aplicar. Los casos con espejo se rehacen en canvas.
  function orientationInfo(o) {
    switch (o) {
      case 1: return { rot: 0, mirrored: false };
      case 3: return { rot: 180, mirrored: false };
      case 6: return { rot: 90, mirrored: false };
      case 8: return { rot: 270, mirrored: false };
      default: return { rot: 0, mirrored: true };
    }
  }

  // ---------- Textos ----------
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  // "Evidencia 01-11-2026 10:30"
  function titleText(d) {
    return 'Evidencia ' + p2(d.getDate()) + '-' + p2(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  // Nombre de archivo (Windows no admite ":")
  function fileNameFor(d) {
    return titleText(d).replace(':', '-') + '.pdf';
  }
  // "01/11/2026 · 10:24 a. m."
  function takenText(d) {
    var h = d.getHours(), ap = h < 12 ? 'a. m.' : 'p. m.';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' · ' + h12 + ':' + p2(d.getMinutes()) + ' ' + ap;
  }
  // Solo caracteres que la fuente estándar del PDF puede dibujar
  function safe(s) { return String(s).replace(/[^\x20-\x7e -ÿ]/g, ''); }

  // ---------- Distribución en la hoja ----------
  // rotation = grados horarios (múltiplos de 90). Devuelve hoja (vertical u horizontal según la foto) y posición.
  function layout(imgW, imgH, rotation, opts) {
    opts = opts || {};
    var top = opts.top || 0, bottom = opts.bottom || 0;
    var r = ((rotation % 360) + 360) % 360;
    var swap = r === 90 || r === 270;
    var ew = swap ? imgH : imgW;
    var eh = swap ? imgW : imgH;
    var landscape = ew > eh;
    var pw = landscape ? A4.h : A4.w;
    var ph = landscape ? A4.w : A4.h;
    var aw = pw - 2 * MARGIN;
    var ah = ph - 2 * MARGIN - top - bottom;
    var s = Math.min(aw / ew, ah / eh);
    var dw = imgW * s, dh = imgH * s;
    var th = (-r * Math.PI) / 180; // pdf-lib gira en sentido antihorario
    var cos = Math.cos(th), sin = Math.sin(th);
    var cx = pw / 2, cy = MARGIN + bottom + ah / 2;
    var x = cx - ((dw / 2) * cos - (dh / 2) * sin);
    var y = cy - ((dw / 2) * sin + (dh / 2) * cos);
    return { pageW: pw, pageH: ph, x: x, y: y, width: dw, height: dh, rotateDeg: -r };
  }

  // ---------- PDF ----------
  // items[i] = { takenAt: Date }; getImage(item) -> { kind: 'jpg'|'png', bytes: Uint8Array, rotation }
  // Las fotos JPEG se incrustan tal cual (sin recomprimir): no se pierde resolución ni calidad.
  async function buildPdf(PDFLib, items, getImage, opts) {
    opts = opts || {};
    var title = safe(opts.title || 'Evidencia');
    var doc = await PDFLib.PDFDocument.create();
    doc.setTitle(title);
    doc.setCreator('Kalidad');
    doc.setProducer('Kalidad');
    var bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var reg = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var gray = PDFLib.rgb(0.42, 0.42, 0.45), ink = PDFLib.rgb(0.09, 0.09, 0.11), line = PDFLib.rgb(0.85, 0.85, 0.87);
    var total = items.length;

    for (var i = 0; i < total; i++) {
      var info = await getImage(items[i]);
      var img = info.kind === 'png' ? await doc.embedPng(info.bytes) : await doc.embedJpg(info.bytes);
      var L = layout(img.width, img.height, info.rotation, { top: HEAD, bottom: FOOT });
      var page = doc.addPage([L.pageW, L.pageH]);

      // Encabezado: título a la izquierda y "1 de 3" a la derecha
      var yTop = L.pageH - MARGIN - 11;
      page.drawText(title, { x: MARGIN, y: yTop, size: 11, font: bold, color: ink });
      var pg = (i + 1) + ' de ' + total;
      page.drawText(pg, { x: L.pageW - MARGIN - reg.widthOfTextAtSize(pg, 10), y: yTop + 0.5, size: 10, font: reg, color: gray });
      page.drawLine({ start: { x: MARGIN, y: yTop - 8 }, end: { x: L.pageW - MARGIN, y: yTop - 8 }, thickness: 0.6, color: line });

      // Foto
      page.drawImage(img, { x: L.x, y: L.y, width: L.width, height: L.height, rotate: PDFLib.degrees(L.rotateDeg) });

      // Pie: cuándo se tomó la foto
      var t = items[i].takenAt ? safe('Foto tomada el ' + takenText(new Date(items[i].takenAt))) : '';
      if (t) page.drawText(t, { x: (L.pageW - reg.widthOfTextAtSize(t, 10)) / 2, y: MARGIN + 8, size: 10, font: reg, color: gray });

      info = null;
      if (opts.onProgress) opts.onProgress(i + 1, total);
      await new Promise(function (res) { setTimeout(res, 0); }); // deja respirar al navegador
    }
    return doc.save();
  }

  var api = {
    A4: A4, MARGIN: MARGIN, HEAD: HEAD, FOOT: FOOT,
    exifInfo: exifInfo, orientationInfo: orientationInfo,
    titleText: titleText, fileNameFor: fileNameFor, takenText: takenText,
    layout: layout, buildPdf: buildPdf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
