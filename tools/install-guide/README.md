# Desktop installation video

The checked-in deliverable is `assets/media/install-guide/eltes-desktop-install.mp4`:
10 minutes, 1280×720, 10 fps, H.264/yuv420p and AAC, with fast-start metadata,
embedded English subtitles and ten chapter markers. Companion WebVTT tracks,
poster, transcript and provenance are in the same directory. `docs.html#install-video`
adds native controls, accessible chapter buttons, an inline transcript and official
download links. `index.html#installation-video` places the same video near the
top of the home page, before the model showcase. No external player, analytics, autoplay or eager MP4 download.

## Scope and evidence

- Desktop release **v3.18.0**, checked **2026-10-25**:
  <https://github.com/gefrus112/eltes/releases/tag/v3.18.0>.
  `gh release view v3.18.0 --json assets,url,body` provides the asset evidence.
  The source checkout is newer; the video does not promise newer features in
  those installers. Native installer binaries were not executed for this guide.
- **Real released browser UI**, not screenshots of an installed native app.
  `capture.cjs` serves an extracted release locally, blocks external requests,
  selects CAI and captures its real `17 * 24 = 408` response. Chapter 8 includes
  a short typing/response recording; other UI views are genuine still captures.
- Windows/macOS/Linux instructions are **labeled illustrations**, not simulated
  installer recordings. The guide includes the unsigned-artifact limitation and
  does not recommend disabling OS protections.
- AI narration uses the voice selected by the user. Original audio and capture
  intermediates stay outside Git. `guide.json` contains the approved script and
  30 visual steps. Captions use approximate sentence timing, not word alignment.
- No credentials, paid provider requests or hosted-model reply fixtures.

## Rebuild

Keep `GUIDE_WORK` outside the checkout. The published MP4 is self-contained;
playing it does not require these authoring dependencies. A full re-render needs
original narration clips (`audio/00.wav` through `09.wav`, PCM WAV) and captures.
Do not silently substitute another narrator. The original MP3/WAV recordings are
retained in the session's external authoring workspace, not committed to Git.

1. Extract the release **without switching the working branch**:
   `git archive v3.18.0 | tar -x -C "$RELEASE_SITE"` (create that directory first).
2. Install `playwright-core` and `@sparticuz/chromium` outside the checkout.
   Set `BROWSER_MODULES` to their `node_modules` directory and `RELEASE_SITE` to
   the extracted release, then run `node tools/install-guide/capture.cjs`.
   Chromium's platform libraries must also be available.
3. Install `Pillow==13.0.0` and `imageio-ffmpeg==0.6.0` in a separate environment.
   Supply DejaVu Sans / Sans Mono fonts via `GUIDE_FONT_DIR` if not installed at
   `/usr/share/fonts/truetype/dejavu`.
4. With `GUIDE_WORK` set, run `python3 tools/install-guide/build.py`.
   Each chapter lasts exactly 60 seconds. Clips longer than 58 seconds are
   slightly accelerated (the original render's maximum was 1.081×); shorter
   ones have an end pause. Generated motion frames must remain PNG like the
   slide frames: mixing image codecs in one concat playlist can silently lose
   frames. FFmpeg uses `-xerror` to fail on decode errors.
5. Keep the inline transcript/chapter labels in `docs.html` in sync with
   `guide.json` if the script changes. Rebuild the optional launcher ZIP with
   `npm run downloads:build` after updating media or docs.

## Validate

```sh
node --test test/install-guide.test.cjs test/desktop.test.cjs
node tools/check-links.mjs
# Start the local server, with shell execution disabled:
HOST=0.0.0.0 ELTES_ENABLE_SHELL=0 ELTES_STUDIO_SHELL=0 npm start
# In a separate terminal; dependencies can live outside this repository:
ELTES_BROWSER_MODULES=/path/to/node_modules node tools/check-browser-install-guide.cjs
```

The optional browser test checks actual H.264/AAC playback, 600-second duration,
caption cues, chapter cues, initial lazy loading, paused/playing/keyboard seeks,
mobile layout, missing-video fallback and the no-JavaScript transcript.
`ELTES_TEST_URL` overrides `http://127.0.0.1:4173`.

For media integrity, decode the entire output with FFmpeg (`-xerror -i VIDEO
-map 0:v:0 -map 0:a:0 -f null - -stats`): expect **6,000 frames and 10:00.00**.
Inspect frames at each platform and the first-conversation chapter. Tests do not
replace native Windows/macOS/Linux installer testing or a human caption review.

## Hosting and packaging

The local/desktop server serves MP4 with single-byte-range support and captions
as `text/vtt`. Desktop staging and the optional Windows ZIP include the media
and `tools/media-response.mjs`. GitHub Pages already copies all of `assets/`.
The storage-mirror publisher also has MP4/VTT MIME mappings; changing its source
does not deploy that Edge Function or publish the site automatically.
