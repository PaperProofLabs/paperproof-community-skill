#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fail, parseArgs, printJson, requireArg } from './lib/cli.mjs';

async function main() {
  const args = parseArgs();
  const id = requireArg(args, 'id');
  const url = typeof args.rpc === 'string' ? args.rpc : 'https://fullnode.mainnet.sui.io:443';
  const client = new SuiGrpcClient({ baseUrl: url, network: 'mainnet' });
  const object = await client.getObject({
    objectId: id,
    include: {
      json: true,
      owner: true,
      previousTransaction: true,
      display: true,
    },
  });
  printJson({ ok: true, network: 'mainnet', rpcUrl: url, object });
}

main().catch(fail);
