#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/file-digest.mjs <file> [content-type]');
  process.exit(2);
}

const hash = createHash('sha256');
const stream = createReadStream(file);

stream.on('data', (chunk) => hash.update(chunk));
stream.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
stream.on('end', () => {
  const stat = statSync(file);
  const result = {
    filename: basename(file),
    fileSize: stat.size,
    contentHash: `sha256:${hash.digest('hex')}`,
    contentType: process.argv[3] ?? 'application/octet-stream',
  };
  console.log(JSON.stringify(result, null, 2));
});

