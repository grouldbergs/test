/* TinyDays: stamp month age on up to 20 photos locally. Never upload. */
(function () {
  "use strict";

  var MAX = 20;
  var STAMP_WIDTH_RATIO = 0.20;
  var TEMPLATE_ID = "03";
  var code = "";
  var TAG_ORIENTATION = 0x0112;
  var TAG_DATETIME = 0x0132;
  var TAG_EXIF_IFD = 0x8769;
  var TAG_DATETIME_ORIGINAL = 0x9003;
  var TAG_DATETIME_DIGITIZED = 0x9004; // CreateDate in ExifTool

  var gate = document.getElementById("access-form");
  var accessError = document.getElementById("access-error");
  var retry = document.getElementById("retry");
  var saveStatus = document.getElementById("save-status");
  var photoInput = document.getElementById("photo");
  var photoLabel = document.getElementById("photo-label");
  photoLabel.textContent = "选择照片（最多 " + MAX + " 张）";
  var errorEl = document.getElementById("error");
  var summary = document.getElementById("batch-summary");
  var example = document.getElementById("example");
  var exampleImage = document.getElementById("example-image");
  var exampleSave = document.getElementById("example-save");
  var exampleItem = null;
  var exampleUrl = "";
  var stamps = new Map();
  var cardsEl = document.getElementById("cards");
  var shareNote = document.getElementById("share-note");
  var shareIncomplete = document.getElementById("share-incomplete");
  var shareAllBtn = document.getElementById("share-all");
  var shareFallback = document.getElementById("share-fallback");
  var canvas = document.getElementById("work");
  var ctx = canvas.getContext("2d");

  var items = [];
  var selection = 0;
  var job = 0;
  var chain = Promise.resolve();

  gate.addEventListener("submit", async function (event) {
    event.preventDefault();
    var input = document.getElementById("code");
    var button = document.getElementById("access-submit");
    var candidate = input.value.trim();
    if (!candidate || button.disabled) return;
    button.disabled = true;
    input.readOnly = true;
    accessError.textContent = "正在验证兑换码…";
    try {
      var result = await request("/api/redemption/lookup", { code: candidate });
      if (result.state !== "activated") throw new Error("请先到激活页选择模板并完成激活。");
      if (!result.templates.some(function (template) { return template.template_id === TEMPLATE_ID; })) {
        throw new Error("网页版试用支持月龄印章。你可以在激活页找回已激活模板的快捷指令。");
      }
      code = candidate;
      input.value = "";
      gate.hidden = true;
      document.getElementById("tool").hidden = false;
      photoInput.focus();
    } catch (error) {
      accessError.textContent = messageOf(error);
    } finally {
      button.disabled = false;
      input.readOnly = false;
    }
  });
  retry.addEventListener("click", function () {
    items.forEach(function (item) {
      if (!item.error) return;
      if (item.readError) item.exifReady = false;
      item.readError = "";
      item.error = "";
      item.pending = true;
      updateCard(item);
    });
    updateShare();
    var myJob = ++job;
    enqueue(function () { return runJob(myJob); });
  });
  photoInput.addEventListener("change", onPhotoPicked);
  shareAllBtn.addEventListener("click", onShareAll);
  exampleSave.addEventListener("click", function () {
    if (exampleItem) saveOne(exampleItem);
  });

  function onPhotoPicked() {
    var files = photoInput.files ? Array.prototype.slice.call(photoInput.files) : [];
    if (!code || !files.length) return;
    photoInput.value = "";
    saveStatus.textContent = "";
    job += 1;
    var myJob = job;
    selection += 1;
    var sel = selection;
    items.forEach(function (item) {
      if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
    });
    clearExample();
    stamps.clear();
    items = [];
    cardsEl.textContent = "";
    shareFallback.hidden = true;
    hideError();
    if (files.length > MAX) {
      showError("一次最多 " + MAX + " 张。你这次选了 " + files.length + " 张，这些照片都没有处理，请重新选择。");
      photoInput.value = "";
      updateShare();
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
        outBlob: null,
        originalUrl: "",
        outName: "",
        error: "",
        pending: true,
        el: null,
      };
    });
    renderCards();
    updateShare();
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

  async function runJob(myJob) {
    var batch = items;
    for (var item of batch) {
      if (myJob !== job) return;
      if (!item.exifReady) {
        await readOne(item);
        if (myJob !== job) return;
        updateShare();
      }
    }
    for (var item of batch) {
      if (myJob !== job) return;
      await ensure(item, myJob);
    }
    if (myJob === job) {
      updateShare();
    }
  }

  function ensure(item, myJob) {
    if (myJob !== job || item.sel !== selection) return Promise.resolve();
    return Promise.resolve().then(function () {
      if (myJob !== job || item.sel !== selection) return;
      if (item.readError) {
        item.pending = false;
        item.error = item.readError;
        clearOutput(item);
        updateCard(item);
        updateShare();
        return;
      }
      if (isReady(item) || item.error) return;
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
      clearOutput(item);
      item.pending = true;
      item.error = "";
      updateCard(item);
      return doStamp(item, item.shoot.iso, myJob);
    });
  }

  function readOne(item) {
    // JPEG EXIF normally fits in its initial APP segments. Only read the full
    // file when the prefix does not provide a date, or for other containers.
    return item.file.slice(0, 128 * 1024).arrayBuffer().then(function (prefix) {
      if (item.sel !== selection) return null;
      var bytes = new Uint8Array(prefix);
      if (prefix.byteLength === item.file.size ||
          (bytes[0] === 0xff && bytes[1] === 0xd8 && dateFromExif(readExif(prefix)))) return prefix;
      return item.file.arrayBuffer();
    }).then(function (buf) {
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
    }).catch(function (err) {
      if (item.sel !== selection) return;
      item.exifReady = true;
      item.readError = "读取文件失败：" + messageOf(err);
      updateCard(item);
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
        '<div class="manual" hidden>' +
          '<img class="original" alt="待补日期的原照片" loading="lazy" decoding="async" hidden>' +
          '<p class="original-error" hidden>浏览器无法预览这张原照片，请按文件名确认。</p>' +
          '<p>没有读到拍摄日期，请手动选择。</p>' +
          '<label for="' + manualId + '">拍摄日期</label>' +
          '<input class="manual-date" id="' + manualId + '" type="date">' +
        "</div>" +
        '<p class="card-error" hidden></p>' +
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
    var manual = el.querySelector(".manual");
    var original = el.querySelector(".original");
    var err = el.querySelector(".card-error");
    var saveBtn = el.querySelector(".save-one");

    var showManual = item.exifReady && item.dateSource === "manual" && !item.readError;
    manual.hidden = !showManual;
    if (showManual && !item.originalUrl) {
      item.originalUrl = URL.createObjectURL(item.file);
      original.onload = function () { original.hidden = false; };
      original.onerror = function () {
        original.hidden = true;
        el.querySelector(".original-error").hidden = false;
      };
      original.hidden = false;
      original.src = item.originalUrl;
    }
    err.hidden = !item.error;
    err.textContent = item.error || "";
    var showFallback = isReady(item) && (!shareFallback.hidden || item !== exampleItem);
    saveBtn.hidden = !showFallback;
    el.hidden = !showManual && !item.error && !showFallback;
  }

  function clearExample() {
    if (exampleUrl) URL.revokeObjectURL(exampleUrl);
    exampleUrl = "";
    exampleItem = null;
    example.hidden = true;
    exampleImage.removeAttribute("src");
  }

  function updateSummary(readyCount) {
    summary.hidden = items.length === 0;
    if (summary.hidden) return;
    var automatic = items.filter(function (item) {
      return item.dateSource && item.dateSource !== "manual" && !item.error;
    }).length;
    var missing = items.filter(function (item) {
      return item.dateSource === "manual" && !parseIsoDate(item.el.querySelector(".manual-date").value);
    }).length;
    var reading = items.some(function (item) { return !item.exifReady; });
    var failed = items.filter(function (item) { return item.error; }).length;
    var processing = items.some(function (item) { return item.pending; });
    retry.hidden = !failed;
    retry.disabled = processing;
    summary.textContent = "已选 " + items.length + " 张。" + (reading ? "正在读取拍摄日期…" :
      automatic + " 张已自动识别日期，可直接添加水印。" +
      (missing ? " " + missing + " 张需要补拍摄日期。" : "") +
      (readyCount ? " 已生成 " + readyCount + " 张。" : "") +
      (failed ? " " + failed + " 张处理失败。" : "") +
      (processing ? " 正在生成…" : ""));
  }

  function updateShare() {
    var ready = items.filter(isReady);
    updateSummary(ready.length);
    var nextExample = ready[0] || null;
    if (nextExample !== exampleItem) {
      clearExample();
      if (nextExample) {
        exampleItem = nextExample;
        exampleUrl = URL.createObjectURL(nextExample.outBlob);
        exampleImage.src = exampleUrl;
        example.hidden = false;
      }
    }
    items.forEach(updateCard);
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
    return !!(item.outBlob && item.outName && !item.error);
  }

  function clearOutput(item) {
    item.outBlob = null;
    item.outName = "";
    if (item === exampleItem) clearExample();
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

  /* ---- dates: calendar Y-M-D only, never Date.parse of YYYY-MM-DD ---- */

  function parseIsoDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
    var leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    var monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (d > monthLengths[mo - 1]) return null;
    return { y: y, mo: mo, d: d, iso: m[0] };
  }

  function parseExifDate(str) {
    if (!str) return null;
    var m = String(str).trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})/);
    if (!m) return null;
    return parseIsoDate(m[1] + "-" + m[2] + "-" + m[3]);
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

  function doStamp(item, photoDate, myJob) {
    return stampFor(photoDate).then(async function (stamp) {
      if (!stamp || myJob !== job || item.sel !== selection) return null;
      var img = await loadOrientedImage(item);
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

      var stampWidth = w * STAMP_WIDTH_RATIO;
      var stampHeight = stampWidth * stamp.naturalHeight / stamp.naturalWidth;
      ctx.drawImage(stamp, w * 0.05, h * 0.97 - stampHeight, stampWidth, stampHeight);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          releaseCanvas();
          if (blob && blob.type === "image/jpeg") resolve(blob);
          else reject(new Error("无法导出图片"));
        }, "image/jpeg", 0.92);
      });
    }).then(function (blob) {
      if (!blob) return;
      if (myJob !== job || item.sel !== selection) return;
      item.outBlob = blob;
      item.outName = uniqueName(item);
      item.pending = false;
      item.error = "";
      updateCard(item);
      updateShare();
    }).catch(function (err) {
      releaseCanvas();
      if (myJob !== job || item.sel !== selection) return;
      item.pending = false;
      item.error = "处理照片失败：" + messageOf(err);
      clearOutput(item);
      updateCard(item);
      updateShare();
    });
  }

  async function request(path, payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response;
      try {
        response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal
        });
      } catch {
        throw new Error("暂时无法连接 TinyDays，请检查网络后重试。");
      }
      if (!response.ok) {
        var error = await response.json().catch(function () { return {}; });
        var messages = {
          invalid_code: "兑换码无效，请核对后重试。",
          invalid_request: "请核对兑换码格式。",
          inactive_code: "兑换码不可用。如已购买，请联系店铺客服。",
          redemption_unavailable: "此兑换码暂不可用，请联系店铺客服。",
          template_not_entitled: "此兑换码没有月龄印章权益。",
          template_not_found: "网页版月龄印章暂不可用。",
          template_unavailable: "月龄印章暂不可用，请联系店铺客服。",
          entitlement_inactive: "请先完成月龄印章激活。",
          photo_before_start: "拍摄日期早于激活时设置的开始日期。",
          invalid_photo_date: "拍摄日期无效，请检查照片日期。"
        };
        var message = Object.hasOwn(messages, error.code) ? messages[error.code] : "服务暂时不可用，请稍后重试。";
        throw new Error(message);
      }
      return path === "/api/stamp" ? await response.blob() : await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function stampFor(photoDate) {
    if (stamps.has(photoDate)) return stamps.get(photoDate);
    var promise = request("/api/stamp", {
      code: code,
      photo_date: photoDate,
      template_id: TEMPLATE_ID
    }).then(function (png) {
      if (png.type !== "image/png") throw new Error("暂时无法获取月龄印章。");
      return loadStampImage(png);
    }).catch(function (error) {
      if (stamps.get(photoDate) === promise) stamps.delete(photoDate);
      throw error;
    });
    stamps.set(photoDate, promise);
    if (stamps.size > 4) stamps.delete(stamps.keys().next().value);
    return promise;
  }

  function loadStampImage(png) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("无法读取月龄印章"));
      };
      image.src = url;
    });
  }

  function uniqueName(item) {
    var base = stripExt(item.file.name || "photo");
    var used = {};
    items.forEach(function (other) {
      if (other !== item && other.outName) used[other.outName] = true;
    });
    var name = "TinyDays-" + base + ".jpg";
    var n = 2;
    while (used[name]) {
      name = "TinyDays-" + base + "-" + n + ".jpg";
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
        return bmp;
      }).catch(function () {
        return createImageBitmap(file).then(function (bmp) {
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
      navigator.share({ files: [outFile], title: "TinyDays 月龄印章" }).then(reportShare).catch(function (err) {
        if (err && err.name === "AbortError") return;
        downloadFile(outFile);
      });
      return;
    }
    downloadFile(outFile);
  }

  function showShareFallback() {
    shareFallback.hidden = false;
    items.forEach(updateCard);
  }

  function onShareAll() {
    shareFallback.hidden = true;
    items.forEach(updateCard);
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
      navigator.share({ files: files }).then(reportShare).catch(function (err) {
        if (err && err.name === "AbortError") return;
        showShareFallback();
      });
      return;
    }
    showShareFallback();
  }

  function reportShare() {
    saveStatus.textContent = "已交给系统分享，请打开相册确认照片已保存。";
  }

  function downloadFile(file) {
    saveStatus.textContent = "已请求下载，请在浏览器的下载项目中查看。";
    var url = URL.createObjectURL(file);
    var a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
})();
