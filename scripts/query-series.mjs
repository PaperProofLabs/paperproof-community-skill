#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import { fail, parseArgs, printJson, requireArg } from './lib/cli.mjs';

async function loadSdk() {
  try {
    return await import('@paperproof/sdk-ts');
  } catch (error) {
    throw new Error(`Cannot load @paperproof/sdk-ts. Install with: npm install @paperproof/sdk-ts@0.2.7 @mysten/sui. ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const args = parseArgs();
  const seriesId = requireArg(args, 'series');
  const { createPaperProofSDK } = await loadSdk();
  const sdk = createPaperProofSDK({
    network: 'mainnet',
    transport: args.transport === 'jsonrpc' ? 'jsonrpc' : 'grpc',
    queryTransport: 'none',
    ...(typeof args.rpc === 'string' ? { rpcUrl: args.rpc } : {}),
  });
  const details = await sdk.query.getSeriesDetails(seriesId);
  printJson({ ok: true, network: sdk.network, transport: sdk.transport, seriesId, details });
}

main().catch(fail);
