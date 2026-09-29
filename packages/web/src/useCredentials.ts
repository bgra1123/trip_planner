import { useCallback, useState } from "react";
import type { Credentials } from "./api.js";

const STORAGE_KEY = "trip-memory:credentials";

function loadStoredCredentials(): Credentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

export function useCredentials() {
  const [credentials, setCredentialsState] = useState<Credentials | null>(loadStoredCredentials);

  const setCredentials = useCallback((creds: Credentials | null) => {
    setCredentialsState(creds);
    if (creds) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return { credentials, setCredentials };
}
