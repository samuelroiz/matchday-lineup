# Matchday Lineup

A free browser app for **San Fernando Valley Rugby Club**. It turns the squad and a match selection into:

- a **team sheet image** (PNG) at Instagram post size (1080×1350) or story size (1080×1920)
- a **lineup video** (1080×1920, MP4, or WebM where the browser can't record MP4, no audio) that presents the team unit by unit

Everything stays in your browser. Players, photos and matches are saved in the browser's own storage (IndexedDB, or localStorage if IndexedDB isn't available). Nothing is uploaded anywhere. There's no account, no server and no build step.

## Using it each matchday

**Once, at the start of the season: set up the squad (tab 1)**

1. Press **+ Add player**. Enter a name, plus an optional nickname, usual positions, height (ft/in or cm), weight (lb or kg), years at SFV and caps.
2. Add two photos: **Serious** (used on the team sheet, and first in the video) and **Fun** (the video flips to it). Large photos are shrunk to 1200 px before saving.
   - Each photo is **auto-cropped**: the app finds the face and frames it so every player's head is the same size and height. If it can't find a face, it starts from the top-centre.
   - To adjust a crop, **drag the photo** to move it and use the **Zoom** slider (or arrow keys and +/−). **Auto crop** goes back to the face-detected crop. The crop is used everywhere: squad cards, team sheet and video. The full photo is kept, so you can re-crop at any time.
   - **Already have the squad in a spreadsheet?** Press **Import from sheet…** on the Squad tab and pick a `.csv` or `.xlsx` file (from Google Sheets: **File › Download › Comma-separated values (.csv)**). **Download template** gives a sheet with the columns Name, Nickname, Positions, Height, Weight, Years at SFV, Caps. Column names match loosely ("Pos", "player name", "Weight (kg)"...). Positions can list several, separated by commas or slashes, and shirt numbers work too ("10/12", even after the spreadsheet has turned it into a date). Height can be 6'1", 6 ft 1, 6-1, 185 cm or 185; weight 220 lb, 100 kg, or a bare number read in the **Show stats in** units. A preview shows the new players, the players already in the squad that will be updated (matched by name, ignoring case), and any rows with problems and why, before anything is saved. An update only changes the cells filled in the sheet, never photos, crops or the **Show in the video** choices. Afterwards, players still missing a photo are marked in gold with **Needs photos**.
3. Under **Show in the video**, untick any stat a player would rather keep private (for example weight).
4. **Photo style** (Squad tab toolbar) sets the look of every photo when it's drawn: **Off** (as taken), **Auto** (evens out brightness and colour between photos, with a little extra contrast and colour), or **Club grade** (muted colour with a maroon and gold tint). The squad cards change as soon as you pick a style. Stored photos are never changed.
5. Under **Coaches**, press **+ Add coach** for each member of the coaching team: name, role (tap a suggestion such as Head coach or Forwards coach, or type your own) and one photo, with the same auto crop and crop editor. Coaches are listed by role (Head coach, Assistant, Forwards, Backs, then the rest, with roles you typed yourself last), then by name, on the Squad tab, the team sheet and in the video.
6. Press **Back up squad** to save a JSON file of the whole squad, coaches and saved matches, photos included. Keep it somewhere safe. It's your only copy if the browser's data is cleared. **Restore…** loads a backup on any device. It only ever adds: players and matches already on the device are never overwritten. **Start over…** (under the backup buttons) deletes every player, coach and match on this device after one confirm, which offers to back up first.

**Every week**

1. **Match (tab 2):** pick last week's match and press **Copy for next match**. The selection comes across. Set the opponent, date, kick-off (shown on the team sheet next to the date) and venue, and optionally upload the opponent's logo (with no logo, nothing is drawn in its place and the team sheet header and video intro stay centred). Change any shirts that differ. The picker lists players who play that position first. **Auto-pick empty shirts** fills any empty shirt from the players' usual positions (the hardest shirts first, so a lone hooker isn't spent on the bench) and puts the rest of the squad on the bench; shirts already picked stay as they are. Replacements always run from 16 up: pick into any bench shirt and the gaps close. If someone is picked twice, a warning shows which shirts. Under **Captain and coaches**, choose the **Captain** and optionally a **Vice-captain** (one of each, never the same player), and tick the **coaches on duty**. Changes save automatically; the status next to the title shows **✓ Saved on this device**.
2. **Team sheet (tab 3):** choose Post or Story, check the preview, press **Download PNG**. On phones (and other browsers that can share files) a **Share…** button then opens the share sheet with the image, for Instagram or WhatsApp.
3. **Video (tab 4):** press **▶ Preview** to watch it in the page, and adjust **Speed** (about 37–60 s) or **Photo change** (flip or crossfade). Then press **Export video**. Recording runs in real time, so a 55 s video takes about 55 s. Keep the tab open. **Cancel** stops it. When it's done, play it back and press **Download video**, or **Share…** where the browser can share files.

The video runs: intro (logo, SFV vs opponent, date; fully drawn from the first frame, so Instagram uses it as the cover) → front row 1-2-3 → locks 4-5 → back row 6-7-8 → halves 9-10 → centres 12-13 → back three 11-14-15 → bench 16-23 → coaches → full team sheet, held for 3 s. Each player card slides in showing the Serious photo, shirt number, name and position. It then flips to the Fun photo, grows by 10%, shows the stats the player allows, and slides out with its group. Groups of one or two (locks, halves, centres) get taller cards so the stats read on a phone. Bench cards are smaller, so they show only height and weight, in large type. A name that would have to shrink well below the others is shown as initial and surname ("C. RODRIGUEZ") at the normal size, on the team sheet and in the video. The captain and vice-captain carry a gold **C** / **VC** badge in the video and on the team sheet, and the team sheet lists the coaches under the replacements (or in their place when there are none). Empty shirts are skipped, and so is the coaches group when nobody is ticked. On the team sheet, an empty starting shirt shows as TBC and empty replacement spots are left out.

**MP4 vs WebM:** Safari and recent Chrome/Edge (126+) record MP4, which Instagram accepts. Browsers that can only record WebM (some Firefox versions) produce a `.webm`, which you may need to convert before posting.

**Face detection** runs in your browser with Google's MediaPipe BlazeFace model, bundled in `vendor/mediapipe/` (Apache-2.0). Nothing is sent anywhere. The 14 MB engine only downloads the first time you add a photo, and it needs a browser with WebAssembly SIMD (Chrome 91+, Safari 16.4+, Firefox 89+). Without it, photos are cropped top-centre and you can adjust them by hand.

**Club logo:** the app uses `assets/sfv-logo.jpeg`. If that file is missing, a plain "SFV" crest is drawn instead.

## Running it locally

You need [Node.js](https://nodejs.org/) 22 or newer, only to serve the files and run the tests. The app itself has no dependencies.

```sh
npm start            # serves http://127.0.0.1:8080/
```

Any static file server works (for example `python3 -m http.server`). Opening `index.html` straight from disk (`file://`) won't work because browsers block ES modules there.

Add `?clip=5` to the URL to export only the first 5 seconds of the video, which is handy for checking the export quickly. The Video tab then shows the clip's length and a test-mode note.

## Tests

```sh
npm install          # puppeteer, a dev-only dependency; it uses your installed Chrome
npm test             # unit tests, then the headless Chrome suite
```

- `npm run test:unit`: Node tests for data validation (players, coaches, captain rules, crops), unit conversion, auto-pick and bench packing, spreadsheet import (CSV and .xlsx reading, loose headers, every height/weight/position format, the preview plan and update-by-name, using `test/fixtures/sample-squad.csv` and the same sheet saved as `.xlsx` by LibreOffice), backup/restore (against an in-memory store), photo styles, the video timeline, the team sheet layout, and the video and team sheet drawn onto a recording stand-in canvas (stats with both photo changes, layouts without an opponent logo).
- `npm run test:e2e`: drives the real app in headless Chrome. It adds players with photos, picks a match (including the picked-twice warning), copies it, exports post and story PNGs and checks their pixel size, previews the video, cancels an export, then renders a short video and checks its type and that it isn't empty. `photos.test.js` covers face auto crop, the crop editor, photo styles, kick-off and long names. `leaders.test.js` covers coaches, captain badges, the card flip, and backup/restore through the real buttons. `import.test.js` covers the spreadsheet import (template, preview, Cancel, update by name keeping photos, xlsx). `newuser.test.js` covers toast placement, the form and style hints, the save status, auto-pick, bench packing, Share (with a stand-in share sheet) and Start over.

The browser suite uses your installed Google Chrome. Puppeteer's own Chrome download is turned off in `.puppeteerrc.cjs`. On macOS the default path is used automatically. Elsewhere, point to Chrome:

```sh
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
```

**Visual QA** (not part of `npm test`): two scripts drive the real UI in Chrome like a coach would and save screenshots to `qa/` (git-ignored). They use portrait photos named `pexels-*.jpg` from `~/Downloads`, or from the folder in `QA_PHOTOS`.

```sh
npm run qa           # 23 players, 2 coaches, every tab, a full video export (about 2 min) and frames from it
npm run qa:6         # 6 players, 2 coaches (one without a photo), a part-filled match, video preview only,
                     # photo styles, toast placement, card layout before/after frames,
                     # phone-width preview, ?clip mode and a sheet import -> qa/six-players/
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
js/sheet.js         reads CSV and .xlsx (a small built-in reader, no library) into rows
js/squadimport.js   squad import: column matching, height/weight/position parsing, the preview plan (pure)
js/timeline.js      THE VIDEO TEMPLATE: groups, timings, layout, colours, fonts
js/video.js         draws any moment of the timeline; preview player; MediaRecorder export
js/teamsheet.js     team sheet layout (per size) and drawing
js/draw.js          shared canvas helpers
js/images.js        photo resizing and decoding
js/crop.js          crop data: card-shaped crops, auto crop from a face box, drag/zoom (pure)
js/cropeditor.js    photo picker with the drag/zoom crop editor
js/face.js          face detection (MediaPipe, loaded on first use)
js/photostyle.js    Off / Auto / Club grade photo looks (pure, works on pixel arrays)
js/photodraw.js     draws a photo through its crop and the photo style
vendor/mediapipe/   bundled face detection engine and model
js/dialog.js        in-page dialogs and toasts (no alert/confirm/prompt)
scripts/serve.js    tiny static server for local use and tests
scripts/qa/          visual QA scripts (npm run qa, npm run qa:6)
test/unit/          Node tests
test/e2e/           headless Chrome tests
test/fixtures/      a public-domain portrait for the face detection test, and a sample squad sheet (.csv, .xlsx)
```

**Restyling the video:** edit `VIDEO_TEMPLATE` in `js/timeline.js`. The order and grouping of shirts, the coaches group, every timing, card layout (including how much a card grows on the flip and where text sits on each side), colours and fonts are all set there. The renderer only asks the timeline what is on screen at time *t*, so a restyle doesn't mean rewriting the animation code. Team sheet sizes and spacing are set in `TEAM_SHEET_SIZES` in `js/teamsheet.js`.
