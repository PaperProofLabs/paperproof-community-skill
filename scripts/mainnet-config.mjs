#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

const config = {
  name: 'paperproof-mainnet-2026-05-13',
  network: 'mainnet',
  rpcUrl: 'https://fullnode.mainnet.sui.io:443',
  protocolVersion: 'publishing-v3-governance-v2-comments-v2',
  packages: {
    pprf: '0x5d2ec9829a9e116de7c2008281a90b96690beb2252af120ad05a25fe13fae0da',
    governanceOriginal: '0x75923624e354789e995537e88afaab698bd405a61f91926e3f8837fb7cc6b5cf',
    governance: '0xc1ced3b8ae5281eeeb8cdb5527978e294c54f14a7fd8d65e7e9502d4ffffb87e',
    comments: '0xaef346fc40bf20af62f4bbbc1608ba2272e80e4ba3d716634026baa589e9aeba',
    publishing: '0xc9a75e4514db2a37df6f95b4e2b329c065ac6089953bd2c1c0a0c389835bd3d8',
    promptRegistry: '0x10b9c6e90a896dc3244d047e32724d80de0dc697b5ea12c5fdd8925131ed4c59',
    memoryRegistry: '0x816684a152fdee1e7f15f65d18873ed7ee48540e8bd4205b3197a5ec0feda2c6',
  },
  objects: {
    root: '0x7dc6c78b276825499a2204b060394e80b81196eb1f77d2036b503a2cca15dd78',
    typeRegistry: '0x966ffa24d0a96b34267b62c628f39c830afc9de25438b6502835fa8a3815d6b5',
    feeManager: '0x7bb8360ea1fa50f923628c929b8726b00eb8968c6a678acde71f97ae146e9249',
    governanceVault: '0x0df35aa53ef37f8ca8f6a6280d743effa6e0bfc613c5c6c0a78318ad4a38f875',
    governanceConfig: '0x7ed018db6b2cd7c32692a1c33543fb90d9c36add1226f93cbeb2a8fb10955dfa',
    promptRegistry: '0x14ec45eb83bb1b0eb22c7e885c7c71ea05b1e22dd05e3e1107dcef528600b0da',
    memoryRegistry: '0x9a5beeb6610b33c06771c4152c039314784437e802e200afd2ce80fb88bdf9e2',
    clock: '0x6',
  },
  coinTypes: {
    pprf: '0x5d2ec9829a9e116de7c2008281a90b96690beb2252af120ad05a25fe13fae0da::pprf::PPRF',
    wal: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
    sui: '0x2::sui::SUI',
  },
};

console.log(JSON.stringify(config, null, 2));
