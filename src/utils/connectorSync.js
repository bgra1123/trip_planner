// Planner side of the Claude MCP connector (mcp-server/). Claude records
// options there; the planner pulls them into its review list and tells the
// server which ones the user added or dismissed, so they stop coming back.
//
// The user pastes the same URL here that they gave Claude as a connector:
//   https://<worker>.workers.dev/mcp/<TOKEN>
// and the planner API lives beside it at /api/<TOKEN>/...

export function apiBaseFromConnectorUrl(connectorUrl) {
  let url;
  try {
    url = new URL(String(connectorUrl || '').trim());
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
  if (!match || (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')) return null;
  return `${url.origin}/api/${match[1]}`;
}

async function request(apiBase, path, init) {
  let res;
  try {
    res = await fetch(`${apiBase}${path}`, init);
  } catch {
    throw new Error('Could not reach the Claude connector — check the URL and your connection.');
  }
  if (res.status === 404) throw new Error('The Claude connector did not recognize that URL — check it matches the one added in Claude.');
  if (!res.ok) throw new Error(`The Claude connector answered ${res.status}.`);
  return res.json();
}

export async function fetchPendingOffers(connectorUrl) {
  const apiBase = apiBaseFromConnectorUrl(connectorUrl);
  if (!apiBase) throw new Error('That is not a connector URL — it should look like https://…/mcp/<token>.');
  const body = await request(apiBase, '/pending', { headers: { Accept: 'application/json' } });
  return Array.isArray(body && body.offers) ? body.offers : [];
}

export async function ackOffers(connectorUrl, ids) {
  const apiBase = apiBaseFromConnectorUrl(connectorUrl);
  if (!apiBase || !ids.length) return null;
  return request(apiBase, '/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}
