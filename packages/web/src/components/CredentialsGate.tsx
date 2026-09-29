import { useState, type FormEvent } from "react";
import { credentialsAreValid, type Credentials } from "../api.js";

const DEFAULT_API_BASE = "http://localhost:3000";

export function CredentialsGate({
  onConnect,
}: {
  onConnect: (creds: Credentials) => void;
}) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [tripId, setTripId] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setChecking(true);
    const creds: Credentials = { apiBase: apiBase.replace(/\/$/, ""), tripId: tripId.trim(), token: token.trim() };
    const ok = await credentialsAreValid(creds);
    setChecking(false);
    if (!ok) {
      setError("Couldn't load that trip — check the API URL, trip ID, and token.");
      return;
    }
    onConnect(creds);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Trip Memory</h1>
        <p className="mb-5 text-sm text-slate-500">
          Connect with a trip ID and its bearer token, from{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5">POST /trips</code> or{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5">POST /trips/:id/tokens</code>.
        </p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-700">API base URL</span>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
          />
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Trip ID</span>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="trip_..."
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            required
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Token</span>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="tmk_..."
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
        </label>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={checking}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {checking ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
