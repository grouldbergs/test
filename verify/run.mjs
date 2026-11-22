#!/usr/bin/env node
/**
 * Headless verification of the static page against fixture JPEGs.
 * Serves docs/ at /test/ (GitHub Pages project subpath), drives Chromium,
 * and writes screenshots plus output images under verify/output/.
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

if (!fs.existsSync(path.join(FIX, "day1.jpg"))) {
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

async function debugText(page) {
  return page.locator("#debug-body").innerText();
}

async function readState(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("work");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    function sample(x, y) {
      const d = ctx.getImageData(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)), 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    function countWhite(x, y, cw, ch) {
      const sx = Math.max(0, Math.floor(x));
      const sy = Math.max(0, Math.floor(y));
      const sw = Math.max(1, Math.min(cw, w - sx));
      const sh = Math.max(1, Math.min(ch, h - sy));
      const data = ctx.getImageData(sx, sy, sw, sh).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) n++;
      }
      return { n, area: sw * sh };
    }
    const br = countWhite(w * 0.55, h * 0.75, Math.floor(w * 0.45), Math.floor(h * 0.25));
    const tl = countWhite(0, 0, Math.floor(w * 0.25), Math.floor(h * 0.2));
    const midTop = sample(Math.floor(w / 2), 20);
    const midLeft = sample(20, Math.floor(h / 2));
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    return {
      w, h,
      midTop, midLeft,
      whiteBottomRight: br.n,
      whiteTopLeft: tl.n,
      previewSrc: document.getElementById("preview").getAttribute("src") || "",
      previewHidden: document.getElementById("preview").hidden,
      manualHidden: document.getElementById("manual-wrap").hidden,
      manualText: (document.querySelector("#manual-wrap p") || {}).textContent || "",
      dayHidden: document.getElementById("day-line").hidden,
      dayText: document.getElementById("day-number").textContent,
      exifLineHidden: document.getElementById("exif-date-line").hidden,
      exifDate: document.getElementById("exif-date").textContent,
      errorHidden: document.getElementById("error").hidden,
      errorText: document.getElementById("error").textContent,
      dataUrl,
    };
  });
}

async function saveDataUrl(dataUrl, dest) {
  const b64 = dataUrl.split(",")[1];
  fs.writeFileSync(dest, Buffer.from(b64, "base64"));
}

function isJpeg(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(3);
  fs.readSync(fd, buf, 0, 3, 0);
  fs.closeSync(fd);
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

async function gotoFresh(page, origin) {
  await page.goto(origin + BASE + "/", { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
}

async function setStart(page, iso) {
  await page.fill("#start-date", iso);
}

async function pickFile(page, filename) {
  await page.setInputFiles("#photo", path.join(FIX, filename));
  // wait until debug mentions the file or manual wrap / day line updates
  await page.waitForFunction(() => {
    const t = document.getElementById("debug-body").textContent || "";
    return t.includes("文件：") && !t.includes("（未选择）");
  });
}

async function waitProcessed(page) {
  await page.waitForFunction(() => {
    const preview = document.getElementById("preview");
    const dayHidden = document.getElementById("day-line").hidden;
    return !dayHidden && preview && !preview.hidden && preview.src.startsWith("blob:");
  }, { timeout: 15000 });
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
  return list.filter((r) => {
    if (!r.url.startsWith("http")) return false;
    // Browser-internal traffic is not the page. Photo handling must not
    // issue document/script/image/xhr/fetch requests of its own.
    const pageTypes = new Set(["document", "script", "stylesheet", "image", "xhr", "fetch", "ping", "other", "media", "font"]);
    return pageTypes.has(r.type);
  });
}

async function main() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const net = [];
  page.on("request", (req) => {
    const u = req.url();
    net.push({ url: u, type: req.resourceType(), when: Date.now() });
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
    const subFails = [];
    if (!appJs.some((r) => r.status === 200)) subFails.push("GET " + BASE + "/app.js did not return 200");
    if (foreign.length) subFails.push("unexpected responses: " + foreign.map((r) => r.status + " " + r.url).join(", "));
    const title = await page.title();
    const h1 = await page.locator("h1").innerText();
    const lead = await page.locator(".lead").innerText();
    if (title !== "TinyDays" || h1 !== "TinyDays") subFails.push("title/h1 " + title + " / " + h1);
    if (!lead.includes("原图不会离开这台设备")) subFails.push("lead text changed");
    if (page.url() !== origin + BASE + "/") subFails.push("landed on " + page.url());
    if (subFails.length) fail("pages-subpath", subFails.join("; "));
    else pass("pages-subpath", BASE + "/ loads index and app.js, no foreign responses");

    // --- DAY 1 ---
    net.length = 0;
    await setStart(page, "2024-03-15");
    await pickFile(page, "day1.jpg");
    await waitProcessed(page);
    const httpDuring = pageHttp(net);
    const day1 = await readState(page);
    const dbg1 = await debugText(page);
    const day1Path = path.join(OUT, "output-day1.jpg");
    await saveDataUrl(day1.dataUrl, day1Path);
    await page.screenshot({ path: path.join(OUT, "02-day1.png"), fullPage: true });

    const d1fails = [];
    if (day1.dayText !== "1") d1fails.push("DAY is " + day1.dayText + ", expected 1");
    if (day1.exifDate !== "2024-03-15") d1fails.push("exif date " + day1.exifDate);
    if (!dbg1.includes("拍摄日期来源：EXIF DateTimeOriginal")) d1fails.push("source not EXIF DateTimeOriginal\n" + dbg1);
    if (!dbg1.includes("未用作拍摄日期")) d1fails.push("mtime disclaimer missing");
    if (day1.whiteBottomRight < 30) d1fails.push("too few white pixels in bottom-right: " + day1.whiteBottomRight);
    if (!day1.previewSrc.startsWith("blob:")) d1fails.push("preview is not a blob URL");
    if (!isJpeg(day1Path)) d1fails.push("canvas export is not a JPEG");
    if (httpDuring.length) d1fails.push("network requests while processing: " + httpDuring.map((r) => r.type + " " + r.url).join(", "));
    if (d1fails.length) fail("day1", d1fails.join("; "));
    else pass("day1", "DAY 1, EXIF DateTimeOriginal, watermark pixels=" + day1.whiteBottomRight + ", jpeg, no HTTP while processing");

    // persist start date
    await page.reload({ waitUntil: "load" });
    const persisted = await page.inputValue("#start-date");
    if (persisted === "2024-03-15") pass("localStorage start date", persisted);
    else fail("localStorage start date", "got " + persisted);

    // --- cross month ---
    await gotoFresh(page, origin);
    net.length = 0;
    await setStart(page, "2024-01-28");
    await pickFile(page, "cross_month.jpg");
    await waitProcessed(page);
    const cross = await readState(page);
    const dbgCross = await debugText(page);
    await saveDataUrl(cross.dataUrl, path.join(OUT, "output-cross-month.jpg"));
    await page.screenshot({ path: path.join(OUT, "03-cross-month.png"), fullPage: true });
    const cf = [];
    if (cross.dayText !== "7") cf.push("DAY is " + cross.dayText + ", expected 7");
    if (cross.exifDate !== "2024-02-03") cf.push("exif date " + cross.exifDate);
    if (pageHttp(net).length) cf.push("HTTP during processing");
    if (cf.length) fail("cross-month", cf.join("; ") + "\n" + dbgCross);
    else pass("cross-month", "start 2024-01-28, shoot 2024-02-03, DAY 7");

    // --- year cross ---
    await gotoFresh(page, origin);
    await setStart(page, "2023-12-31");
    await pickFile(page, "year_cross.jpg");
    await waitProcessed(page);
    const yc = await readState(page);
    await saveDataUrl(yc.dataUrl, path.join(OUT, "output-year-cross.jpg"));
    if (yc.dayText === "2" && yc.exifDate === "2024-01-01") pass("year-cross", "DAY 2");
    else fail("year-cross", "DAY=" + yc.dayText + " date=" + yc.exifDate);

    // --- CreateDate fallback ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-06-01");
    await pickFile(page, "createdate_only.jpg");
    await waitProcessed(page);
    const cd = await readState(page);
    const dbgCd = await debugText(page);
    await saveDataUrl(cd.dataUrl, path.join(OUT, "output-createdate.jpg"));
    const cdf = [];
    if (cd.dayText !== "10") cdf.push("DAY is " + cd.dayText + ", expected 10");
    if (!dbgCd.includes("拍摄日期来源：EXIF CreateDate")) cdf.push("source not CreateDate\n" + dbgCd);
    if (cdf.length) fail("createdate-fallback", cdf.join("; "));
    else pass("createdate-fallback", "DAY 10 from CreateDate");

    // --- IFD0 DateTime only: must go to manual, not silently used ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-01-01");
    await pickFile(page, "ifd0_datetime_only.jpg");
    await page.waitForFunction(() => !document.getElementById("manual-wrap").hidden);
    const ifd0 = await readState(page);
    const dbgIfd0 = await debugText(page);
    await page.screenshot({ path: path.join(OUT, "04-ifd0-datetime-manual.png"), fullPage: true });
    const i0f = [];
    if (ifd0.manualHidden) i0f.push("manual wrap should be visible");
    if (!ifd0.manualText.includes("没有读到拍摄日期")) i0f.push("manual prompt text missing");
    if (!ifd0.dayHidden) i0f.push("DAY should not be computed yet, got " + ifd0.dayText);
    if (!ifd0.previewHidden) i0f.push("preview should be hidden until manual date");
    if (!dbgIfd0.includes("拍摄日期来源：manual")) i0f.push("source should be manual");
    if (dbgIfd0.includes("2020-01-01") && dbgIfd0.includes("拍摄日期：2020-01-01")) {
      i0f.push("silently used IFD0 DateTime as shoot date");
    }
    if (i0f.length) fail("ifd0-datetime-not-used", i0f.join("; ") + "\n" + dbgIfd0);
    else pass("ifd0-datetime-not-used", "fell through to manual date path");

    // --- no EXIF + manual date ---
    await gotoFresh(page, origin);
    net.length = 0;
    await setStart(page, "2024-05-01");
    await pickFile(page, "no_exif.jpg");
    await page.waitForFunction(() => !document.getElementById("manual-wrap").hidden);
    const beforeManual = await readState(page);
    const dbgNo = await debugText(page);
    await page.screenshot({ path: path.join(OUT, "05-no-exif-manual-prompt.png"), fullPage: true });
    const nf = [];
    if (beforeManual.manualHidden) nf.push("manual wrap hidden");
    if (!beforeManual.manualText.includes("没有读到拍摄日期，请手动选择。")) nf.push("manual prompt not shown");
    if (!beforeManual.dayHidden) nf.push("DAY shown before manual date");
    if (!dbgNo.includes("EXIF DateTimeOriginal：（无）")) nf.push("should report no DateTimeOriginal");
    if (dbgNo.includes("拍摄日期来源：file.lastModified") || /拍摄日期来源：.*lastModified/.test(dbgNo)) {
      nf.push("used lastModified as shoot date");
    }
    if (!dbgNo.includes("未用作拍摄日期")) nf.push("mtime should be labeled unused");
    await page.fill("#shoot-date-manual", "2024-05-01");
    await waitProcessed(page);
    const afterManual = await readState(page);
    const dbgMan = await debugText(page);
    const manualPath = path.join(OUT, "output-manual-day1.jpg");
    await saveDataUrl(afterManual.dataUrl, manualPath);
    await page.screenshot({ path: path.join(OUT, "06-no-exif-after-manual.png"), fullPage: true });
    if (afterManual.dayText !== "1") nf.push("manual DAY is " + afterManual.dayText + ", expected 1");
    if (!dbgMan.includes("拍摄日期来源：manual")) nf.push("source not manual after fill");
    if (pageHttp(net).length) nf.push("HTTP during no-exif processing: " + pageHttp(net).map((r) => r.url).join(", "));
    if (afterManual.whiteBottomRight < 20) nf.push("no watermark after manual path: " + afterManual.whiteBottomRight);
    if (!isJpeg(manualPath)) nf.push("manual export is not a JPEG");
    if (nf.length) fail("no-exif-manual", nf.join("; ") + "\n" + dbgMan);
    else pass("no-exif-manual", "prompted, then DAY 1 from manual date, watermark ok, no HTTP");

    // --- orientation 6 ---
    await gotoFresh(page, origin);
    await setStart(page, "2024-04-20");
    await pickFile(page, "orient6.jpg");
    await waitProcessed(page);
    const o6 = await readState(page);
    const o6Path = path.join(OUT, "output-orient6.jpg");
    await saveDataUrl(o6.dataUrl, o6Path);
    await page.screenshot({ path: path.join(OUT, "07-orient6.png"), fullPage: true });
    const of = [];
    if (o6.w !== 400 || o6.h !== 600) of.push("size " + o6.w + "x" + o6.h + ", expected 400x600 (orientation applied)");
    const [r, g, b] = o6.midTop;
    if (!(r > 150 && r > g * 1.5 && r > b * 1.5)) {
      of.push("top-center not red after orientation, rgb=" + o6.midTop.join(","));
    }
    if (o6.whiteBottomRight < 20) of.push("watermark missing at visual bottom-right: " + o6.whiteBottomRight);
    if (o6.dayText !== "1") of.push("DAY " + o6.dayText);
    if (!isJpeg(o6Path)) of.push("oriented export is not a JPEG");
    if (of.length) fail("orientation-6", of.join("; "));
    else pass("orientation-6", "400x600, red on top, watermark bottom-right, jpeg");

    // --- save / download ---
    const shareProbe = await page.evaluate(() => {
      let canShare = false;
      let shareError = "";
      try {
        const f = new File([new Blob(["x"], { type: "image/jpeg" })], "x.jpg", { type: "image/jpeg" });
        canShare = !!(navigator.canShare && navigator.canShare({ files: [f] }));
      } catch (e) {
        shareError = String(e && e.message ? e.message : e);
      }
      return { hasShare: typeof navigator.share === "function", canShare, shareError };
    });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.click("#save"),
    ]);
    const dlPath = path.join(OUT, "downloaded-orient6.jpg");
    await download.saveAs(dlPath);
    const suggested = download.suggestedFilename();
    if (suggested === "DAY-1.jpg" && fs.statSync(dlPath).size > 1000 && isJpeg(dlPath)) {
      pass("download fallback", "saved " + suggested + " (" + fs.statSync(dlPath).size + " bytes, jpeg). share available=" + shareProbe.hasShare + " canShareFiles=" + shareProbe.canShare);
    } else {
      fail("download fallback", "name=" + suggested + " size=" + (fs.existsSync(dlPath) ? fs.statSync(dlPath).size : 0));
    }

    await page.screenshot({ path: path.join(OUT, "08-final.png"), fullPage: true });
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    at: new Date().toISOString(),
    originNote: "served docs/ under " + BASE + "/",
    viewport: "390x844",
    chrome: CHROME,
    unverified: [
      "Real HEIC/iPhone photos were not used.",
      "iPhone and Android share-sheet / save-to-photos was not exercised; this run checks the download fallback in headless Chrome.",
    ],
    results,
    outputDir: OUT,
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
