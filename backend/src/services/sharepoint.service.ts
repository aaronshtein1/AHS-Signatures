import { config } from '../utils/config.js';
import { db, sharePointFolderCaches, eq, and, gte } from '../db/index.js';

// --- Types ---

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface SharePointFolder {
  id: string;
  name: string;
  webUrl: string;
  childCount: number;
  path: string;
  parentFolder: string;
}

interface FolderMatch {
  folder: SharePointFolder;
  confidence: number;
}

export interface SharePointUploadResult {
  url: string;
  folderName: string;
  folderPath: string;
  matchConfidence: number;
  isExistingFolder: boolean;
}

class SharePointError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'SharePointError';
  }
}

// --- Module-level caches ---

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const FOLDER_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedToken: TokenCache | null = null;
let cachedSiteId: string | null = null;
let cachedDriveId: string | null = null;

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Authentication ---

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: config.MICROSOFT_CLIENT_ID,
    client_secret: config.MICROSOFT_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new SharePointError(`Failed to get access token: ${error}`, response.status);
  }

  const data: any = await response.json();

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

// --- Robust HTTP Request Wrapper ---

async function graphRequest(
  method: string,
  url: string,
  options?: {
    body?: Buffer | string;
    contentType?: string;
    retries?: number;
  }
): Promise<Response> {
  if (!url.startsWith('http')) {
    url = `${GRAPH_BASE_URL}${url}`;
  }

  const retries = options?.retries ?? 3;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const token = await getAccessToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (options?.contentType) {
        headers['Content-Type'] = options.contentType;
      } else if (!options?.body) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: options?.body,
      });

      if (response.status === 401) {
        cachedToken = null;
        continue;
      }

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        console.warn(`[SharePoint] Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new SharePointError(
          `Graph API ${method} ${url} failed (${response.status}): ${errorText}`,
          response.status
        );
      }

      return response;
    } catch (err) {
      if (err instanceof SharePointError) throw err;
      if (attempt === retries - 1) {
        throw new SharePointError(`Request failed after ${retries} attempts: ${err}`);
      }
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw new SharePointError('Request failed after retries');
}

// --- Site and Drive Discovery ---

async function resolveSiteId(): Promise<string> {
  if (cachedSiteId) return cachedSiteId;

  const siteUrl = config.SHAREPOINT_SITE_URL;
  if (!siteUrl) {
    throw new SharePointError('SHAREPOINT_SITE_URL is required when SHAREPOINT_DRIVE_ID is not set');
  }

  const parsed = new URL(siteUrl);
  const hostname = parsed.hostname;
  const sitePath = parsed.pathname.replace(/\/$/, '');

  const response = await graphRequest('GET', `/sites/${hostname}:${sitePath}`);
  const data: any = await response.json();

  cachedSiteId = data.id;
  console.log(`[SharePoint] Found site: ${data.displayName || 'Unknown'}`);
  return cachedSiteId!;
}

async function resolveDriveId(): Promise<string> {
  if (config.SHAREPOINT_DRIVE_ID) {
    return config.SHAREPOINT_DRIVE_ID;
  }

  if (cachedDriveId) return cachedDriveId;

  const siteId = await resolveSiteId();
  const libraryName = config.SHAREPOINT_LIBRARY_NAME;

  const response = await graphRequest('GET', `/sites/${siteId}/drives`);
  const data: any = await response.json();
  const drives = data.value || [];

  for (const drive of drives) {
    if ((drive.name || '').toLowerCase() === libraryName.toLowerCase()) {
      cachedDriveId = drive.id;
      console.log(`[SharePoint] Found library: ${drive.name}`);
      return cachedDriveId!;
    }
  }

  for (const drive of drives) {
    if ((drive.name || '').toLowerCase().includes(libraryName.toLowerCase())) {
      cachedDriveId = drive.id;
      console.log(`[SharePoint] Found library (partial match): ${drive.name}`);
      return cachedDriveId!;
    }
  }

  const available = drives.map((d: any) => d.name || 'Unknown');
  throw new SharePointError(
    `Document library '${libraryName}' not found. Available: ${available.join(', ')}`
  );
}

// --- Folder Navigation ---

async function listFoldersFromApi(folderPath: string): Promise<SharePointFolder[]> {
  const driveId = await resolveDriveId();
  const encodedPath = encodeURIComponent(folderPath);
  let url: string | null =
    `/drives/${driveId}/root:/${encodedPath}:/children?$filter=folder ne null`;

  const folders: SharePointFolder[] = [];

  while (url) {
    const response = await graphRequest('GET', url);
    const data: any = await response.json();

    for (const item of data.value || []) {
      if (item.folder) {
        folders.push({
          id: item.id,
          name: item.name,
          webUrl: item.webUrl || '',
          childCount: item.folder?.childCount || 0,
          path: `${folderPath}/${item.name}`,
          parentFolder: folderPath,
        });
      }
    }

    url = data['@odata.nextLink'] || null;
  }

  return folders;
}

// --- DB Folder Cache ---

async function getCachedFolders(cacheKey: string): Promise<SharePointFolder[] | null> {
  const cutoff = new Date(Date.now() - FOLDER_CACHE_TTL_MS);

  const rows = await db.query.sharePointFolderCaches.findMany({
    where: and(
      eq(sharePointFolderCaches.cacheKey, cacheKey),
      gte(sharePointFolderCaches.cachedAt, cutoff)
    ),
  });

  if (rows.length === 0) return null;

  return rows.map(row => ({
    id: row.folderId,
    name: row.name,
    webUrl: row.webUrl,
    childCount: row.childCount,
    path: row.path,
    parentFolder: row.parentFolder,
  }));
}

async function setCachedFolders(cacheKey: string, folders: SharePointFolder[]): Promise<void> {
  await db.delete(sharePointFolderCaches)
    .where(eq(sharePointFolderCaches.cacheKey, cacheKey));

  if (folders.length === 0) return;

  await db.insert(sharePointFolderCaches).values(folders.map(f => ({
    folderId: f.id,
    name: f.name,
    webUrl: f.webUrl,
    childCount: f.childCount,
    path: f.path,
    parentFolder: f.parentFolder,
    cacheKey,
  })));
}

async function invalidateFolderCache(cacheKey: string): Promise<void> {
  await db.delete(sharePointFolderCaches)
    .where(eq(sharePointFolderCaches.cacheKey, cacheKey));
}

async function getEmployeeFolders(subfolder?: string | null): Promise<SharePointFolder[]> {
  let searchPath = config.SHAREPOINT_BASE_FOLDER;
  if (subfolder) {
    searchPath += `/${subfolder}`;
  }

  const cacheKey = searchPath;

  const cached = await getCachedFolders(cacheKey);
  if (cached) {
    console.log(`[SharePoint] Using cached folder list for "${cacheKey}" (${cached.length} folders)`);
    return cached;
  }

  try {
    console.log(`[SharePoint] Fetching folder list from API for "${cacheKey}"...`);
    const folders = await listFoldersFromApi(searchPath);
    console.log(`[SharePoint] Found ${folders.length} folders, caching to DB`);

    await setCachedFolders(cacheKey, folders);

    return folders;
  } catch (err) {
    console.warn(`[SharePoint] Could not list folders at "${searchPath}": ${err}`);
    return [];
  }
}

// --- Fuzzy Name Matching ---

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
}

function sequenceMatchRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const totalLength = a.length + b.length;

  function countMatches(
    aStart: number, aEnd: number,
    bStart: number, bEnd: number
  ): number {
    let bestLen = 0;
    let bestAStart = 0;
    let bestBStart = 0;

    for (let i = aStart; i < aEnd; i++) {
      for (let j = bStart; j < bEnd; j++) {
        let k = 0;
        while (i + k < aEnd && j + k < bEnd && a[i + k] === b[j + k]) {
          k++;
        }
        if (k > bestLen) {
          bestLen = k;
          bestAStart = i;
          bestBStart = j;
        }
      }
    }

    if (bestLen === 0) return 0;

    let matches = bestLen;

    if (bestAStart > aStart && bestBStart > bStart) {
      matches += countMatches(aStart, bestAStart, bStart, bestBStart);
    }

    const aRight = bestAStart + bestLen;
    const bRight = bestBStart + bestLen;
    if (aRight < aEnd && bRight < bEnd) {
      matches += countMatches(aRight, aEnd, bRight, bEnd);
    }

    return matches;
  }

  const matches = countMatches(0, a.length, 0, b.length);
  return (2.0 * matches) / totalLength;
}

function findBestFolderMatch(
  employeeName: string,
  folders: SharePointFolder[],
  threshold: number = 0.6
): FolderMatch | null {
  if (folders.length === 0) return null;

  const normalized = normalizeName(employeeName);
  if (!normalized) return null;

  let bestMatch: FolderMatch | null = null;

  for (const folder of folders) {
    const folderNormalized = normalizeName(folder.name);
    if (!folderNormalized) continue;

    if (normalized === folderNormalized) {
      return { folder, confidence: 1.0 };
    }

    const ratio = sequenceMatchRatio(normalized, folderNormalized);
    if (ratio >= threshold && (!bestMatch || ratio > bestMatch.confidence)) {
      bestMatch = { folder, confidence: ratio };
    }
  }

  return bestMatch;
}

// --- Upload ---

export async function uploadToSharePoint(
  employeeName: string,
  fileName: string,
  fileBuffer: Buffer,
  subfolder?: string | null
): Promise<SharePointUploadResult> {
  const driveId = await resolveDriveId();

  const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_').trim();

  let basePath = config.SHAREPOINT_BASE_FOLDER;
  if (subfolder) {
    basePath += `/${subfolder}`;
  }

  let resolvedFolderName: string;
  let matchConfidence = 0;
  let isExistingFolder = false;

  const existingFolders = await getEmployeeFolders(subfolder);
  const match = findBestFolderMatch(employeeName, existingFolders);

  if (match) {
    resolvedFolderName = match.folder.name;
    matchConfidence = match.confidence;
    isExistingFolder = true;
    console.log(
      `[SharePoint] Matched "${employeeName}" to existing folder "${match.folder.name}" (${Math.round(match.confidence * 100)}% confidence)`
    );
  } else {
    resolvedFolderName = employeeName.replace(/[<>:"/\\|?*]/g, '_').trim();
    console.log(
      `[SharePoint] No existing folder match for "${employeeName}", creating new folder "${resolvedFolderName}"`
    );
  }

  const folderPath = `${basePath}/${resolvedFolderName}`;
  const uploadPath = `${folderPath}/${safeFileName}`;

  const uploadUrl = `/drives/${driveId}/root:/${encodeURIComponent(uploadPath)}:/content`;

  const response = await graphRequest('PUT', uploadUrl, {
    body: fileBuffer,
    contentType: 'application/pdf',
  });

  const result: any = await response.json();

  if (!isExistingFolder) {
    await invalidateFolderCache(basePath);
  }

  const url = result.webUrl || uploadPath;
  console.log(`[SharePoint] Uploaded ${safeFileName} to ${folderPath}`);

  return {
    url,
    folderName: resolvedFolderName,
    folderPath,
    matchConfidence,
    isExistingFolder,
  };
}

// --- Configuration Check ---

export function isSharePointConfigured(): boolean {
  if (!config.SHAREPOINT_ENABLED) return false;
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET || !config.MICROSOFT_TENANT_ID) {
    return false;
  }
  if (config.SHAREPOINT_DRIVE_ID) return true;
  if (config.SHAREPOINT_SITE_URL && config.SHAREPOINT_LIBRARY_NAME) return true;
  return false;
}

// --- Connection Test ---

export async function testSharePointConnection(): Promise<{
  authenticated: boolean;
  driveFound: boolean;
  baseFolderAccessible: boolean;
  folderCount: number;
  error?: string;
}> {
  const info = {
    authenticated: false,
    driveFound: false,
    baseFolderAccessible: false,
    folderCount: 0,
  } as {
    authenticated: boolean;
    driveFound: boolean;
    baseFolderAccessible: boolean;
    folderCount: number;
    error?: string;
  };

  try {
    await getAccessToken();
    info.authenticated = true;

    await resolveDriveId();
    info.driveFound = true;

    const folders = await getEmployeeFolders();
    info.baseFolderAccessible = true;
    info.folderCount = folders.length;
  } catch (err) {
    info.error = String(err);
  }

  return info;
}

export async function refreshFolderCache(subfolder?: string | null): Promise<number> {
  let searchPath = config.SHAREPOINT_BASE_FOLDER;
  if (subfolder) {
    searchPath += `/${subfolder}`;
  }

  await invalidateFolderCache(searchPath);
  const folders = await getEmployeeFolders(subfolder);
  return folders.length;
}
