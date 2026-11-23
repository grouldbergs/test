# test

Static mobile page that stamps a DAY watermark on a photo in the browser. The interface is Chinese. Photos, EXIF reading, the DAY calculation, and watermark drawing stay on the device.

## GitHub Pages

Publish the `docs/` directory as a project site (subpath `/test/`):

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/docs`

`docs/index.html` loads `app.js` with a relative URL, so it resolves at `https://grouldbergs.github.io/test/`. `docs/.nojekyll` publishes the files as-is, without Jekyll.

## Behavior

- The start date is saved in `localStorage` on this device.
- DAY = (photo calendar date − start calendar date) + 1.
- The shoot date is EXIF DateTimeOriginal, then EXIF CreateDate.
- If those are missing, the page asks for a date. It does not substitute the file modification time.
- Up to 4 photos can be selected. Choosing more than 4 shows an error and processes none of them.
- Each photo uses the shared start date and its own shoot date. A photo with no EXIF date asks for a date without clearing the others.
- The result is a JPEG named `DAY-<n>-<original>.jpg`. Per photo, save uses the system share sheet when the browser can share that file, otherwise it downloads that one file.
- 分享全部 calls `navigator.canShare({ files })` and `navigator.share({ files })` from the button tap. If the browser cannot share the files, the page does not download them all; use each photo's button or a long-press instead. This does not write the batch into Photos by itself.

The automated check does not cover real HEIC photos, Android, or whether an iPhone share sheet can save every image in one step.

## Verify locally

Synthetic JPEGs only. From the repository root:

```bash
python3 -m pip install -r verify/requirements.txt   # only to regenerate fixtures
python3 verify/generate_fixtures.py                 # skip when verify/fixtures is already present
npm install --prefix verify
node verify/run.mjs
```

The runner serves `docs/` at `http://127.0.0.1:<port>/test/` and writes screenshots to `verify/output/`. That directory is not part of the Pages site. Chrome is `/usr/bin/google-chrome-stable` unless `CHROME_PATH` is set.
