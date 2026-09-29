#!/usr/bin/env node
// Turn a screenshot of a flight/hotel search-results page (or a photo of a
// handwritten note) into the FLIGHT:/HOTEL:/ACTIVITY:/NOTE: shorthand the
// app parses — the same job Claude did by hand earlier on a notebook photo,
// wired up as a repeatable step instead of a one-off chat exchange.
//
// Requires an Anthropic API key (your own — this hits api.anthropic.com
// directly, no server in this repo does it for you):
//   export ANTHROPIC_API_KEY=sk-ant-...
//
// Usage:
//   node scripts/extract-screenshot.mjs screenshot.png
//   node scripts/extract-screenshot.mjs a.png b.png --window "14-19 Aug" --append notes.txt
//   node scripts/extract-screenshot.mjs screenshot.png --out lines.txt
//
// With no --out/--append, the extracted lines print to stdout so you can
// pipe them straight into generate-report.mjs or paste them into the app.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { parseNotes } from '../src/utils/parseTripNotes.js';

const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const FORMAT_SPEC = `Read this screenshot of a travel search-results page (or a photo of a handwritten travel note) and transcribe every priced option you can see into plain-text lines using this exact shorthand — one line per option, nothing else in your reply.

Line shapes (tag at the start of the line, colon, then the body):
  FLIGHT: <origin> to <destination>, <HH:MM>-<HH:MM>, <PRICE>, <airline or note>
  TRAIN: <origin> to <destination>, <HH:MM>-<HH:MM>, <PRICE>, <note>
  HOTEL: <place> - <short description>, <PRICE>/night x<nights>, <note>
  ACTIVITY: <name>, <PRICE>
  NOTE: <anything worth remembering that isn't a priced option>

Other tags that work the same way if they fit better: BUS, CAR, FERRY (travel), STAY, AIRBNB, APARTMENT (stay), TOUR, TICKET, VISIT, ATTRACTION (activity).

PRICE format: a currency symbol or 3-letter code immediately before the number, no space issues — "EUR2100", "€2100", "TRY116000", "USD40" are all fine. Ranges: "EUR250-350". Free items: write "free". Never invent a price you can't actually read — write "price unclear" as the note instead and omit the currency+number.

Only transcribe what's visibly in the image — do not guess prices, times, or airline names that aren't shown. If nothing in the image matches this shape (e.g. it's not a travel screenshot at all), reply with exactly: NOTE: (nothing recognizable extracted)

Reply with ONLY the lines, no headers, no markdown code fences, no commentary.`;

function parseArgs(argv) {
  const args = { images: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--append') args.append = argv[++i];
    else if (a === '--window') args.window = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else args.images.push(a);
  }
  return args;
}

function readImage(path) {
  const ext = extname(path).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image type "${ext}" for ${path}. Use png, jpg, jpeg, webp, or gif.`);
  }
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const data = readFileSync(path).toString('base64');
  return { mediaType, data };
}

async function callClaude(images, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Get a key from console.anthropic.com and export it first.');
  }
  const content = [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })),
    { type: 'text', text: FORMAT_SPEC },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text.trim()) throw new Error('Empty response from the model.');
  return text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
}

function withWindow(lines, windowLabel) {
  if (!windowLabel) return lines;
  return `WINDOW: ${windowLabel}\n${lines}\nWINDOW:`;
}

function reportIssues(lines) {
  const parsed = parseNotes(lines);
  const noCostLines = [];
  parsed.travel.forEach((g) => g.options.forEach((o) => { if (o.cost === null) noCostLines.push(o.raw); }));
  parsed.stay.forEach((g) => g.options.forEach((o) => { if (o.cost === null) noCostLines.push(o.raw); }));
  parsed.activities.forEach((a) => { if (a.cost === null) noCostLines.push(a.raw); });
  return { count: parsed.travel.length + parsed.stay.length + parsed.activities.length, noCostLines };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.images.length) {
    console.error('Usage: node scripts/extract-screenshot.mjs <image...> [--window "14-19 Aug"] [--out file] [--append file] [--model claude-sonnet-5]');
    process.exit(1);
  }

  let images;
  try {
    images = args.images.map(readImage);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let lines;
  try {
    lines = await callClaude(images, args.model);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const output = withWindow(lines, args.window);

  if (args.append) {
    appendFileSync(args.append, `\n${output}\n`);
    console.error(`Appended ${args.images.length} screenshot(s) worth of lines to ${args.append}`);
  } else if (args.out) {
    writeFileSync(args.out, `${output}\n`);
    console.error(`Wrote extracted lines to ${args.out}`);
  } else {
    console.log(output);
  }

  const { count, noCost } = reportIssues(output);
  console.error(`Parsed ${count} option(s) from the screenshot(s).`);
  if (noCost > 0) {
    console.error(`Warning: ${noCost} option(s) have no recognizable price — check for "price unclear" notes or typos before trusting totals.`);
  }
}

main();
