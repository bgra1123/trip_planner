import { resolvePlace } from "@trip-memory/core";
import type { ItemType, Segment } from "@trip-memory/core";
import type { ExtractedCandidate, ExtractionFailure } from "./types.js";
import { clearFailures, readFailures } from "./failureLog.js";

type Credentials = { apiBase: string; tripId: string; token: string };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const apiBaseInput = $<HTMLInputElement>("apiBase");
const tripIdInput = $<HTMLInputElement>("tripId");
const tokenInput = $<HTMLInputElement>("token");
const credentialsStatus = $<HTMLDivElement>("credentialsStatus");

const captureButton = $<HTMLButtonElement>("captureButton");
const captureStatus = $<HTMLDivElement>("captureStatus");
const candidateForm = $<HTMLDivElement>("candidateForm");
const adapterBadge = $<HTMLSpanElement>("adapterBadge");

const titleInput = $<HTMLInputElement>("title");
const typeSelect = $<HTMLSelectElement>("type");
const assignToSelect = $<HTMLSelectElement>("assignTo");
const amountInput = $<HTMLInputElement>("amount");
const currencyInput = $<HTMLInputElement>("currency");
const startsAtInput = $<HTMLInputElement>("startsAt");
const endsAtInput = $<HTMLInputElement>("endsAt");
const placeNameInput = $<HTMLInputElement>("placeName");
const placeAddressInput = $<HTMLInputElement>("placeAddress");
const addButton = $<HTMLButtonElement>("addButton");
const addStatus = $<HTMLDivElement>("addStatus");

const failuresSummary = $<HTMLElement>("failuresSummary");
const failuresList = $<HTMLDivElement>("failuresList");
const clearFailuresButton = $<HTMLButtonElement>("clearFailures");

let capturedPageUrl: string | null = null;

async function loadCredentials(): Promise<Credentials | null> {
  const result = await chrome.storage.local.get("credentials");
  return (result.credentials as Credentials | undefined) ?? null;
}

async function saveCredentials(creds: Credentials): Promise<void> {
  await chrome.storage.local.set({ credentials: creds });
}

function setStatus(el: HTMLElement, message: string, kind: "error" | "success" | "" = "") {
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchSegments(creds: Credentials): Promise<Segment[]> {
  const res = await fetch(`${creds.apiBase}/trips/${creds.tripId}`, {
    headers: { authorization: `Bearer ${creds.token}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as { segments: Segment[] };
  return body.segments;
}

function findAdjacentStayCity(ordered: Segment[], index: number, direction: 1 | -1): string | null {
  for (let i = index + direction; i >= 0 && i < ordered.length; i += direction) {
    if (ordered[i]!.kind === "stay") return ordered[i]!.city;
  }
  return null;
}

/** Mirrors core's routeLabel, without needing Items just to label a segment picker. */
function segmentLabel(ordered: Segment[], index: number): string {
  const segment = ordered[index]!;
  if (segment.kind === "stay") return segment.city ?? "Stay";
  const from = findAdjacentStayCity(ordered, index, -1);
  const to = findAdjacentStayCity(ordered, index, 1);
  return `Travel: ${from ?? "?"} -> ${to ?? "?"}`;
}

async function populateSegmentPicker(creds: Credentials) {
  assignToSelect.innerHTML = '<option value="">Inbox (unassigned)</option>';
  try {
    const ordered = [...(await fetchSegments(creds))].sort((a, b) => a.order - b.order);
    for (let i = 0; i < ordered.length; i++) {
      const option = document.createElement("option");
      option.value = ordered[i]!.id;
      option.textContent = segmentLabel(ordered, i);
      assignToSelect.appendChild(option);
    }
  } catch {
    // Leave just the Inbox option — the trip may not be reachable yet (bad
    // credentials, or not saved), which addButton will surface on submit anyway.
  }
}

function fillForm(candidate: ExtractedCandidate, adapterId: string | null) {
  candidateForm.style.display = "block";
  adapterBadge.textContent = adapterId ? `via ${adapterId}` : "";

  titleInput.value = candidate.title;
  typeSelect.value = candidate.type;
  amountInput.value = candidate.cost ? String(candidate.cost.amount) : "";
  currencyInput.value = candidate.cost?.currency ?? "";
  startsAtInput.value = toLocalInputValue(candidate.starts_at);
  endsAtInput.value = toLocalInputValue(candidate.ends_at);
  placeNameInput.value = candidate.place_guess?.name ?? "";
  placeAddressInput.value = candidate.place_guess?.address ?? "";
}

async function renderFailures() {
  const failures: ExtractionFailure[] = await readFailures();
  failuresSummary.textContent = `Extraction failures (${failures.length})`;
  failuresList.innerHTML = failures
    .map(
      (f) =>
        `<div class="failure"><strong>${f.adapterId}</strong> v${f.adapterVersion} — ${f.message}<br/><small>${f.url}</small></div>`,
    )
    .join("");
}

async function init() {
  const creds = await loadCredentials();
  if (creds) {
    apiBaseInput.value = creds.apiBase;
    tripIdInput.value = creds.tripId;
    tokenInput.value = creds.token;
    await populateSegmentPicker(creds);
  }
  await renderFailures();
}

$<HTMLButtonElement>("saveCredentials").addEventListener("click", async () => {
  const creds: Credentials = {
    apiBase: apiBaseInput.value.replace(/\/$/, ""),
    tripId: tripIdInput.value.trim(),
    token: tokenInput.value.trim(),
  };
  await saveCredentials(creds);
  setStatus(credentialsStatus, "Saved.", "success");
  await populateSegmentPicker(creds);
});

captureButton.addEventListener("click", async () => {
  setStatus(captureStatus, "Capturing…");
  candidateForm.style.display = "none";
  try {
    const creds = await loadCredentials();
    if (creds) await populateSegmentPicker(creds);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["injectedExtract.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window as unknown as { __tripMemoryExtract: () => unknown }).__tripMemoryExtract(),
    });

    const { candidate, adapterId } = result as { candidate: ExtractedCandidate | null; adapterId: string | null };
    if (!candidate) {
      setStatus(captureStatus, "Nothing extractable on this page.", "error");
      return;
    }

    capturedPageUrl = candidate.url;
    fillForm(candidate, adapterId);
    setStatus(captureStatus, "Review and correct below, then add.", "success");
    await renderFailures();
  } catch (err) {
    setStatus(captureStatus, err instanceof Error ? err.message : String(err), "error");
  }
});

addButton.addEventListener("click", async () => {
  const creds = await loadCredentials();
  if (!creds || !creds.tripId || !creds.token) {
    setStatus(addStatus, "Save credentials first.", "error");
    return;
  }

  const placeName = placeNameInput.value.trim();
  const placeRef = placeName
    ? resolvePlace({ name: placeName, address: placeAddressInput.value.trim() || null })
    : null;

  const body = {
    trip_id: creds.tripId,
    segment_id: assignToSelect.value || null,
    type: typeSelect.value as ItemType,
    status: "idea" as const,
    title: titleInput.value.trim(),
    place_ref: placeRef,
    starts_at: fromLocalInputValue(startsAtInput.value),
    ends_at: fromLocalInputValue(endsAtInput.value),
    cost:
      amountInput.value && currencyInput.value
        ? { amount: Number(amountInput.value), currency: currencyInput.value.toUpperCase() }
        : null,
    source: { origin: "extension" as const, url: capturedPageUrl, agent_name: null },
    cancellable_until: null,
    raw: null,
  };

  setStatus(addStatus, "Adding…");
  try {
    const res = await fetch(`${creds.apiBase}/trips/${creds.tripId}/items`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${creds.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    const targetLabel = assignToSelect.options[assignToSelect.selectedIndex]?.textContent ?? "Inbox";
    setStatus(addStatus, `Added to ${targetLabel}.`, "success");
  } catch (err) {
    setStatus(addStatus, err instanceof Error ? err.message : String(err), "error");
  }
});

clearFailuresButton.addEventListener("click", async () => {
  await clearFailures();
  await renderFailures();
});

init();
