/* TinyDays web MVP: read a photo locally, stamp DAY N, never upload. */
(function () {
  "use strict";

  var START_KEY = "tinydays-start-date";
  var TAG_ORIENTATION = 0x0112;
  var TAG_DATETIME = 0x0132;
  var TAG_EXIF_IFD = 0x8769;
  var TAG_DATETIME_ORIGINAL = 0x9003;
  var TAG_DATETIME_DIGITIZED = 0x9004; // CreateDate in ExifTool

  var startInput = document.getElementById("start-date");
  var photoInput = document.getElementById("photo");
  var exifDateLine = document.getElementById("exif-date-line");
  var exifDateEl = document.getElementById("exif-date");
  var manualWrap = document.getElementById("manual-wrap");
  var manualInput = document.getElementById("shoot-date-manual");
  var errorEl = document.getElementById("error");
  var dayLine = document.getElementById("day-line");
  var dayNumberEl = document.getElementById("day-number");
  var preview = document.getElementById("preview");
  var saveHint = document.getElementById("save-hint");
  var saveBtn = document.getElementById("save");
  var debugBody = document.getElementById("debug-body");
  var canvas = document.getElementById("work");
  var ctx = canvas.getContext("2d");

  var state = {
    file: null,
    fileBuffer: null,
    exif: null,
    dateSource: null, // "EXIF DateTimeOriginal" | "EXIF CreateDate" | "manual"
    shoot: null,
    day: null,
    outBlob: null,
    outUrl: null,
    decodeNote: "",
  };

  startInput.value = localStorage.getItem(START_KEY) || "";
  startInput.addEventListener("change", function () {
    localStorage.setItem(START_KEY, startInput.value || "");
    if (state.file) render();
  });
  photoInput.addEventListener("change", onPhotoPicked);
  manualInput.addEventListener("change", function () {
    if (state.file && state.dateSource === "manual") render();
  });
  saveBtn.addEventListener("click", onSave);

  function onPhotoPicked() {
    var file = photoInput.files && photoInput.files[0];
    resetOutput();
    state.file = file || null;
    state.fileBuffer = null;
    state.exif = null;
    state.dateSource = null;
    state.shoot = null;
    state.decodeNote = "";
    if (!file) {
      debugBody.textContent = "还没有选择照片。";
      return;
    }
    file.arrayBuffer().then(function (buf) {
      if (state.file !== file) return;
      state.fileBuffer = buf;
      state.exif = readExif(buf);
      var shoot = dateFromExif(state.exif);
      if (shoot) {
        state.dateSource = shoot.source;
        state.shoot = shoot.date;
        manualWrap.hidden = true;
        manualInput.value = "";
        exifDateEl.textContent = shoot.date.iso;
        exifDateLine.hidden = false;
      } else {
        state.dateSource = "manual";
        state.shoot = null;
        exifDateLine.hidden = true;
        manualInput.value = "";
        manualWrap.hidden = false;
      }
      render();
    }).catch(function (err) {
      showError("读取文件失败：" + (err && err.message ? err.message : err));
      updateDebug();
    });
  }

  function render() {
    hideError();
    var start = parseIsoDate(startInput.value);
    if (!state.file) return;
    if (!start) {
      showError("请先填写起始日。");
      dayLine.hidden = true;
      hidePreview();
      updateDebug();
      return;
    }
    if (state.dateSource === "manual") {
      state.shoot = parseIsoDate(manualInput.value);
      if (!state.shoot) {
        dayLine.hidden = true;
        hidePreview();
        updateDebug();
        return;
      }
    }
    if (!state.shoot) {
      updateDebug();
      return;
    }
    state.day = calendarDays(state.shoot, start) + 1;
    dayNumberEl.textContent = String(state.day);
    dayLine.hidden = false;
    stampPhoto(state.file).then(function (blob) {
      state.outBlob = blob;
      if (state.outUrl) URL.revokeObjectURL(state.outUrl);
      state.outUrl = URL.createObjectURL(blob);
      preview.src = state.outUrl;
      preview.hidden = false;
      saveHint.hidden = false;
      saveBtn.hidden = false;
      updateDebug();
    }).catch(function (err) {
      showError("处理照片失败：" + (err && err.message ? err.message : err));
      hidePreview();
      updateDebug();
    });
  }

  function resetOutput() {
    state.day = null;
    state.outBlob = null;
    if (state.outUrl) {
      URL.revokeObjectURL(state.outUrl);
      state.outUrl = null;
    }
    dayLine.hidden = true;
    exifDateLine.hidden = true;
    manualWrap.hidden = true;
    hidePreview();
    hideError();
  }

  function hidePreview() {
    preview.hidden = true;
    preview.removeAttribute("src");
    saveHint.hidden = true;
    saveBtn.hidden = true;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function updateDebug() {
    var file = state.file;
    var exif = state.exif || {};
    var lines = [];
    lines.push("浏览器：" + navigator.userAgent);
    if (file) {
      lines.push("文件：" + (file.name || "（无文件名）"));
      lines.push("类型：" + (file.type || "（未知）") + "，大小：" + formatSize(file.size));
      var lm = formatLastModified(file);
      lines.push("文件修改时间：" + lm + "（仅供参考，未用作拍摄日期）");
    } else {
      lines.push("文件：（未选择）");
    }
    lines.push("EXIF DateTimeOriginal：" + (exif.dateTimeOriginal || "（无）"));
    lines.push("EXIF CreateDate：" + (exif.createDate || "（无）"));
    lines.push("EXIF 方位：" + (exif.orientation != null ? String(exif.orientation) : "（无）"));
    lines.push("拍摄日期来源：" + (state.dateSource || "（无）"));
    lines.push("起始日：" + (startInput.value || "（未填）"));
    lines.push("拍摄日期：" + (state.shoot ? state.shoot.iso : "（无）"));
    lines.push("DAY：" + (state.day != null ? String(state.day) : "（未计算）"));
    if (state.decodeNote) lines.push("解码：" + state.decodeNote);
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

  /* ---- image + watermark ---- */

  function stampPhoto(file) {
    return loadOrientedImage(file).then(function (img) {
      var w = img.width || img.naturalWidth;
      var h = img.height || img.naturalHeight;
      if (!w || !h) throw new Error("无法读取图片尺寸");
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      if (typeof img.close === "function") img.close();

      var text = "DAY " + state.day;
      var fontSize = Math.max(28, Math.round(w * 0.055));
      var pad = Math.round(fontSize * 0.7);
      ctx.save();
      ctx.font = "bold " + fontSize + "px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = Math.round(fontSize * 0.35);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(fontSize * 0.06);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, w - pad, h - pad);
      ctx.restore();

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("无法导出图片"));
        }, "image/jpeg", 0.92);
      });
    });
  }

  function loadOrientedImage(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
        state.decodeNote = "createImageBitmap(from-image) " + bmp.width + "x" + bmp.height;
        return bmp;
      }).catch(function () {
        return createImageBitmap(file).then(function (bmp) {
          state.decodeNote = "createImageBitmap() " + bmp.width + "x" + bmp.height;
          return bmp;
        });
      }).catch(function () {
        return loadViaImg(file);
      });
    }
    return loadViaImg(file);
  }

  function loadViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        state.decodeNote = "<img> " + img.naturalWidth + "x" + img.naturalHeight;
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("浏览器无法解码这张图片（可能是 HEIC）。"));
      };
      img.src = url;
    });
  }

  function onSave() {
    if (!state.outBlob || state.day == null) return;
    var name = "DAY-" + state.day + ".jpg";
    var outFile = new File([state.outBlob], name, { type: "image/jpeg" });
    var canShare = false;
    try {
      canShare = !!(navigator.canShare && navigator.canShare({ files: [outFile] }));
    } catch (e) {
      canShare = false;
    }
    if (canShare && navigator.share) {
      navigator.share({ files: [outFile], title: "DAY " + state.day }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        downloadFile(outFile);
      });
      return;
    }
    downloadFile(outFile);
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
