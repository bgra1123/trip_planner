#!/usr/bin/env node
// Builds the iPhone capture bookmarklet from the real, unmodified
// extension/scrapers.js — not a reimplementation. iPhone has no extension
// system at all (not even in "Chrome" there — Apple requires every iOS
// browser to run on WebKit, so the real Chromium extension engine never
// runs there), so there is no content-script channel to receive a capture
// through. The bookmarklet is the mobile substitute: it runs the same
// scraper against whatever page is open in Safari, then opens the planner
// with the result carried in the URL hash instead of a postMessage, since
// a bookmarklet has no persistent connection to hand it over any other way.
//
//   node scripts/build-bookmarklet.mjs [plannerUrl]
//
// Writes public/bookmarklet.js (the raw code, for reading/debugging) and
// public/capture.html (the install page) so both ship with the site build.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { minify } from 'terser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PLANNER_URL = process.argv[2] || 'https://bgra1123.github.io/trip_planner/';

const scrapersSrc = readFileSync(path.join(ROOT, 'extension/scrapers.js'), 'utf8');

const captureAndRedirect = `
(function () {
  'use strict';
  try {
    var site = TripAgentScrapers.detectSite(location.href, document);
    var offers = TripAgentScrapers.scrape(document, location.href, null);
    if (!offers.length) {
      alert('TripAgent: no prices found on this page. Try selecting a price and using Share \\u2192 Copy, then paste it into the Quick Add form on the planner instead.');
      return;
    }
    var payload = JSON.stringify({ offers: offers, sourceUrl: location.href, site: site.id });
    var encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(payload))));
    var url = ${JSON.stringify(PLANNER_URL)} + '#capture=' + encoded;
    window.open(url, '_blank');
  } catch (err) {
    alert('TripAgent capture failed: ' + (err && err.message ? err.message : err));
  }
})();
`;

// One minify pass over the combined source — real parsing, not a
// hand-rolled comment strip: scrapers.js has a regex literal ending in an
// escaped slash right before its closing delimiter (`\//i`), a literal "//"
// that a naive line-based stripper reads as a comment start, truncating the
// regex. Terser parses the actual syntax, so it can't make that mistake,
// and its output is already safely single-line — no manual join needed.
const combined = `${scrapersSrc}\n${captureAndRedirect}`;
const result = await minify(combined, { mangle: false, compress: false, format: { comments: false } });
if (!result.code) throw new Error('terser produced no output — check the source above for a syntax error');

const bookmarklet = `javascript:${result.code}`;

// Fails loudly rather than shipping a broken bookmarklet: the generated
// code must itself be valid JS once the javascript: prefix is stripped.
new Function(result.code);

writeFileSync(path.join(ROOT, 'public/bookmarklet.js'), bookmarklet, 'utf8');
console.log(`Wrote public/bookmarklet.js (${bookmarklet.length} chars) targeting ${PLANNER_URL}`);

const installHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TripAgent Capture — install on iPhone</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 36rem; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  p { color: #444; }
  @media (prefers-color-scheme: dark) { p { color: #bbb; } }
  ol { padding-left: 1.3rem; }
  li { margin-bottom: 0.6rem; }
  .bookmarklet-link { display: inline-block; padding: 0.6rem 1rem; background: #2563eb; color: #fff; text-decoration: none; border-radius: 0.5rem; font-weight: 600; }
  textarea { width: 100%; box-sizing: border-box; height: 6rem; font-family: ui-monospace, monospace; font-size: 0.7rem; padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #ccc; }
  button { padding: 0.5rem 1rem; border-radius: 0.5rem; border: 1px solid #2563eb; background: #fff; color: #2563eb; font-weight: 600; }
  button:active { background: #eef2ff; }
  .note { background: #fffbea; border: 1px solid #fde68a; border-radius: 0.5rem; padding: 0.75rem 1rem; font-size: 0.9rem; }
  @media (prefers-color-scheme: dark) { .note { background: #332b00; border-color: #665600; } }
</style>
</head>
<body>
<h1>Capture prices on iPhone</h1>
<p>Chrome on iPhone has no extension system at all — Apple requires every iOS browser to run on
Safari's engine, so the real extension never runs there. This bookmarklet is the mobile
substitute: it reads prices off whatever page is open in Safari, the same way the desktop
extension does, then opens the planner with the results ready to add.</p>

<h2>1. Save the bookmarklet</h2>
<ol>
  <li>On a Mac or iPad with a trackpad/mouse: drag this link to your bookmarks bar —
    <a class="bookmarklet-link" id="bm-link" href="#">📌 TripAgent Capture</a></li>
  <li>On iPhone (no bookmarks bar to drag to): first bookmark <em>any</em> page — tap the
    Share icon in Safari → <strong>Add Bookmark</strong>.</li>
  <li>Open <strong>Bookmarks</strong> (the book icon) → <strong>Edit</strong> → tap the
    bookmark you just made.</li>
  <li>Replace its <strong>name</strong> with <code>TripAgent Capture</code> and replace its
    <strong>URL</strong> with the code below — copy it, then paste over the existing URL.</li>
</ol>
<textarea id="bm-code" readonly></textarea><br><br>
<button id="copy-btn" type="button">Copy code</button>
<span id="copy-status" aria-live="polite"></span>

<h2>2. Use it</h2>
<ol>
  <li>Open your card's travel portal (or any site with prices) in Safari.</li>
  <li>Tap the address bar → <strong>Bookmarks</strong> → <strong>TripAgent Capture</strong>.</li>
  <li>It opens the planner in a new tab with whatever it found, staged and ready to review —
    nothing is added to your trip until you tap Add.</li>
</ol>
<p class="note">No prices found? That's an honest result, not a bug — some pages hide their
markup from a generic reader. Select the price by hand and use the <strong>Quick Add</strong>
form on the planner instead; it takes the same few seconds either way.</p>

<p><a href="./">← Back to the planner</a></p>

<script>
  var CODE = ${JSON.stringify(bookmarklet)};
  document.getElementById('bm-link').href = CODE;
  document.getElementById('bm-code').value = CODE;
  document.getElementById('copy-btn').addEventListener('click', function () {
    var status = document.getElementById('copy-status');
    var codeBox = document.getElementById('bm-code');
    codeBox.select();
    codeBox.setSelectionRange(0, CODE.length);
    var done = function (ok) { status.textContent = ok ? ' Copied.' : ' Could not copy — select the text above and copy it by hand.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CODE).then(function () { done(true); }, function () { done(false); });
    } else {
      try { done(document.execCommand('copy')); } catch (e) { done(false); }
    }
  });
</script>
</body>
</html>
`;

writeFileSync(path.join(ROOT, 'public/capture.html'), installHtml, 'utf8');
console.log(`Wrote public/capture.html (${installHtml.length} chars)`);
