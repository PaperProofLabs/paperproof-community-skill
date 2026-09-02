#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from 'node:url';

import { fail, parseArgs, pickDefined, printJson } from './lib/cli.mjs';

async function loadSdk() {
  try {
    return await import('@paperproof/sdk-ts');
  } catch (error) {
    throw new Error(`Cannot load @paperproof/sdk-ts. Install with: npm install @paperproof/sdk-ts@0.3.0 @mysten/sui. ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function resolveQueryTransport(args) {
  if (args.queryTransport && String(args.queryTransport).toLowerCase() !== 'graphql') {
    throw new Error('query-events only supports GraphQL queries now. Use --query-transport=graphql or omit the flag.');
  }
  return 'graphql';
}

async function main() {
  const args = parseArgs();
  const { createPaperProofSDK, MAINNET_DEPLOYMENT } = await loadSdk();
  const queryTransport = resolveQueryTransport(args);
  const sdk = createPaperProofSDK({
    network: 'mainnet',
    transport: 'grpc',
    queryTransport,
    ...(typeof args.rpc === 'string' ? { rpcUrl: args.rpc } : {}),
    ...(typeof args.graphql === 'string' ? { graphQLEndpoint: args.graphql } : {}),
  });
  const module = typeof args.module === 'string' ? args.module : undefined;
  const event = typeof args.event === 'string' ? args.event : undefined;
  const moveEventType = typeof args.moveEventType === 'string'
    ? args.moveEventType
    : module && event
      ? `${MAINNET_DEPLOYMENT.packages.publishing}::${module}::${event}`
      : undefined;
  const page = await sdk.query.queryTrustedEvents(pickDefined({
    moveEventType,
    sender: typeof args.sender === 'string' ? args.sender : undefined,
    limit: args.limit ? Number(args.limit) : 20,
    descendingOrder: args.ascending ? false : true,
    trust: args.trust === 'raw' || args.trust === 'verified' ? args.trust : 'canonical',
    includeRejected: Boolean(args.includeRejected),
  }));
  printJson({
    ok: true,
    network: sdk.network,
    provider: page.provider,
    moveEventType,
    guidance: 'This diagnostic helper is bounded. For broad public mainnet discovery, prefer a PaperProof indexer or checkpoint-backed pipeline.',
    page,
  });
}

const directRunTarget = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (directRunTarget && import.meta.url === directRunTarget) {
  main().catch(fail);
}
