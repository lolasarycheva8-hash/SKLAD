import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';
import type { ObjectAclPolicy } from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface PrivateUploadObject {
  objectPath: string;
  createdAt: Date | null;
  size?: number;
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  /**
   * Lists only objects created through the private upload endpoint. Creation
   * metadata that cannot be trusted is returned as null so callers fail safe.
   */
  async listPrivateUploadObjects(
    signal?: AbortSignal,
  ): Promise<PrivateUploadObject[]> {
    const privateObjectDir = this.getPrivateObjectDir().replace(/\/+$/, '');
    const { bucketName, objectName: privatePrefix } =
      parseObjectPath(privateObjectDir);
    const uploadPrefix = `${privatePrefix}/uploads/`;
    const files = await new Promise<File[]>((resolve, reject) => {
      const listedFiles: File[] = [];
      const stream = objectStorageClient.bucket(bucketName).getFilesStream({
        prefix: uploadPrefix,
      });
      const abort = () => {
        stream.destroy(new DOMException('Storage listing aborted', 'AbortError'));
      };
      if (signal?.aborted) {
        abort();
      } else {
        signal?.addEventListener('abort', abort, { once: true });
      }
      stream.on('data', (file: File) => listedFiles.push(file));
      stream.once('error', reject);
      stream.once('end', () => resolve(listedFiles));
      stream.once('close', () => {
        signal?.removeEventListener('abort', abort);
      });
    });

    return files.flatMap((file) => {
      if (!file.name.startsWith(uploadPrefix)) return [];
      const relativeName = file.name.slice(uploadPrefix.length);
      if (!relativeName) return [];

      const rawCreatedAt = file.metadata.timeCreated;
      const createdAt =
        typeof rawCreatedAt === 'string' ? new Date(rawCreatedAt) : null;
      const safeCreatedAt =
        createdAt && Number.isFinite(createdAt.getTime()) ? createdAt : null;
      const rawSize = file.metadata.size;
      const size =
        typeof rawSize === 'string' || typeof rawSize === 'number'
          ? Number(rawSize)
          : Number.NaN;

      return [{
        objectPath: `/objects/uploads/${relativeName}`,
        createdAt: safeCreatedAt,
        ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
      }];
    });
  }

  async getObjectEntityFile(
    objectPath: string,
    verifyExists: boolean = true,
  ): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    if (verifyExists) {
      const [exists] = await objectFile.exists();
      if (!exists) {
        throw new ObjectNotFoundError();
      }
    }
    return objectFile;
  }

  async deleteObjectEntity(
    objectPath: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const objectFile = await this.getObjectEntityFile(objectPath, false);
      if (signal?.aborted) {
        throw new DOMException('Storage deletion aborted', 'AbortError');
      }
      await new Promise<void>((resolve, reject) => {
        const request = objectFile.requestStream({
          method: 'DELETE',
          uri: '',
        });
        let settled = false;
        const settle = (result: { error?: unknown } = {}) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          request.removeListener('error', fail);
          request.removeListener('response', respond);
          if (result.error !== undefined) {
            reject(result.error);
          } else {
            resolve();
          }
        };
        const fail = (error: unknown) => settle({ error });
        const respond = (
          response: NodeJS.ReadableStream & { statusCode?: number },
        ) => {
          response.resume();
          const statusCode = response.statusCode;
          if (
            typeof statusCode === 'number' &&
            statusCode >= 200 &&
            statusCode < 300
          ) {
            settle();
            return;
          }
          const error = new Error(
            `Storage deletion failed with HTTP ${statusCode ?? 'unknown'}`,
          ) as Error & { code?: number };
          error.code = statusCode;
          settle({ error });
        };
        const abort = () => {
          request.destroy(
            new DOMException('Storage deletion aborted', 'AbortError'),
          );
        };
        signal?.addEventListener('abort', abort, { once: true });
        request.once('error', fail);
        request.once('response', respond);
        request.end();
      });
      return true;
    } catch (error) {
      if (
        error instanceof ObjectNotFoundError ||
        (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 404
        )
      ) {
        return false;
      }
      throw error;
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
