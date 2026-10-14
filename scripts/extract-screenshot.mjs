#!/usr/bin/env node
// Turn a screenshot of a flight/hotel search-results page (or a photo of a
// handwritten note) into the FLIGHT:/HOTEL:/ACTIVITY:/NOTE: shorthand the
// app parses. The prompt and API call live in src/utils/screenshotExtract.js,
// shared with the "Read screenshot" button in the app.
//
// Credentials: ANTHROPIC_API_KEY, or anything else the Anthropic SDK
// resolves on its own (e.g. an `ant auth login` profile).
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
import { extractNotesFromImages, withWindow } from '../src/utils/screenshotExtract.js';

const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

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
  return { mediaType, data: readFileSync(path).toString('base64') };
}

function reportIssues(lines) {
  const parsed = parseNotes(lines);
  let noCost = 0;
  parsed.travel.forEach((g) => g.options.forEach((o) => { if (o.cost === null) noCost += 1; }));
  parsed.stay.forEach((g) => g.options.forEach((o) => { if (o.cost === null) noCost += 1; }));
  parsed.activities.forEach((a) => { if (a.cost === null) noCost += 1; });
  return { count: parsed.travel.length + parsed.stay.length + parsed.activities.length, noCost };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.images.length) {
    console.error('Usage: node scripts/extract-screenshot.mjs <image...> [--window "14-19 Aug"] [--out file] [--append file] [--model <model-id>]');
    process.exit(1);
  }

  let images;
  try {
    images = args.images.map(readImage);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let result;
  try {
    result = await extractNotesFromImages(images, { model: args.model, apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const output = withWindow(result.notes, args.window);

  if (args.append) {
    appendFileSync(args.append, `\n${output}\n`);
    console.error(`Appended ${args.images.length} screenshot(s) worth of lines to ${args.append}`);
  } else if (args.out) {
    writeFileSync(args.out, `${output}\n`);
    console.error(`Wrote extracted lines to ${args.out}`);
  } else {
    console.log(output);
  }

  if (result.truncated) console.error('Warning: the reply hit the token limit — some options may be missing.');
  const { count, noCost } = reportIssues(output);
  console.error(`Parsed ${count} option(s) from the screenshot(s).`);
  if (noCost > 0) {
    console.error(`Warning: ${noCost} option(s) have no recognizable price — check for "price unclear" notes or typos before trusting totals.`);
  }
}

main();
