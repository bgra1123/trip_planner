import { extractCandidate } from "./adapters/index.js";
import { recordFailures } from "./failureLog.js";

// Bundled and injected via chrome.scripting.executeScript({files: [...]}) — attaches
// a global the popup then calls with a second, trivially-simple func: injection.
// That two-step split exists because Chrome's documented promise-unwrapping
// guarantee for executeScript's return value applies to `func`, not `files`; this
// function itself stays synchronous so no promise ever needs to cross that boundary.
(globalThis as unknown as { __tripMemoryExtract: () => unknown }).__tripMemoryExtract = () => {
  const { candidate, adapterId, failures } = extractCandidate(document, location.href);
  void recordFailures(failures);
  return { candidate, adapterId };
};
