import type { GraphMailFolder } from "../types/folder";
import type { SystemFolderKind } from "../generated/prisma/client";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me";

const WELL_KNOWN_PATHS: Record<SystemFolderKind, string> = {
  INBOX: "inbox",
  SENT_ITEMS: "sentitems",
  DRAFTS: "drafts",
  JUNK_EMAIL: "junkemail",
  DELETED_ITEMS: "deleteditems",
};

interface GraphPage<T> {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

export async function fetchAllPages<T>(url: string, accessToken: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next) next = await readPage<T>(next, accessToken, out);
  return out;
}

async function readPage<T>(url: string, token: string, out: T[]): Promise<string | undefined> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Microsoft Graph request failed: ${await res.text()}`);
  const data = (await res.json()) as GraphPage<T>;
  out.push(...data.value);
  return data["@odata.nextLink"];
}

export async function fetchDeltaPages<T>(
  url: string,
  accessToken: string
): Promise<{ items: T[]; deltaLink: string | undefined }> {
  const items: T[] = [];
  let cursor: string | undefined = url;
  let delta: string | undefined;
  while (cursor) ({ next: cursor, delta } = await readDeltaPage<T>(cursor, accessToken, items, delta));
  return { items, deltaLink: delta };
}

async function readDeltaPage<T>(
  url: string,
  token: string,
  out: T[],
  prevDelta: string | undefined
): Promise<{ next: string | undefined; delta: string | undefined }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Microsoft Graph delta request failed: ${await res.text()}`);
  const data = (await res.json()) as GraphPage<T>;
  out.push(...data.value);
  return { next: data["@odata.nextLink"], delta: data["@odata.deltaLink"] ?? prevDelta };
}

const FOLDER_DELTA_URL = `${GRAPH_BASE}/mailFolders/delta?$select=id,displayName,parentFolderId`;

export async function fetchFolderDelta(
  accessToken: string,
  savedDeltaLink?: string
): Promise<{ items: GraphMailFolder[]; deltaLink: string | undefined }> {
  const startUrl = savedDeltaLink ?? FOLDER_DELTA_URL;
  return fetchDeltaPages<GraphMailFolder>(startUrl, accessToken);
}

export async function fetchWellKnownFolderIds(
  accessToken: string
): Promise<Map<string, SystemFolderKind>> {
  const entries = Object.entries(WELL_KNOWN_PATHS) as [SystemFolderKind, string][];
  const results = await Promise.all(entries.map(([kind, path]) => resolveWellKnownEntry(kind, path, accessToken)));
  return new Map(results.filter((entry): entry is [string, SystemFolderKind] => entry !== null));
}

async function resolveWellKnownEntry(
  kind: SystemFolderKind,
  path: string,
  accessToken: string
): Promise<[string, SystemFolderKind] | null> {
  const res = await fetch(`${GRAPH_BASE}/mailFolders/${path}?$select=id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id: string };
  return [data.id, kind];
}
