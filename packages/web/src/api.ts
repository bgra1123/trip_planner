import type {
  CreateItemInput,
  CreateSegmentInput,
  Item,
  Segment,
  Trip,
  UpdateItemInput,
  UpdateSegmentInput,
} from "@trip-memory/core";

export type Credentials = {
  apiBase: string;
  tripId: string;
  token: string;
};

export type TripBundle = { trip: Trip; segments: Segment[]; items: Item[] };

async function request<T>(creds: Credentials, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${creds.apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${creds.token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getTripBundle(creds: Credentials): Promise<TripBundle> {
  return request(creds, `/trips/${creds.tripId}`);
}

export function createSegment(
  creds: Credentials,
  input: Omit<CreateSegmentInput, "trip_id">,
): Promise<Segment> {
  return request(creds, `/trips/${creds.tripId}/segments`, {
    method: "POST",
    body: JSON.stringify({ ...input, trip_id: creds.tripId }),
  });
}

export function updateSegment(
  creds: Credentials,
  segmentId: string,
  patch: UpdateSegmentInput,
): Promise<Segment> {
  return request(creds, `/segments/${segmentId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function createItem(
  creds: Credentials,
  input: Omit<CreateItemInput, "trip_id">,
): Promise<Item> {
  return request(creds, `/trips/${creds.tripId}/items`, {
    method: "POST",
    body: JSON.stringify({ ...input, trip_id: creds.tripId }),
  });
}

export function updateItem(
  creds: Credentials,
  itemId: string,
  patch: UpdateItemInput,
): Promise<Item> {
  return request(creds, `/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteItem(creds: Credentials, itemId: string): Promise<void> {
  return request(creds, `/items/${itemId}`, { method: "DELETE" });
}

export async function credentialsAreValid(creds: Credentials): Promise<boolean> {
  try {
    await getTripBundle(creds);
    return true;
  } catch {
    return false;
  }
}
