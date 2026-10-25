#!/usr/bin/env python3
"""Build the 10-minute tutorial from genuine UI captures + registered-voice clips.

Requires Pillow, imageio-ffmpeg, GUIDE_WORK (audio/ and captures/) outside Git.
No synthetic OS screenshots are created: platform steps are labeled illustrations.
The checked-in guide.json is the source of narration and on-screen instructions.
"""
import json, math, os, re, subprocess, textwrap, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(os.environ['GUIDE_WORK'])
OUT = ROOT / 'assets/media/install-guide'
OUT.mkdir(parents=True, exist_ok=True)
TMP = WORK / 'render'
TMP.mkdir(exist_ok=True)
GUIDE = json.loads((Path(__file__).parent / 'guide.json').read_text())
FF = imageio_ffmpeg.get_ffmpeg_exe()
FONT_DIR = Path(os.environ.get('GUIDE_FONT_DIR', '/usr/share/fonts/truetype/dejavu'))
GREEN = '#70e0b6'
PALETTES = [GREEN, GREEN, '#99c8ff', '#99c8ff', '#c7b6f4', '#c7b6f4', '#f2cf8e', '#f2cf8e', GREEN, GREEN]

def font(size, bold=False, mono=False):
    name = 'DejaVuSansMono' if mono else 'DejaVuSans'
    return ImageFont.truetype(str(FONT_DIR / (name + ('-Bold' if bold else '') + '.ttf')), size)

def wrapped(draw, text, x, y, width, size=26, fill='#d3d7de', bold=False, mono=False, spacing=10):
    f = font(size, bold, mono)
    words = text.split(); lines = []; current = ''
    for word in words:
        trial = (current + ' ' + word).strip()
        if draw.textlength(trial, font=f) > width and current:
            lines.append(current); current = word
        else:
            current = trial
    if current: lines.append(current)
    for line in lines:
        # Long filenames are reduced to fit rather than silently clipped.
        actual = f
        while draw.textlength(line, font=actual) > width and actual.size > 14:
            actual = font(actual.size - 1, bold, mono)
        draw.text((x, y), line, font=actual, fill=fill)
        y += size + spacing
    return y

def image_for(index, step, capture_override=None):
    chapter = GUIDE['chapters'][index]; accent = PALETTES[index]
    im = Image.new('RGB', (1280, 720), '#080b10'); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 1279, 7), fill=accent)
    logo = Image.open(ROOT / 'assets/img/icon-128.png').convert('RGBA').resize((40, 40), Image.Resampling.LANCZOS)
    im.paste(logo, (44, 30), logo)
    d.text((98, 38), 'ELTES  /  DESKTOP GUIDE', font=font(19, True), fill='#e8edf2')
    d.text((884, 40), 'v3.18.0  •  verified 2026-10-25', font=font(16), fill='#aeb8c5')
    d.line((48, 93, 1232, 93), fill='#26303d', width=1)
    d.text((48, 113), f'{index + 1:02d}  {chapter["title"]}', font=font(38, True), fill='#f3f6fa')
    d.text((49, 165), f'{index:02d}:00–{index + 1:02d}:00   /   STEP {step + 1} OF 3', font=font(16, mono=True), fill=accent)
    rows = chapter['steps']; row = rows[step]
    capture = chapter.get('capture')
    if index == 8: capture = ['conversation', 'keys', 'models'][step]
    if index == 9: capture = ['settings', 'settings', 'home'][step]
    if capture:
        y = wrapped(d, row[0], 48, 230, 350, 31, '#f4f6f9', True)
        y = wrapped(d, row[1], 48, y + 22, 350, 25, accent)
        wrapped(d, row[2], 48, y + 20, 350, 21)
        source = Image.open(capture_override or WORK / 'captures' / f'{capture}.png').convert('RGB')
        if index == 8 and step == 0 and capture_override is None:
            source = source.crop((345, 70, 1195, 355))
        d.rounded_rectangle((442, 213, 1232, 620), radius=12, fill='#030406', outline='#344050', width=2)
        source.thumbnail((766, 383), Image.Resampling.LANCZOS)
        im.paste(source, (454 + (766 - source.width) // 2, 225 + (383 - source.height) // 2))
        d.text((454, 631), 'REAL RELEASED WEB INTERFACE • NOT A NATIVE INSTALLER', font=font(14), fill='#b4bdc9')
    else:
        d.rounded_rectangle((48, 218, 1232, 465), radius=16, fill='#101722', outline='#2d3a4d', width=2)
        y = wrapped(d, row[0], 76, 243, 1128, 34, '#f5f7fa', True)
        y = wrapped(d, row[1], 76, y + 22, 1128, 28, accent, mono=(index in [2, 3, 4, 6, 7]))
        wrapped(d, row[2], 76, y + 17, 1128, 23)
        for j, item in enumerate(rows):
            x = 48 + j * 400
            d.rounded_rectangle((x, 492, x + 384, 603), radius=10, fill='#172332' if j == step else '#0c111a', outline=accent if j == step else '#29313d', width=2)
            d.text((x + 16, 506), f'0{j + 1}', font=font(18, True), fill=accent if j == step else '#778391')
            wrapped(d, item[0], x + 58, 508, 303, 20, '#e6eaf0' if j == step else '#a8b0bc', spacing=6)
        d.text((49, 629), 'ILLUSTRATED WALKTHROUGH • OS INSTALLER EXECUTION IS NOT RECORDED', font=font(15), fill='#c1c8d1')
    for j in range(10):
        x = 48 + j * 120
        d.rectangle((x, 681, x + 109, 685), fill=accent if j <= index else '#28313c')
    d.text((48, 699), 'AI narration  ·  no credentials shown  ·  release links and transcript in the docs', font=font(12), fill='#99a5b4')
    return im

def timestamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}'

def caption_chunks(text):
    # Keep sentence tails readable instead of flashing a lone word on screen.
    # Timing is still approximate, proportional to the final cue text lengths.
    chunks = []
    for sentence in re.split(r'(?<=[.!?])\s+', text):
        parts = textwrap.wrap(sentence, width=110, break_long_words=False, break_on_hyphens=False)
        if len(parts) > 1 and len(parts[-1]) < 35:
            words = (parts[-2] + ' ' + parts[-1]).split()
            # Rebalance the last two cues, retaining the exact word order.
            split = min(range(1, len(words)), key=lambda i: abs(len(' '.join(words[:i])) - len(' '.join(words[i:]))))
            parts[-2:] = [' '.join(words[:split]), ' '.join(words[split:])]
        chunks.extend(parts)
    return chunks

def run(args, log):
    with open(log, 'w') as output:
        subprocess.run([FF, '-hide_banner', '-xerror', '-y', *args], check=True, stdout=output, stderr=subprocess.STDOUT)

caps = ['WEBVTT', '']
chapters_vtt = ['WEBVTT', '']
meta = [';FFMETADATA1', 'title=Eltes desktop installation guide', 'comment=Illustrated installation walkthrough; real released web-interface captures; AI narration. Verified 2026-10-25 against desktop v3.18.0.']
transcript = [GUIDE['title'], '', GUIDE['disclosure'], '', f"Downloads verified on {GUIDE['verifiedOn']}: {GUIDE['releaseUrl']}", '']
processed = []
for i, chapter in enumerate(GUIDE['chapters']):
    wav = WORK / 'audio' / f'{i:02d}.wav'
    if not wav.exists(): run(['-i', str(WORK / 'audio' / f'{i:02d}.mp3'), '-ar', '24000', '-ac', '1', str(wav)], TMP / f'decode-{i}.log')
    with wave.open(str(wav)) as audio: duration = audio.getnframes() / audio.getframerate()
    target = min(duration, 58.0)
    tempo = duration / target
    processed.append({'chapter': i, 'originalSeconds': duration, 'spokenSeconds': target, 'tempo': tempo})
    playlist = []
    for step in range(3):
        img = TMP / f'slide-{i:02d}-{step}.png'
        image_for(i, step).save(img)
        if i == 8 and step == 0:
            timing = json.loads((WORK / 'captures/motion/timing.json').read_text())
            for n, entry in enumerate(timing):
                frame = TMP / f'motion-{n:04d}.png'
                image_for(i, step, WORK / 'captures/motion' / entry['file']).save(frame)
                next_time = timing[n + 1]['seconds'] if n + 1 < len(timing) else entry['seconds'] + .2
                playlist += [f"file '{frame}'", f"duration {max(.04, next_time - entry['seconds']):.4f}"]
            elapsed = timing[-1]['seconds'] + .2 - timing[0]['seconds']
            playlist += [f"file '{img}'", f'duration {20 - elapsed:.4f}']
        else:
            playlist += [f"file '{img}'", 'duration 20']
    playlist += [f"file '{img}'"]
    manifest = TMP / f'chapter-{i:02d}.ffconcat'; manifest.write_text('\n'.join(playlist))
    output = TMP / f'chapter-{i:02d}.mp4'
    run(['-f', 'concat', '-safe', '0', '-i', str(manifest), '-i', str(wav),
         '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=10,format=yuv420p',
         '-af', f'atempo={tempo:.8f},apad,atrim=duration=60', '-t', '60',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-threads', '2',
         '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-movflags', '+faststart', str(output)], TMP / f'encode-{i}.log')
    chunks = caption_chunks(chapter['narration']); total = sum(len(chunk) for chunk in chunks); at = i * 60.0
    for chunk in chunks:
        end = at + target * len(chunk) / total
        caps += [f'{timestamp(at)} --> {timestamp(end)}', '\n'.join(textwrap.wrap(chunk, width=60)), '']; at = end
    if target < 58.5:
        caps += [f'{timestamp(at)} --> {timestamp(i * 60 + 59.8)}', 'Pause the video whenever you need time to follow a step.', '']
    chapters_vtt += [f'{timestamp(i * 60)} --> {timestamp((i + 1) * 60)}', chapter['title'], '']
    transcript += [f'{i:02d}:00 — {chapter["title"]}', chapter['narration'], '']
    meta += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={i * 60000}', f'END={(i + 1) * 60000}', 'title=' + chapter['title']]
    print(f'Encoded chapter {i + 1}/10; narration {duration:.2f}s, tempo {tempo:.3f}', flush=True)

(OUT / 'captions.en.vtt').write_text('\n'.join(caps))
(OUT / 'chapters.en.vtt').write_text('\n'.join(chapters_vtt))
(OUT / 'transcript.txt').write_text('\n'.join(transcript))
(TMP / 'chapters.txt').write_text('\n'.join(meta))
(TMP / 'all.ffconcat').write_text('\n'.join(f"file '{TMP / f'chapter-{i:02d}.mp4'}'\nduration 60.000000" for i in range(10)))
# Preserve zero-based video PTS instead of shifting it for AAC priming.
run(['-copyts', '-f', 'concat', '-safe', '0', '-i', str(TMP / 'all.ffconcat'), '-i', str(OUT / 'captions.en.vtt'), '-i', str(TMP / 'chapters.txt'),
     '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0', '-map_metadata', '2', '-map_chapters', '2',
     '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-af', 'aresample=async=1:first_pts=0,apad,atrim=duration=600', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
     '-movflags', '+faststart', '-t', '600', str(OUT / 'eltes-desktop-install.mp4')], TMP / 'mux.log')
image_for(0, 0).save(OUT / 'poster.jpg', quality=90)
provenance = json.loads((WORK / 'captures/provenance.json').read_text())
provenance.update({'disclosure': GUIDE['disclosure'], 'verifiedOn': GUIDE['verifiedOn'], 'releaseUrl': GUIDE['releaseUrl'],
                   'durationSeconds': 600, 'audio': 'AI-generated narration; user-selected voice',
                   'captionTiming': 'Approximate sentence timing proportional to spoken text; full transcript included', 'chapters': processed})
(OUT / 'provenance.json').write_text(json.dumps(provenance, indent=2))
print(f'Finished: {OUT / "eltes-desktop-install.mp4"}', flush=True)
