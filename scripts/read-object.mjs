#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { fail, parseArgs, printJson, requireArg } from './lib/cli.mjs';

async function main() {
  const args = parseArgs();
  const id = requireArg(args, 'id');
  const url = typeof args.rpc === 'string' ? args.rpc : 'https://fullnode.mainnet.sui.io:443';
  const client = new SuiJsonRpcClient({ url });
  const object = await client.getObject({
    id,
    options: {
      showType: true,
      showOwner: true,
      showPreviousTransaction: true,
      showContent: true,
      showDisplay: true,
    },
  });
  printJson({ ok: true, network: 'mainnet', rpcUrl: url, object });
}

main().catch(fail);
