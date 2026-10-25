import { createReadStream } from 'node:fs';

// Single byte ranges for progressive tutorial playback and chapter seeking.
export function mediaRange(header, size) {
  if (!header) return { status: 200, start: 0, end: size - 1, length: size };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return { status: 416 };
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { status: 416 };
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return { status: 416 };
    end = Math.min(end, size - 1);
  }
  return { status: 206, start, end, length: end - start + 1 };
}

export function serveMedia(req, res, file, size) {
  const range = mediaRange(req.headers.range, size);
  res.statusCode = range.status;
  res.setHeader('Accept-Ranges', 'bytes');
  if (range.status === 416) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }
  res.setHeader('Content-Length', range.length);
  if (range.status === 206) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  if (req.method === 'HEAD' || !range.length) return res.end();
  const stream = createReadStream(file, { start: range.start, end: range.end });
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
