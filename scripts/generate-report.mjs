#!/usr/bin/env node
// Turn a trip-notes file (the FLIGHT:/TRAIN:/HOTEL:/ACTIVITY:/NOTE: shorthand
// used by the app) into trip-plan.json and trip-plan.md — the same report
// the "Export" buttons in the app produce, without opening a browser.
//
// Usage:
//   node scripts/generate-report.mjs notes.txt [--out ./report] [--route "IST → MUN → MILAN"]
//   cat notes.txt | node scripts/generate-report.mjs [--out ./report]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNotes,
  defaultSelection,
  buildExportData,
  toMarkdown,
  deriveRouteChain,
} from '../src/utils/parseTripNotes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--route') args.route = argv[++i];
    else args._.push(a);
  }
  return args;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function deriveRoute(parsed) {
  const stops = deriveRouteChain(parsed.travel);
  return stops.length ? stops.join(' → ') : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const notesPath = args._[0];
  const notesText = notesPath ? readFileSync(notesPath, 'utf8') : readStdin();

  if (!notesText || !notesText.trim()) {
    console.error('No notes provided. Pass a file path or pipe notes text on stdin.');
    process.exit(1);
  }

  const parsed = parseNotes(notesText);
  const selection = defaultSelection(parsed);
  const route = args.route || deriveRoute(parsed);
  const data = buildExportData(parsed, selection, route);

  const outDir = args.out ? args.out : join(__dirname, '..', 'report');
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, 'trip-plan.json');
  const mdPath = join(outDir, 'trip-plan.md');
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  writeFileSync(mdPath, toMarkdown(data));

  console.error(
    `Parsed ${parsed.travel.length} travel leg(s), ${parsed.stay.length} stay(s), ` +
    `${parsed.activities.length} activity(ies). Wrote:\n  ${jsonPath}\n  ${mdPath}`
  );
  if (data.missingRates.length) {
    console.error(
      `Warning: costs in ${data.missingRates.join(', ')} have no RATE: line and were excluded ` +
      `from totals/combinations. Add e.g. "RATE: ${data.missingRates[0]} 0.018" to the notes to include them.`
    );
  }
}

main();
