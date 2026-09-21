/**
 * Cloudflare R2 (S3-compatible) receipt storage.
 *
 * All env vars are optional at build time: when any of them is missing the
 * module exposes `r2Configured = false` and upload/delete calls fail with a
 * clear Arabic message instead of crashing. The rest of the system (saving
 * payments, balances, calculations) never depends on this being configured.
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const R2_ENV_KEYS = {
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  bucketName: "R2_BUCKET_NAME",
  endpoint: "R2_ENDPOINT",
  publicUrl: "R2_PUBLIC_URL",
} as const;

export function getR2Config() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT;
  const publicUrl = process.env.R2_PUBLIC_URL;

  const configured = Boolean(accessKeyId && secretAccessKey && bucketName && endpoint && publicUrl);
  return { accessKeyId, secretAccessKey, bucketName, endpoint, publicUrl, configured };
}

export const R2_NOT_CONFIGURED_MESSAGE =
  "يرجى إعداد بيانات التخزين السحابي في .env أولًا (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT, R2_PUBLIC_URL)";

function getS3Client(cfg: ReturnType<typeof getR2Config>) {
  return new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId as string,
      secretAccessKey: cfg.secretAccessKey as string,
    },
  });
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export function validateReceiptFile(file: { size: number; type: string; name: string }): string | null {
  if (!ALLOWED_MIME.has(file.type)) {
    return "صيغة الملف غير مدعومة — المسموح: JPG, PNG, WEBP أو PDF";
  }
  if (file.size <= 0) return "الملف فارغ";
  if (file.size > MAX_FILE_BYTES) return "حجم الملف يتجاوز 10 ميجابايت";
  return null;
}

function safeExt(name: string, mime: string): string {
  const fromName = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const exts: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return exts[mime] || (fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : "bin");
}

/** Upload a receipt file to R2 and return its public URL. Throws Error with Arabic message on failure. */
export async function uploadReceiptToR2(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  size: number
): Promise<string> {
  const cfg = getR2Config();
  if (!cfg.configured) throw new Error(R2_NOT_CONFIGURED_MESSAGE);

  const validationError = validateReceiptFile({ size, type: mimeType, name: originalName });
  if (validationError) throw new Error(validationError);

  const key = `receipts/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt(originalName, mimeType)}`;
  const client = getS3Client(cfg);

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      ContentLength: size,
    })
  );

  return `${(cfg.publicUrl as string).replace(/\/$/, "")}/${key}`;
}

/** Delete a receipt object from R2 (best-effort — DB row removal proceeds even if this fails). */
export async function deleteReceiptFromR2(imageUrl: string): Promise<void> {
  const cfg = getR2Config();
  if (!cfg.configured) return;
  const prefix = `${(cfg.publicUrl as string).replace(/\/$/, "")}/`;
  if (!imageUrl.startsWith(prefix)) return; // not one of ours
  const key = imageUrl.slice(prefix.length);
  try {
    const client = getS3Client(cfg);
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucketName, Key: key }));
  } catch {
    // best effort: orphaned object is harmless; keep DB consistent regardless
  }
}
