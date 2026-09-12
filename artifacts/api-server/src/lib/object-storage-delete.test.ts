import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { File, Storage } from '@google-cloud/storage';

import { ObjectStorageService } from './objectStorage';

class LocalObjectStorageService extends ObjectStorageService {
  constructor(private readonly localFile: File) {
    super();
  }

  override async getObjectEntityFile(): Promise<File> {
    return this.localFile;
  }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serviceFor(apiEndpoint: string): LocalObjectStorageService {
  const storage = new Storage({
    apiEndpoint,
    projectId: 'storage-delete-test',
    useAuthWithCustomEndpoint: false,
  });
  return new LocalObjectStorageService(
    storage.bucket('test-bucket').file('private/test-object'),
  );
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Storage request timed out')), 1_000);
    }),
  ]);
}

test('actual SDK DELETE resolves on HTTP 204', async () => {
  let method = '';
  const server = createServer((request, response) => {
    method = request.method ?? '';
    response.writeHead(204).end();
  });
  const endpoint = await listen(server);
  try {
    assert.equal(
      await bounded(
        serviceFor(endpoint).deleteObjectEntity('/objects/test-object'),
      ),
      true,
    );
    assert.equal(method, 'DELETE');
  } finally {
    await close(server);
  }
});

test('actual SDK DELETE maps HTTP 404 to an absent object', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const endpoint = await listen(server);
  try {
    assert.equal(
      await bounded(
        serviceFor(endpoint).deleteObjectEntity('/objects/test-object'),
      ),
      false,
    );
  } finally {
    await close(server);
  }
});

test('actual SDK DELETE rejects an HTTP failure status', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503).end();
  });
  const endpoint = await listen(server);
  try {
    await assert.rejects(
      bounded(serviceFor(endpoint).deleteObjectEntity('/objects/test-object')),
      (error: Error & { code?: number }) =>
        error.code === 503 && /HTTP 503/.test(error.message),
    );
  } finally {
    await close(server);
  }
});

test('actual SDK DELETE aborts a hanging request', async () => {
  let requestReceived!: () => void;
  const received = new Promise<void>((resolve) => {
    requestReceived = resolve;
  });
  const server = createServer(() => {
    requestReceived();
  });
  const endpoint = await listen(server);
  const controller = new AbortController();
  try {
    const deletion = serviceFor(endpoint).deleteObjectEntity(
      '/objects/test-object',
      controller.signal,
    );
    await bounded(received);
    controller.abort();
    await assert.rejects(
      bounded(deletion),
      (error: Error) => error.name === 'AbortError',
    );
  } finally {
    await close(server);
  }
});