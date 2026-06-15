import { google } from 'googleapis';
import { config } from '../utils/config.js';
import { prisma } from '../utils/prisma.js';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const REDIRECT_PATH = '/api/admin/google/callback';

function getRedirectUri(): string {
  const base = config.FRONTEND_URL.replace(':3000', `:${config.PORT}`);
  // Use the backend URL for OAuth callback
  return `http://localhost:${config.PORT}${REDIRECT_PATH}`;
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
}

export function isGoogleDriveConfigured(): boolean {
  return !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}

export function getAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Force consent to always get refresh token
    scope: SCOPES,
  });
}

export async function handleCallback(code: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('No refresh token received. Try revoking access at https://myaccount.google.com/permissions and re-authorizing.');
  }

  // Store refresh token in database
  await prisma.systemSetting.upsert({
    where: { key: 'google_refresh_token' },
    update: { value: tokens.refresh_token },
    create: { key: 'google_refresh_token', value: tokens.refresh_token },
  });
}

export async function isConnected(): Promise<boolean> {
  if (!isGoogleDriveConfigured()) return false;
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'google_refresh_token' },
  });
  return !!setting?.value;
}

async function getAuthenticatedClient() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'google_refresh_token' },
  });

  if (!setting?.value) {
    throw new Error('Google Drive not connected. Please authorize via the admin panel.');
  }

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: setting.value });
  return client;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
}

export async function listFiles(folderId: string, since?: Date): Promise<DriveFile[]> {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });

  let query = `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`;
  if (since) {
    query += ` and modifiedTime > '${since.toISOString()}'`;
  }

  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      pageToken,
    });

    const files = (response.data.files || []) as DriveFile[];
    allFiles.push(...files);
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return allFiles;
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data as ArrayBuffer);
}
