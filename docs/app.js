/* TinyDays: stamp DAY on up to 20 photos locally. Never upload. */
(function () {
  "use strict";

  var MAX = 20;
  var START_KEY = "tinydays-start-date";
  var TAG_ORIENTATION = 0x0112;
  var TAG_DATETIME = 0x0132;
  var TAG_EXIF_IFD = 0x8769;
  var TAG_DATETIME_ORIGINAL = 0x9003;
  var TAG_DATETIME_DIGITIZED = 0x9004; // CreateDate in ExifTool

  var startInput = document.getElementById("start-date");
  var photoInput = document.getElementById("photo");
  var photoLabel = document.getElementById("photo-label");
  photoLabel.textContent = "选择照片（最多 " + MAX + " 张）";
  var errorEl = document.getElementById("error");
  var cardsEl = document.getElementById("cards");
  var shareNote = document.getElementById("share-note");
  var shareIncomplete = document.getElementById("share-incomplete");
  var shareAllBtn = document.getElementById("share-all");
  var shareFallback = document.getElementById("share-fallback");
  var debugBody = document.getElementById("debug-body");
  var canvas = document.getElementById("work");
  var ctx = canvas.getContext("2d");

  var items = [];
  var selection = 0;
  var job = 0;
  var chain = Promise.resolve();

  startInput.value = localStorage.getItem(START_KEY) || "";
  startInput.addEventListener("change", onStartChange);
  photoInput.addEventListener("change", onPhotoPicked);
  shareAllBtn.addEventListener("click", onShareAll);

  function onPhotoPicked() {
    var files = photoInput.files ? Array.prototype.slice.call(photoInput.files) : [];
    if (!files.length) return;
    job += 1;
    var myJob = job;
    selection += 1;
    var sel = selection;
    items.forEach(clearOutput);
    items = [];
    cardsEl.textContent = "";
    shareFallback.hidden = true;
    hideError();
    if (files.length > MAX) {
      showError("一次最多 " + MAX + " 张。你这次选了 " + files.length + " 张，这些照片都没有处理，请重新选择。");
      photoInput.value = "";
      updateShare();
      updateDebug();
      return;
    }
    items = files.map(function (file) {
      return {
        sel: sel,
        file: file,
        exif: null,
        exifReady: false,
        readError: "",
        dateSource: null,
        shoot: null,
        day: null,
        outBlob: null,
        outUrl: "",
        outName: "",
        error: "",
        decodeNote: "",
        pending: true,
        el: null,
      };
    });
    renderCards();
    updateShare();
    updateDebug();
    enqueue(function () { return runJob(myJob); });
  }

  function onStartChange() {
    localStorage.setItem(START_KEY, startInput.value || "");
    if (!items.length) {
      updateDebug();
      return;
    }
    job += 1;
    var myJob = job;
    shareFallback.hidden = true;
    items.forEach(function (item) {
      clearOutput(item);
      item.pending = true;
      if (!item.readError) item.error = "";
      updateCard(item);
    });
    updateShare();
    updateDebug();
    enqueue(function () { return runJob(myJob); });
  }

  function onManualChange(item) {
    if (!item || item.dateSource !== "manual" || item.sel !== selection) return;
    job += 1;
    var myJob = job;
    shareFallback.hidden = true;
    clearOutput(item);
    item.pending = true;
    item.error = "";
    updateCard(item);
    updateShare();
    enqueue(function () { return runJob(myJob); });
  }

  function enqueue(fn) {
    var next = chain.then(fn, fn);
    chain = next.then(function () {}, function () {});
    return next;
  }

  function runJob(myJob) {
    var index = 0;
    function next() {
      if (myJob !== job) return Promise.resolve();
      if (index >= items.length) {
        updateShare();
        updateDebug();
        return Promise.resolve();
      }
      var item = items[index++];
      return ensure(item, myJob).then(next, next);
    }
    return next();
  }

  function ensure(item, myJob) {
    if (myJob !== job || item.sel !== selection) return Promise.resolve();
    var prep = item.exifReady ? Promise.resolve() : readOne(item);
    return prep.then(function () {
      if (myJob !== job || item.sel !== selection) return;
      if (item.readError) {
        item.pending = false;
        item.error = item.readError;
        clearOutput(item);
        updateCard(item);
        updateShare();
        return;
      }
      var start = parseIsoDate(startInput.value);
      if (!start) {
        item.pending = false;
        clearOutput(item);
        showError("请先填写起始日。");
        updateCard(item);
        updateShare();
        return;
      }
      hideError();
      if (item.dateSource === "manual") {
        var manualInput = item.el && item.el.querySelector(".manual-date");
        item.shoot = parseIsoDate(manualInput && manualInput.value);
      }
      if (!item.shoot) {
        item.pending = false;
        clearOutput(item);
        updateCard(item);
        updateShare();
        return;
      }
      var day = calendarDays(item.shoot, start) + 1;
      if (item.outBlob && item.day === day && !item.error) {
        item.pending = false;
        updateCard(item);
        updateShare();
        return;
      }
      clearOutput(item);
      item.pending = true;
      item.error = "";
      updateCard(item);
      return doStamp(item, day, myJob);
    });
  }

  function readOne(item) {
    return item.file.arrayBuffer().then(function (buf) {
      if (item.sel !== selection) return;
      try {
        item.exif = readExif(buf);
      } catch (err) {
        item.readError = "读取文件失败：" + messageOf(err);
      }
      buf = null;
      item.exifReady = true;
      if (!item.readError) {
        var shoot = dateFromExif(item.exif);
        if (shoot) {
          item.dateSource = shoot.source;
          item.shoot = shoot.date;
        } else {
          item.dateSource = "manual";
          item.shoot = null;
        }
      }
      updateCard(item);
      updateDebug();
    }).catch(function (err) {
      if (item.sel !== selection) return;
      item.exifReady = true;
      item.readError = "读取文件失败：" + messageOf(err);
      updateCard(item);
      updateDebug();
    });
  }

  function renderCards() {
    cardsEl.textContent = "";
    items.forEach(function (item, index) {
      var art = document.createElement("article");
      art.className = "card";
      var manualId = "manual-" + item.sel + "-" + index;
      art.innerHTML =
        '<p class="file-name"></p>' +
        '<p class="exif-line" hidden></p>' +
        '<div class="manual" hidden>' +
          '<p>没有读到拍摄日期，请手动选择。</p>' +
          '<label for="' + manualId + '">拍摄日期</label>' +
          '<input class="manual-date" id="' + manualId + '" type="date">' +
        "</div>" +
        '<p class="card-error" hidden></p>' +
        '<p class="pending" hidden></p>' +
        '<p class="day-line" hidden>DAY <span class="day-number"></span></p>' +
        '<img class="preview" alt="加上水印后的照片" hidden>' +
        '<p class="out-name" hidden></p>' +
        '<p class="save-hint" hidden>也可以长按图片，选择保存到相册。</p>' +
        '<button class="save-one" type="button" hidden>保存这张</button>';
      art.querySelector(".manual-date").addEventListener("change", function () {
        onManualChange(item);
      });
      art.querySelector(".save-one").addEventListener("click", function () {
        saveOne(item);
      });
      item.el = art;
      cardsEl.appendChild(art);
      updateCard(item);
    });
  }

  function updateCard(item) {
    var el = item.el;
    if (!el) return;
    el.querySelector(".file-name").textContent = item.file.name || "（无文件名）";
    var exifLine = el.querySelector(".exif-line");
    var manual = el.querySelector(".manual");
    var err = el.querySelector(".card-error");
    var pending = el.querySelector(".pending");
    var dayLine = el.querySelector(".day-line");
    var dayNum = el.querySelector(".day-number");
    var preview = el.querySelector(".preview");
    var outName = el.querySelector(".out-name");
    var hint = el.querySelector(".save-hint");
    var saveBtn = el.querySelector(".save-one");

    var showManual = item.exifReady && item.dateSource === "manual" && !item.readError;
    manual.hidden = !showManual;
    if (item.shoot && item.dateSource && item.dateSource !== "manual") {
      exifLine.hidden = false;
      exifLine.textContent = "读取到的拍摄日期：" + item.shoot.iso;
    } else {
      exifLine.hidden = true;
      exifLine.textContent = "";
    }
    err.hidden = !item.error;
    err.textContent = item.error || "";
    var showResult = !!(item.outUrl && item.day != null && !item.error);
    dayLine.hidden = !showResult;
    if (showResult) dayNum.textContent = String(item.day);
    pending.hidden = !item.pending;
    pending.textContent = item.exifReady ? "处理中…" : "读取中…";
    if (showResult) {
      if (preview.getAttribute("src") !== item.outUrl) preview.src = item.outUrl;
      preview.alt = "加上水印后的照片：" + (item.file.name || "");
      preview.hidden = false;
      outName.hidden = false;
      outName.textContent = "保存文件名：" + item.outName;
    } else {
      preview.hidden = true;
      preview.removeAttribute("src");
      outName.hidden = true;
      outName.textContent = "";
    }
    hint.hidden = !showResult;
    saveBtn.hidden = !showResult;
  }

  function updateShare() {
    var ready = items.filter(isReady);
    var show = items.length >= 2 && ready.length >= 1;
    shareAllBtn.hidden = !show;
    shareNote.hidden = !show;
    if (!show) {
      shareIncomplete.hidden = true;
      return;
    }
    if (ready.length === items.length) {
      shareAllBtn.textContent = "分享全部（" + ready.length + " 张）";
      shareIncomplete.hidden = true;
    } else {
      shareAllBtn.textContent = "分享已完成的 " + ready.length + " 张";
      shareIncomplete.hidden = false;
    }
  }

  function isReady(item) {
    return !!(item.outBlob && item.outName && item.day != null && !item.error);
  }

  function clearOutput(item) {
    item.day = null;
    item.outBlob = null;
    item.outName = "";
    if (item.outUrl) {
      URL.revokeObjectURL(item.outUrl);
      item.outUrl = "";
    }
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function messageOf(err) {
    return err && err.message ? err.message : String(err);
  }

  function updateDebug() {
    var lines = [];
    lines.push("浏览器：" + navigator.userAgent);
    lines.push("起始日：" + (startInput.value || "（未填）"));
    lines.push("照片数：" + items.length);
    if (!items.length) {
      lines.push(errorEl.hidden ? "还没有选择照片。" : errorEl.textContent);
    }
    items.forEach(function (item, index) {
      var file = item.file;
      var exif = item.exif || {};
      lines.push("");
      lines.push("—" + (index + 1) + "—");
      lines.push("文件：" + (file.name || "（无文件名）"));
      lines.push("类型：" + (file.type || "（未知）") + "，大小：" + formatSize(file.size));
      lines.push("文件修改时间：" + formatLastModified(file) + "（仅供参考，未用作拍摄日期）");
      lines.push("EXIF DateTimeOriginal：" + (exif.dateTimeOriginal || "（无）"));
      lines.push("EXIF CreateDate：" + (exif.createDate || "（无）"));
      lines.push("EXIF 方位：" + (exif.orientation != null ? String(exif.orientation) : "（无）"));
      lines.push("拍摄日期来源：" + (item.dateSource || "（无）"));
      lines.push("拍摄日期：" + (item.shoot ? item.shoot.iso : "（无）"));
      lines.push("DAY：" + (item.day != null ? String(item.day) : "（未计算）"));
      if (item.outName) lines.push("保存文件名：" + item.outName);
      if (item.decodeNote) lines.push("解码：" + item.decodeNote);
      if (item.error) lines.push("错误：" + item.error);
    });
    debugBody.textContent = lines.join("\n");
  }

  function formatSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function formatLastModified(file) {
    if (!file.lastModified) return "（无）";
    var d = new Date(file.lastModified);
    if (isNaN(d.getTime())) return "（无）";
    return pad(d.getFullYear(), 4) + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2)
      + " " + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2);
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  }

  /* ---- dates: calendar Y-M-D only, never Date.parse of YYYY-MM-DD ---- */

  function parseIsoDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, mo: mo, d: d, iso: m[0] };
  }

  function parseExifDate(str) {
    if (!str) return null;
    var m = String(str).trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})/);
    if (!m) return null;
    return parseIsoDate(m[1] + "-" + m[2] + "-" + m[3]);
  }

  function calendarDays(a, b) {
    var ms = Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d);
    return Math.round(ms / 86400000);
  }

  function dateFromExif(exif) {
    if (!exif) return null;
    var orig = parseExifDate(exif.dateTimeOriginal);
    if (orig) return { date: orig, source: "EXIF DateTimeOriginal" };
    var created = parseExifDate(exif.createDate);
    if (created) return { date: created, source: "EXIF CreateDate" };
    return null;
  }

  /* ---- EXIF reader (JPEG APP1, plus a signature scan for HEIC) ---- */

  function readExif(buffer) {
    var u8 = new Uint8Array(buffer);
    var off = findTiffOffset(u8);
    if (off < 0) {
      return { dateTimeOriginal: null, createDate: null, orientation: null, dateTime: null };
    }
    return parseTiff(u8, off);
  }

  function isTiffHeader(u8, i) {
    if (i + 8 > u8.length) return false;
    var le = u8[i] === 0x49 && u8[i + 1] === 0x49 && u8[i + 2] === 0x2a && u8[i + 3] === 0x00;
    var be = u8[i] === 0x4d && u8[i + 1] === 0x4d && u8[i + 2] === 0x00 && u8[i + 3] === 0x2a;
    return le || be;
  }

  function isExifPrefix(u8, i) {
    return i + 6 <= u8.length
      && u8[i] === 0x45 && u8[i + 1] === 0x78 && u8[i + 2] === 0x69 && u8[i + 3] === 0x66
      && u8[i + 4] === 0x00 && u8[i + 5] === 0x00;
  }

  function findTiffOffset(u8) {
    if (u8.length >= 4 && u8[0] === 0xFF && u8[1] === 0xD8) {
      var i = 2;
      while (i + 4 <= u8.length && u8[i] === 0xFF) {
        var marker = u8[i + 1];
        if (marker === 0xDA || marker === 0xD9) break;
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD8)) {
          i += 2;
          continue;
        }
        var len = (u8[i + 2] << 8) | u8[i + 3];
        if (len < 2 || i + 2 + len > u8.length) break;
        if (marker === 0xE1 && len >= 8 && isExifPrefix(u8, i + 4) && isTiffHeader(u8, i + 10)) {
          return i + 10;
        }
        i += 2 + len;
      }
    }
    for (var j = 0; j + 14 < u8.length; j++) {
      if (isExifPrefix(u8, j) && isTiffHeader(u8, j + 6)) return j + 6;
    }
    return -1;
  }

  function parseTiff(u8, start) {
    var view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var le = u8[start] === 0x49;
    function u16(abs) {
      if (abs < 0 || abs + 2 > view.byteLength) return 0;
      return view.getUint16(abs, le);
    }
    function u32(abs) {
      if (abs < 0 || abs + 4 > view.byteLength) return 0;
      return view.getUint32(abs, le);
    }
    var empty = { dateTimeOriginal: null, createDate: null, orientation: null, dateTime: null };
    if (u16(start + 2) !== 0x002A) return empty;
    var ifd0 = u32(start + 4);
    var dir0 = readIfd(view, start, ifd0, le);
    var result = {
      orientation: dir0[TAG_ORIENTATION] != null ? Number(dir0[TAG_ORIENTATION]) : null,
      dateTime: dir0[TAG_DATETIME] || null,
      dateTimeOriginal: null,
      createDate: null,
    };
    var exifOff = dir0[TAG_EXIF_IFD];
    if (exifOff) {
      var dirExif = readIfd(view, start, Number(exifOff), le);
      result.dateTimeOriginal = dirExif[TAG_DATETIME_ORIGINAL] || null;
      result.createDate = dirExif[TAG_DATETIME_DIGITIZED] || null;
    }
    return result;
  }

  function readIfd(view, tiffStart, ifdRel, le) {
    var entries = {};
    var abs = tiffStart + ifdRel;
    if (abs < 0 || abs + 2 > view.byteLength) return entries;
    var count = le ? view.getUint16(abs, true) : view.getUint16(abs, false);
    if (count > 256) return entries;
    for (var i = 0; i < count; i++) {
      var e = abs + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      var tag = le ? view.getUint16(e, true) : view.getUint16(e, false);
      var typ = le ? view.getUint16(e + 2, true) : view.getUint16(e + 2, false);
      var cnt = le ? view.getUint32(e + 4, true) : view.getUint32(e + 4, false);
      var valAbs = e + 8;
      var unit = typ === 1 || typ === 2 || typ === 6 || typ === 7 ? 1
        : typ === 3 || typ === 8 ? 2
        : typ === 4 || typ === 9 || typ === 11 ? 4
        : typ === 5 || typ === 10 || typ === 12 ? 8
        : 0;
      var size = unit * cnt;
      if (size < 0 || size > 64 * 1024) continue;
      var dataAbs = size > 4 ? tiffStart + (le ? view.getUint32(valAbs, true) : view.getUint32(valAbs, false)) : valAbs;
      if (dataAbs < 0 || dataAbs + Math.min(size, 4) > view.byteLength) continue;
      if (typ === 2) {
        var n = cnt;
        if (dataAbs + n > view.byteLength) n = view.byteLength - dataAbs;
        if (n <= 0) continue;
        var chars = new Uint8Array(view.buffer, view.byteOffset + dataAbs, n);
        var s = "";
        for (var k = 0; k < chars.length; k++) {
          if (chars[k] === 0) break;
          s += String.fromCharCode(chars[k]);
        }
        entries[tag] = s;
      } else if (typ === 3 && cnt >= 1) {
        entries[tag] = le ? view.getUint16(dataAbs, true) : view.getUint16(dataAbs, false);
      } else if ((typ === 4 || typ === 9) && cnt >= 1) {
        entries[tag] = le ? view.getUint32(dataAbs, true) : view.getUint32(dataAbs, false);
      }
    }
    return entries;
  }

  /* ---- image + watermark, one photo at a time ---- */

  function doStamp(item, day, myJob) {
    return loadOrientedImage(item).then(function (img) {
      if (myJob !== job || item.sel !== selection) {
        closeImg(img);
        releaseCanvas();
        return null;
      }
      var w = img.width || img.naturalWidth;
      var h = img.height || img.naturalHeight;
      if (!w || !h) {
        closeImg(img);
        throw new Error("无法读取图片尺寸");
      }
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      closeImg(img);

      var text = "DAY " + day;
      var fontSize = Math.max(28, Math.round(w * 0.055));
      var padPx = Math.round(fontSize * 0.7);
      ctx.save();
      ctx.font = "bold " + fontSize + "px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = Math.round(fontSize * 0.35);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(fontSize * 0.06);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, w - padPx, h - padPx);
      ctx.restore();

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          releaseCanvas();
          if (blob) resolve(blob);
          else reject(new Error("无法导出图片"));
        }, "image/jpeg", 0.92);
      });
    }).then(function (blob) {
      if (!blob) return;
      if (myJob !== job || item.sel !== selection) return;
      item.day = day;
      item.outBlob = blob;
      item.outName = uniqueName(item);
      item.outUrl = URL.createObjectURL(blob);
      item.pending = false;
      item.error = "";
      updateCard(item);
      updateShare();
      updateDebug();
    }).catch(function (err) {
      releaseCanvas();
      if (myJob !== job || item.sel !== selection) return;
      item.pending = false;
      item.error = "处理照片失败：" + messageOf(err);
      clearOutput(item);
      updateCard(item);
      updateShare();
      updateDebug();
    });
  }

  function uniqueName(item) {
    var base = stripExt(item.file.name || "photo");
    var used = {};
    items.forEach(function (other) {
      if (other !== item && other.outName) used[other.outName] = true;
    });
    var name = "DAY-" + item.day + "-" + base + ".jpg";
    var n = 2;
    while (used[name]) {
      name = "DAY-" + item.day + "-" + base + "-" + n + ".jpg";
      n += 1;
    }
    return name;
  }

  function stripExt(name) {
    var base = String(name || "photo").split(/[/\\]/).pop();
    var dot = base.lastIndexOf(".");
    if (dot > 0) base = base.slice(0, dot);
    base = base.replace(/[^\w.\-\u0080-\uFFFF]+/g, "_");
    if (!base) base = "photo";
    if (base.length > 48) base = base.slice(0, 48);
    return base;
  }

  function closeImg(img) {
    if (img && typeof img.close === "function") {
      try { img.close(); } catch (e) {}
    }
  }

  function releaseCanvas() {
    canvas.width = 0;
    canvas.height = 0;
  }

  function loadOrientedImage(item) {
    var file = item.file;
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
        item.decodeNote = "createImageBitmap(from-image) " + bmp.width + "x" + bmp.height;
        return bmp;
      }).catch(function () {
        return createImageBitmap(file).then(function (bmp) {
          item.decodeNote = "createImageBitmap() " + bmp.width + "x" + bmp.height;
          return bmp;
        });
      }).catch(function () {
        return loadViaImg(item);
      });
    }
    return loadViaImg(item);
  }

  function loadViaImg(item) {
    var file = item.file;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        item.decodeNote = "<img> " + img.naturalWidth + "x" + img.naturalHeight;
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("浏览器无法解码这张图片（可能是 HEIC）。"));
      };
      img.src = url;
    });
  }

  function saveOne(item) {
    if (!isReady(item)) return;
    var outFile = new File([item.outBlob], item.outName, { type: "image/jpeg" });
    var canShare = false;
    try {
      canShare = !!(navigator.canShare && navigator.canShare({ files: [outFile] }));
    } catch (e) {
      canShare = false;
    }
    if (canShare && navigator.share) {
      navigator.share({ files: [outFile], title: "DAY " + item.day }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        downloadFile(outFile);
      });
      return;
    }
    downloadFile(outFile);
  }

  function onShareAll() {
    shareFallback.hidden = true;
    var ready = items.filter(isReady);
    if (!ready.length) return;
    var files = ready.map(function (item) {
      return new File([item.outBlob], item.outName, { type: "image/jpeg" });
    });
    var canShare = false;
    try {
      canShare = !!(navigator.canShare && navigator.canShare({ files: files }));
    } catch (e) {
      canShare = false;
    }
    if (canShare && navigator.share) {
      navigator.share({ files: files }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        shareFallback.hidden = false;
      });
      return;
    }
    shareFallback.hidden = false;
  }

  function downloadFile(file) {
    var url = URL.createObjectURL(file);
    var a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  updateDebug();
})();
