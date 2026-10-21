# Matchday Lineup

A free browser app for **San Fernando Valley Rugby Club**. It turns the squad and a match selection into:

- a **team sheet image** (PNG) at Instagram post size (1080×1350) or story size (1080×1920)
- a **lineup video** (1080×1920, MP4, or WebM where the browser can't record MP4, no audio) that presents the team unit by unit

Everything stays in your browser. Players, photos and matches are saved in the browser's own storage (IndexedDB, or localStorage if IndexedDB isn't available). Nothing is uploaded anywhere. There's no account, no server and no build step.

## Using it each matchday

**Once, at the start of the season: set up the squad (tab 1)**

1. Press **+ Add player**. Enter a name, plus an optional nickname, usual positions, height (ft/in or cm), weight (lb or kg), years at SFV and caps.
2. Add two photos: **Serious** (used on the team sheet, and first in the video) and **Fun** (the video flips to it). Large photos are shrunk to 1200 px before saving.
3. Under **Show in the video**, untick any stat a player would rather keep private (for example weight).
4. Press **Back up squad** to save a JSON file of the whole squad, photos included. Keep it somewhere safe. It's your only copy if the browser's data is cleared. **Restore…** loads a backup on any device. It only ever adds: players and matches already on the device are never overwritten.

**Every week**

1. **Match (tab 2):** pick last week's match and press **Copy for next match**. The selection comes across. Set the opponent, date, kick-off and venue, and optionally upload the opponent's logo. Change any shirts that differ. The picker lists players who play that position first. If someone is picked twice, a warning shows which shirts. Changes save automatically.
2. **Team sheet (tab 3):** choose Post or Story, check the preview, press **Download PNG**.
3. **Video (tab 4):** press **▶ Preview** to watch it in the page, and adjust **Speed** (about 37–60 s) or **Photo change** (flip or crossfade). Then press **Export video**. Recording runs in real time, so a 55 s video takes about 55 s. Keep the tab open. **Cancel** stops it. When it's done, play it back and press **Download video**.

The video runs: intro (logo, SFV vs opponent, date) → front row 1-2-3 → locks 4-5 → back row 6-7-8 → halves 9-10 → centres 12-13 → back three 11-14-15 → bench 16-23 → full team sheet, held for 3 s. Empty shirts are skipped.

**MP4 vs WebM:** Safari and recent Chrome/Edge (126+) record MP4, which Instagram accepts. Browsers that can only record WebM (some Firefox versions) produce a `.webm`, which you may need to convert before posting.

**Club logo:** the app uses `assets/sfv-logo.jpeg`. If that file is missing, a plain "SFV" crest is drawn instead.

## Running it locally

You need [Node.js](https://nodejs.org/) 22 or newer, only to serve the files and run the tests. The app itself has no dependencies.

```sh
npm start            # serves http://127.0.0.1:8080/
```

Any static file server works (for example `python3 -m http.server`). Opening `index.html` straight from disk (`file://`) won't work because browsers block ES modules there.

Add `?clip=5` to the URL to export only the first 5 seconds of the video, which is handy for checking the export quickly.

## Tests

```sh
npm install          # puppeteer, a dev-only dependency; it uses your installed Chrome
npm test             # unit tests, then the headless Chrome suite
```

- `npm run test:unit`: Node tests for data validation, unit conversion, backup/restore (against an in-memory store), the video timeline and the team sheet layout.
- `npm run test:e2e`: drives the real app in headless Chrome. It adds players with photos, picks a match (including the picked-twice warning), copies it, exports post and story PNGs and checks their pixel size, previews the video, cancels an export, then renders a short video and checks its type and that it isn't empty.

The browser suite uses your installed Google Chrome. Puppeteer's own Chrome download is turned off in `.puppeteerrc.cjs`. On macOS the default path is used automatically. Elsewhere, point to Chrome:

```sh
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
```

## Deploying on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
3. After a minute the app is live at `https://<user-or-org>.github.io/<repo>/`.

All paths are relative, so it works from a project subfolder. There's nothing to build. Each site address has its own browser storage, so a squad saved on `127.0.0.1` won't appear on the GitHub Pages address. Use **Back up squad** / **Restore…** to move it.

## How it's put together

```
index.html          page layout and the player form template
css/app.css         styles (maroon #7a1f2b, gold #f2b705)
js/app.js           UI wiring for the four tabs
js/model.js         players, matches, validation, unit conversion (pure, no DOM)
js/storage.js       one store interface: IndexedDB, localStorage fallback, in-memory
js/backup.js        backup file and additive restore
js/timeline.js      THE VIDEO TEMPLATE: groups, timings, layout, colours, fonts
js/video.js         draws any moment of the timeline; preview player; MediaRecorder export
js/teamsheet.js     team sheet layout (per size) and drawing
js/draw.js          shared canvas helpers
js/images.js        photo resizing and decoding
js/dialog.js        in-page dialogs and toasts (no alert/confirm/prompt)
scripts/serve.js    tiny static server for local use and tests
test/unit/          Node tests
test/e2e/           headless Chrome tests
```

**Restyling the video:** edit `VIDEO_TEMPLATE` in `js/timeline.js`. The order and grouping of shirts, every timing, card layout, colours and fonts are all set there. The renderer only asks the timeline what is on screen at time *t*, so a restyle doesn't mean rewriting the animation code. Team sheet sizes and spacing are set in `TEAM_SHEET_SIZES` in `js/teamsheet.js`.
