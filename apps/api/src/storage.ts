import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

export const storage = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});

export async function ensureBucket(): Promise<void> {
  try {
    await storage.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch {
    await storage.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
}

export async function putObject(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
  await storage.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function getObject(key: string) {
  return storage.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function deleteObjects(keys: readonly string[]): Promise<void> {
  await Promise.allSettled(keys.map((key) => storage.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }))));
}

export async function listObjectKeys(prefix = "emails/"): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await storage.send(new ListObjectsV2Command({
      Bucket: config.S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
