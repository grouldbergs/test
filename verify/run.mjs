#!/usr/bin/env node
/**
 * Headless verification of the static page against fixture JPEGs.
 * Serves docs/ at /test/ (GitHub Pages project subpath), drives Chromium,
 * and writes screenshots under verify/output/.
 *
 * The share-all case stubs navigator.canShare / navigator.share in the page.
 * That is a browser mock, not an iPhone or Android share sheet.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../docs");
const FIX = path.join(__dirname, "fixtures");
const OUT = path.join(__dirname, "output");
const BASE = "/test";
const CHROME = process.env.CHROME_PATH
  || (fs.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "/usr/bin/google-chrome");

if (!fs.existsSync(path.join(FIX, "day1.jpg")) || !fs.existsSync(path.join(FIX, "not_image.jpg"))) {
  console.error("Missing fixtures. Run: python3 verify/generate_fixtures.py");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === BASE || rel.startsWith(BASE + "/")) {
        rel = rel.slice(BASE.length) || "/";
      }
      if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(ROOT, rel));
      if (!isInside(ROOT, file)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

function dayOf(shoot, start) {
  const [ys, ms, ds] = shoot.split("-").map(Number);
  const [yb, mb, db] = start.split("-").map(Number);
  return Math.round((Date.UTC(ys, ms - 1, ds) - Date.UTC(yb, mb - 1, db)) / 86400000) + 1;
}

function fixPath(name) {
  return path.join(FIX, name);
}

async function debugText(page) {
  return page.locator("#debug-body").innerText();
}

async function gotoFresh(page, origin) {
  await page.goto(origin + BASE + "/", { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
}

async function setStart(page, iso) {
  await page.fill("#start-date", iso);
}

async function pick(page, names) {
  await page.setInputFiles("#photo", names.map(fixPath));
  await page.waitForFunction((n) => {
    const cards = document.querySelectorAll("article.card").length;
    const err = document.getElementById("error");
    const limit = err && !err.hidden && /一次最多 4 张/.test(err.textContent || "");
    return cards === n || (n > 4 && limit && cards === 0);
  }, names.length);
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll("article.card"));
    if (!cards.length) return false;
    return cards.every((card) => {
      const pending = card.querySelector(".pending");
      if (pending && !pending.hidden) return false;
      const manual = card.querySelector(".manual");
      const err = card.querySelector(".card-error");
      if (manual && !manual.hidden) return true;
      if (err && !err.hidden && err.textContent) return true;
      const img = card.querySelector(".preview");
      return img && !img.hidden && img.complete && img.naturalWidth > 0;
    });
  }, null, { timeout: 15000 });
}

async function inspect(page) {
  return page.evaluate(async () => {
    function sample(ctx, w, h) {
      function at(x, y) {
        const d = ctx.getImageData(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)), 1, 1).data;
        return [d[0], d[1], d[2]];
      }
      const sx = Math.floor(w * 0.55);
      const sy = Math.floor(h * 0.75);
      const sw = Math.max(1, Math.min(Math.floor(w * 0.45), w - sx));
      const sh = Math.max(1, Math.min(Math.floor(h * 0.25), h - sy));
      const data = ctx.getImageData(sx, sy, sw, sh).data;
      let white = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white += 1;
      }
      return { midTop: at(Math.floor(w / 2), 20), white };
    }
    const cards = Array.from(document.querySelectorAll("article.card"));
    const out = [];
    for (const card of cards) {
      const img = card.querySelector(".preview");
      let w = 0;
      let h = 0;
      let midTop = null;
      let white = 0;
      let jpeg = false;
      if (img && !img.hidden && img.naturalWidth) {
        w = img.naturalWidth;
        h = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const s = sample(ctx, w, h);
        midTop = s.midTop;
        white = s.white;
        if (img.src.startsWith("blob:")) {
          const buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
          jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        }
      }
      const manual = card.querySelector(".manual");
      const err = card.querySelector(".card-error");
      const dayLine = card.querySelector(".day-line");
      out.push({
        name: card.querySelector(".file-name").textContent,
        exif: card.querySelector(".exif-line").textContent,
        manualHidden: manual.hidden,
        manualText: manual.querySelector("p").textContent,
        error: err.hidden ? "" : err.textContent,
        dayHidden: dayLine.hidden,
        day: card.querySelector(".day-number").textContent,
        outName: card.querySelector(".out-name").textContent,
        w, h, midTop, white, jpeg,
      });
    }
    return {
      cards: out,
      error: document.getElementById("error").hidden ? "" : document.getElementById("error").textContent,
      shareText: document.getElementById("share-all").hidden ? "" : document.getElementById("share-all").textContent,
      shareHidden: document.getElementById("share-all").hidden,
      fallback: document.getElementById("share-fallback").hidden ? "" : document.getElementById("share-fallback").textContent,
      canvas: document.getElementById("work").width,
      decodeMax: window.__decodeMax || 0,
      revokeCount: window.__revokeCount || 0,
    };
  });
}

const results = [];
function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log("OK  " + name + (detail ? " — " + detail : ""));
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log("ERR " + name + " — " + detail);
}

function pageHttp(list) {
  return list.filter((r) => r.url.startsWith("http"));
}

async function main() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  await page.addInitScript(() => {
    window.__shareLog = [];
    window.__canShareLog = [];
    window.__mockShare = false;
    window.__decodeMax = 0;
    window.__slow = false;
    window.__revokeCount = 0;
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (u) {
      window.__revokeCount += 1;
      return origRevoke(u);
    };
    const origBitmap = window.createImageBitmap.bind(window);
    let active = 0;
    window.createImageBitmap = function (...args) {
      active += 1;
      window.__decodeMax = Math.max(window.__decodeMax, active);
      let p = Promise.resolve(origBitmap(...args));
      if (window.__slow) {
        p = p.then((img) => new Promise((resolve) => setTimeout(() => resolve(img), 250)));
      }
      return p.finally(() => { active -= 1; });
    };
    navigator.canShare = function (data) {
      const files = data && data.files ? Array.from(data.files) : [];
      window.__canShareLog.push(files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      return window.__mockShare && files.length > 0;
    };
    navigator.share = function (data) {
      const files = data && data.files ? Array.from(data.files) : [];
      window.__shareLog.push(files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      if (window.__mockShare) return Promise.resolve();
      return Promise.reject(new Error("share unavailable"));
    };
  });

  const net = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith("http:") || u.startsWith("https:")) {
      net.push({ url: u, type: req.resourceType() });
    }
  });
  const responses = [];
  page.on("response", (res) => {
    responses.push({ url: res.url(), status: res.status() });
  });

  try {
    await gotoFresh(page, origin);
    await page.screenshot({ path: path.join(OUT, "01-initial.png"), fullPage: true });

    const appJs = responses.filter((r) => r.url === origin + BASE + "/app.js");
    const foreign = responses.filter((r) => {
      const u = r.url;
      if (u.startsWith(origin + BASE + "/") || u === origin + BASE) return false;
      if (u === origin + "/favicon.ico") return false;
      return u.startsWith("http");
    });
    const multiple = await page.getAttribute("#photo", "multiple");
    const label = await page.locator("label[for='photo']").innerText();
    const subFails = [];
    if (!appJs.some((r) => r.status === 200)) subFails.push("app.js not 200");
    if (foreign.length) subFails.push("foreign " + foreign.map((r) => r.url).join(", "));
    if ((await page.title()) !== "TinyDays") subFails.push("title");
    if (!(await page.locator(".lead").innerText()).includes("原图不会离开这台设备")) subFails.push("lead");
    if (multiple === null) subFails.push("file input is not multiple");
    if (!label.includes("最多 4 张")) subFails.push("limit label missing");
    if (page.url() !== origin + BASE + "/") subFails.push("url " + page.url());
    if (subFails.length) fail("pages-subpath", subFails.join("; "));
    else pass("pages-subpath", BASE + "/ with multiple file input");

    // --- single photo regression ---
    net.length = 0;
    await setStart(page, "2024-03-15");
    await pick(page, ["day1.jpg"]);
    await waitSettled(page);
    const httpDuring = pageHttp(net);
    const day1 = await inspect(page);
    const dbg1 = await debugText(page);
    await page.screenshot({ path: path.join(OUT, "02-day1.png"), fullPage: true });
    const d1 = [];
    const c1 = day1.cards[0];
    if (!c1 || c1.day !== "1") d1.push("DAY " + (c1 && c1.day));
    if (!c1 || !c1.exif.includes("2024-03-15")) d1.push("exif line");
    if (!dbg1.includes("拍摄日期来源：EXIF DateTimeOriginal")) d1.push("source");
    if (!dbg1.includes("未用作拍摄日期")) d1.push("mtime disclaimer");
    if (!c1 || c1.white < 30) d1.push("watermark " + (c1 && c1.white));
    if (!c1 || !c1.jpeg) d1.push("not jpeg");
    if (!c1 || c1.outName !== "保存文件名：DAY-1-day1.jpg") d1.push("name " + (c1 && c1.outName));
    if (httpDuring.length) d1.push("HTTP " + httpDuring.map((r) => r.url).join(", "));
    if (day1.canvas !== 0) d1.push("canvas still " + day1.canvas);
    if (d1.length) fail("day1", d1.join("; "));
    else pass("day1", "DAY 1, jpeg watermark, no HTTP, canvas released");

    await page.reload({ waitUntil: "load" });
    const persisted = await page.inputValue("#start-date");
    if (persisted === "2024-03-15") pass("localStorage start date", persisted);
    else fail("localStorage start date", persisted);

    // --- batch: three dates + manual, orientation, distinct names ---
    await gotoFresh(page, origin);
    net.length = 0;
    const start = "2024-01-01";
    await setStart(page, start);
    await pick(page, ["year_cross.jpg", "cross_month.jpg", "orient6.jpg", "no_exif.jpg"]);
    await waitSettled(page);
    const batchHttp = pageHttp(net);
    const batch = await inspect(page);
    const dbgBatch = await debugText(page);
    await page.screenshot({ path: path.join(OUT, "03-batch-manual.png"), fullPage: true });
    const expectDays = {
      "year_cross.jpg": String(dayOf("2024-01-01", start)),
      "cross_month.jpg": String(dayOf("2024-02-03", start)),
      "orient6.jpg": String(dayOf("2024-04-20", start)),
    };
    const bf = [];
    if (batch.cards.length !== 4) bf.push("cards " + batch.cards.length);
    for (const [name, day] of Object.entries(expectDays)) {
      const card = batch.cards.find((c) => c.name === name);
      if (!card) { bf.push("missing " + name); continue; }
      if (card.day !== day || card.dayHidden) bf.push(name + " DAY " + card.day + " want " + day);
      if (!card.jpeg) bf.push(name + " not jpeg");
      if (card.white < 20) bf.push(name + " watermark " + card.white);
      if (!card.outName.includes("DAY-" + day + "-" + name.replace(/\.jpg$/, ""))) bf.push(name + " out " + card.outName);
      if (!card.manualHidden) bf.push(name + " asked for manual date");
    }
    const noExif = batch.cards.find((c) => c.name === "no_exif.jpg");
    if (!noExif || noExif.manualHidden || !noExif.manualText.includes("没有读到拍摄日期，请手动选择。")) {
      bf.push("no_exif manual prompt missing");
    }
    if (noExif && !noExif.dayHidden) bf.push("no_exif computed DAY " + noExif.day);
    const orient = batch.cards.find((c) => c.name === "orient6.jpg");
    if (!orient || orient.w !== 400 || orient.h !== 600) bf.push("orient size " + (orient && orient.w) + "x" + (orient && orient.h));
    if (orient) {
      const [r, g, b] = orient.midTop || [0, 0, 0];
      if (!(r > 140 && r > g * 1.4 && r > b * 1.4)) bf.push("orient top " + (orient.midTop || []).join(","));
    }
    const names = batch.cards.map((c) => c.outName).filter(Boolean);
    if (new Set(names).size !== names.length) bf.push("duplicate names " + names.join(" | "));
    if (batchHttp.length) bf.push("HTTP during batch " + batchHttp.map((r) => r.url).join(", "));
    if (batch.decodeMax !== 1) bf.push("concurrent decodes " + batch.decodeMax);
    if (!dbgBatch.includes("未用作拍摄日期")) bf.push("mtime disclaimer missing in batch");
    if (!batch.shareText.includes("分享已完成的 3 张")) bf.push("share label " + batch.shareText);
    if (bf.length) fail("batch-four", bf.join("; "));
    else pass("batch-four", "DAY " + Object.values(expectDays).join("/") + ", manual held, orient 400x600, sequential decode, no HTTP");

    const othersBefore = batch.cards.filter((c) => c.name !== "no_exif.jpg").map((c) => c.name + ":" + c.day);
    await page.locator("article.card", { hasText: "no_exif.jpg" }).locator(".manual-date").fill("2024-01-01");
    await waitSettled(page);
    const afterManual = await inspect(page);
    await page.screenshot({ path: path.join(OUT, "04-batch-after-manual.png"), fullPage: true });
    const mf = [];
    const manualCard = afterManual.cards.find((c) => c.name === "no_exif.jpg");
    if (!manualCard || manualCard.day !== "1" || manualCard.white < 20 || !manualCard.jpeg) {
      mf.push("manual result " + JSON.stringify(manualCard && { day: manualCard.day, white: manualCard.white, jpeg: manualCard.jpeg }));
    }
    for (const prev of othersBefore) {
      const [name, day] = prev.split(":");
      const card = afterManual.cards.find((c) => c.name === name);
      if (!card || card.day !== day) mf.push(name + " changed to " + (card && card.day));
    }
    if (!afterManual.shareText.includes("分享全部（4 张）")) mf.push("share label " + afterManual.shareText);
    if (mf.length) fail("manual-does-not-clobber", mf.join("; "));
    else pass("manual-does-not-clobber", "no_exif became DAY 1; other days unchanged");

    // --- CreateDate fallback, single ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-06-01");
    await pick(page, ["createdate_only.jpg"]);
    await waitSettled(page);
    const cd = await inspect(page);
    const dbgCd = await debugText(page);
    if (cd.cards[0] && cd.cards[0].day === "10" && dbgCd.includes("拍摄日期来源：EXIF CreateDate")) {
      pass("createdate-fallback", "DAY 10");
    } else fail("createdate-fallback", "DAY " + (cd.cards[0] && cd.cards[0].day));

    // --- IFD0 datetime must not block or overwrite a sibling ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-03-15");
    await pick(page, ["day1.jpg", "ifd0_datetime_only.jpg"]);
    await waitSettled(page);
    const ifd = await inspect(page);
    const dbgIfd = await debugText(page);
    const ifdCard = ifd.cards.find((c) => c.name === "ifd0_datetime_only.jpg");
    const dayCard = ifd.cards.find((c) => c.name === "day1.jpg");
    const iff = [];
    if (!ifdCard || ifdCard.manualHidden || !ifdCard.dayHidden) iff.push("ifd0 did not stay manual");
    if (dbgIfd.includes("拍摄日期：2020-01-01")) iff.push("used IFD0 date");
    if (!dbgIfd.includes("拍摄日期来源：manual")) iff.push("source not manual");
    if (!dayCard || dayCard.day !== "1" || dayCard.dayHidden) iff.push("sibling DAY " + (dayCard && dayCard.day));
    if (iff.length) fail("ifd0-does-not-block", iff.join("; "));
    else pass("ifd0-does-not-block", "manual only on the IFD0 file; day1 still DAY 1");

    // --- per-file decode failure ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-03-15");
    await pick(page, ["day1.jpg", "not_image.jpg"]);
    await waitSettled(page);
    await page.locator("article.card", { hasText: "not_image.jpg" }).locator(".manual-date").fill("2024-03-15");
    await waitSettled(page);
    const bad = await inspect(page);
    const badCard = bad.cards.find((c) => c.name === "not_image.jpg");
    const goodCard = bad.cards.find((c) => c.name === "day1.jpg");
    const badf = [];
    if (!badCard || !badCard.error || badCard.dayHidden === false) badf.push("bad card " + (badCard && badCard.error));
    if (!goodCard || goodCard.day !== "1" || !goodCard.jpeg) badf.push("good card lost");
    if (badf.length) fail("per-file-decode-error", badf.join("; "));
    else pass("per-file-decode-error", "not_image shows an error; day1 still usable");

    // --- duplicate names stay distinct ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-03-15");
    await pick(page, ["day1.jpg", "day1.jpg"]);
    await waitSettled(page);
    const dup = await inspect(page);
    const dupNames = dup.cards.map((c) => c.outName);
    if (dup.cards.length === 2 && dup.cards.every((c) => c.day === "1") && new Set(dupNames).size === 2) {
      pass("distinct-output-names", dupNames.join(" | "));
    } else fail("distinct-output-names", dupNames.join(" | "));

    // --- more than 4 is visible and processes nothing ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-03-15");
    await pick(page, ["day1.jpg"]);
    await waitSettled(page);
    const beforeLimit = await inspect(page);
    await pick(page, ["day1.jpg", "cross_month.jpg", "year_cross.jpg", "orient6.jpg", "no_exif.jpg"]);
    const limited = await inspect(page);
    await page.screenshot({ path: path.join(OUT, "05-over-limit.png"), fullPage: true });
    const lf = [];
    if (beforeLimit.cards.length !== 1) lf.push("setup");
    if (limited.cards.length !== 0) lf.push("still has " + limited.cards.length + " cards");
    if (!limited.error.includes("你这次选了 5 张")) lf.push("error " + limited.error);
    if (!limited.error.includes("都没有处理")) lf.push("does not say nothing was processed");
    if (lf.length) fail("over-limit", lf.join("; "));
    else pass("over-limit", limited.error);

    // --- reselection drops the previous photo ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-01-28");
    await pick(page, ["day1.jpg"]);
    await waitSettled(page);
    const revokedBefore = await page.evaluate(() => window.__revokeCount);
    await pick(page, ["cross_month.jpg"]);
    await waitSettled(page);
    const re = await inspect(page);
    const revokedAfter = re.revokeCount;
    const rf = [];
    if (re.cards.length !== 1 || re.cards[0].name !== "cross_month.jpg") rf.push("card " + re.cards.map((c) => c.name).join(","));
    if (!re.cards[0] || re.cards[0].day !== "7") rf.push("DAY " + (re.cards[0] && re.cards[0].day));
    if (revokedAfter <= revokedBefore) rf.push("object URL not revoked (" + revokedBefore + " -> " + revokedAfter + ")");
    if (rf.length) fail("reselection", rf.join("; "));
    else pass("reselection", "replaced day1 with cross_month DAY 7 and revoked the old URL");

    // --- start-date change replaces every DAY; slow decode cannot leave the old batch ---
    await gotoFresh(page, origin);
    await page.evaluate(() => { window.__slow = true; });
    await setStart(page, "2024-01-01");
    const earlyStart = "2024-01-01";
    const lateStart = "2024-01-28";
    await page.setInputFiles("#photo", [fixPath("day1.jpg"), fixPath("cross_month.jpg")]);
    await page.fill("#start-date", lateStart);
    const mid = await page.evaluate(() => Array.from(document.querySelectorAll(".day-line")).map((el) => el.hidden));
    await page.evaluate(() => { window.__slow = false; });
    await waitSettled(page);
    const changed = await inspect(page);
    const wantDay1 = String(dayOf("2024-03-15", lateStart));
    const wantCross = String(dayOf("2024-02-03", lateStart));
    const oldDay1 = String(dayOf("2024-03-15", earlyStart));
    const sf = [];
    if (mid.some((hidden) => !hidden)) sf.push("old DAY still visible right after start change");
    const got1 = changed.cards.find((c) => c.name === "day1.jpg");
    const gotC = changed.cards.find((c) => c.name === "cross_month.jpg");
    if (!got1 || got1.day !== wantDay1) sf.push("day1 " + (got1 && got1.day) + " want " + wantDay1);
    if (!gotC || gotC.day !== wantCross) sf.push("cross " + (gotC && gotC.day) + " want " + wantCross);
    if (got1 && got1.day === oldDay1) sf.push("stale day1");
    if (sf.length) fail("start-date-change", sf.join("; "));
    else pass("start-date-change", "days hidden immediately, then DAY " + wantDay1 + " and " + wantCross);

    // --- individual download fallback (real browser download, share mock off) ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-04-20");
    await pick(page, ["orient6.jpg"]);
    await waitSettled(page);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.locator(".save-one").click(),
    ]);
    const dlPath = path.join(OUT, "downloaded-orient6.jpg");
    await download.saveAs(dlPath);
    const suggested = download.suggestedFilename();
    const dlBuf = fs.readFileSync(dlPath);
    if (suggested === "DAY-1-orient6.jpg" && dlBuf[0] === 0xff && dlBuf[1] === 0xd8 && dlBuf.length > 1000) {
      pass("download-one", suggested + " (" + dlBuf.length + " bytes)");
    } else fail("download-one", suggested + " size " + dlBuf.length);

    // --- share-all mock: exact file list, not an OS share sheet ---
    await page.evaluate(() => {
      window.__mockShare = true;
      window.__shareLog = [];
      window.__canShareLog = [];
    });
    await setStart(page, "2024-01-01");
    await pick(page, ["year_cross.jpg", "cross_month.jpg", "no_exif.jpg"]);
    await waitSettled(page);
    await page.locator("#share-all").click();
    const partialShare = await page.evaluate(() => ({
      share: window.__shareLog,
      can: window.__canShareLog,
    }));
    await page.locator("article.card", { hasText: "no_exif.jpg" }).locator(".manual-date").fill("2024-05-01");
    await waitSettled(page);
    await page.evaluate(() => {
      window.__shareLog = [];
      window.__canShareLog = [];
    });
    await page.locator("#share-all").click();
    const fullShare = await page.evaluate(() => ({
      share: window.__shareLog,
      can: window.__canShareLog,
    }));
    const shf = [];
    const partialFiles = partialShare.share[0] || [];
    const partialCan = partialShare.can[0] || [];
    if (partialFiles.length !== 2) shf.push("partial share count " + partialFiles.length);
    if (partialFiles.some((f) => f.name.includes("no_exif"))) shf.push("partial included unfinished");
    if (JSON.stringify(partialFiles.map((f) => f.name)) !== JSON.stringify(partialCan.map((f) => f.name))) {
      shf.push("canShare names differ from share");
    }
    const fullFiles = fullShare.share[0] || [];
    if (fullFiles.length !== 3) shf.push("full share count " + fullFiles.length);
    if (fullFiles.some((f) => f.type !== "image/jpeg" || f.size < 500)) shf.push("file meta " + JSON.stringify(fullFiles));
    if (new Set(fullFiles.map((f) => f.name)).size !== 3) shf.push("share names not distinct");
    if (shf.length) fail("share-all-mock", shf.join("; "));
    else pass("share-all-mock", "mock only: canShare and share received " + fullFiles.map((f) => f.name).join(", "));

    // --- fallback: cannot share files, must not download the batch ---
    await page.evaluate(() => {
      window.__mockShare = false;
      window.__shareLog = [];
      window.__canShareLog = [];
    });
    let downloaded = false;
    const onDownload = () => { downloaded = true; };
    page.on("download", onDownload);
    await page.locator("#share-all").click();
    await page.waitForFunction(() => !document.getElementById("share-fallback").hidden);
    await page.waitForTimeout(400);
    page.off("download", onDownload);
    const fallback = await inspect(page);
    await page.screenshot({ path: path.join(OUT, "06-share-fallback.png"), fullPage: true });
    const shareCalls = await page.evaluate(() => window.__shareLog.length);
    if (!downloaded && shareCalls === 0 && fallback.fallback.includes("不能一次分享多张") && fallback.cards.length === 3) {
      pass("share-fallback", "no batch download; individual cards remain");
    } else {
      fail("share-fallback", "downloaded=" + downloaded + " shareCalls=" + shareCalls + " text=" + fallback.fallback);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    at: new Date().toISOString(),
    originNote: "served docs/ under " + BASE + "/",
    viewport: "390x844",
    chrome: CHROME,
    shareNote: "share-all-mock replaces navigator.canShare and navigator.share in the page. It is not an iOS or Android share sheet.",
    unverified: [
      "Real HEIC/iPhone photos were not used.",
      "Android was not tested.",
      "iPhone share-all / Save Images was not exercised. The mock only checks the file array passed to canShare and share.",
    ],
    results,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const failed = results.filter((r) => !r.ok);
  console.log("\n" + results.filter((r) => r.ok).length + " passed, " + failed.length + " failed");
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
