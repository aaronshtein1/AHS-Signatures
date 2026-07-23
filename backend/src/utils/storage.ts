import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import path from 'path';

const BUCKET = process.env.AWS_S3_BUCKET || 'documents';
const USE_LOCAL = !process.env.AWS_ACCESS_KEY_ID;
const LOCAL_ROOT = path.join(process.cwd(), 'uploads');

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_REGION || 'auto',
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });
  }
  return _s3;
}

export async function uploadFile(key: string, buffer: Buffer | Uint8Array, contentType = 'application/pdf'): Promise<void> {
  if (USE_LOCAL) {
    const fullPath = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return;
  }
  await getS3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

export async function downloadFile(key: string): Promise<Buffer> {
  if (USE_LOCAL) {
    const fullPath = path.join(LOCAL_ROOT, key);
    return fs.readFile(fullPath);
  }
  const result = await getS3().send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
  const bytes = await result.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteFile(key: string): Promise<void> {
  if (USE_LOCAL) {
    const fullPath = path.join(LOCAL_ROOT, key);
    await fs.unlink(fullPath).catch(() => {});
    return;
  }
  await getS3().send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}

export async function getFileUrl(key: string, expiresIn = 3600): Promise<string> {
  if (USE_LOCAL) {
    return `file://${path.join(LOCAL_ROOT, key)}`;
  }
  const url = await getSignedUrl(getS3(), new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }), { expiresIn });
  return url;
}
