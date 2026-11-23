# test

Static mobile page that stamps a DAY watermark on a photo in the browser. The interface is Chinese. Photos, EXIF reading, the DAY calculation, and watermark drawing stay on the device.

## GitHub Pages

Publish the `docs/` directory as a project site (subpath `/test/`):

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/docs`

`docs/index.html` loads `app.js?v=<hash>` with a relative URL, so it resolves under `https://grouldbergs.github.io/test/`. The hash is the start of the SHA-256 of `app.js` and changes when that file changes, so a new page does not keep running a previously cached script. The “最多 N 张” label is written by the loaded script from the same limit that rejects extra photos; the HTML does not hardcode a number. GitHub Pages sends `Cache-Control: max-age=600`. `docs/.nojekyll` publishes the files as-is, without Jekyll.

## Behavior

- The start date is saved in `localStorage` on this device.
- DAY = (photo calendar date − start calendar date) + 1.
- The shoot date is EXIF DateTimeOriginal, then EXIF CreateDate.
- If those are missing, the page asks for a date. It does not substitute the file modification time.
- Up to 20 photos can be selected. Choosing more than 20 shows an error and processes none of them.
- Each photo uses the shared start date and its own shoot date. A photo with no EXIF date asks for a date without clearing the others.
- The result is a JPEG named `DAY-<n>-<original>.jpg`. Per photo, save uses the system share sheet when the browser can share that file, otherwise it downloads that one file.
- 分享全部 calls `navigator.canShare({ files })` and `navigator.share({ files })` from the button tap. If the browser cannot share the files, the page does not download them all; use each photo's button or a long-press instead. This does not write the batch into Photos by itself.

The automated check uses small synthetic JPEGs in desktop Chrome. It does not show whether Safari can decode, preview, or share 20 full-resolution iPhone photos; that is still a phone stress test. It also does not cover real HEIC photos or Android.

## Verify locally

Synthetic JPEGs only. From the repository root:

```bash
python3 -m pip install -r verify/requirements.txt   # only to regenerate fixtures
python3 verify/generate_fixtures.py                 # skip when verify/fixtures is already present
npm install --prefix verify
node verify/run.mjs
```

The runner serves `docs/` at `http://127.0.0.1:<port>/test/` and writes screenshots to `verify/output/`. That directory is not part of the Pages site. Chrome is `/usr/bin/google-chrome-stable` unless `CHROME_PATH` is set.
