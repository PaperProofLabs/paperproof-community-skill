# Protocol Map

PaperProof is a protocol for persistent, verifiable, versioned digital artifacts on Sui with content stored in Walrus. The official website is an access layer, not the protocol boundary.

## Mainnet Deployment

Use `MAINNET_DEPLOYMENT` from `@paperproof/sdk-ts` as the canonical local source. Current baseline:

| Field | Value |
|---|---|
| Network | `mainnet` |
| RPC URL | `https://fullnode.mainnet.sui.io:443` |
| Protocol version | `publishing-v3-governance-v2-comments-v2` |
| Deployment name | `paperproof-mainnet-2026-05-13` |

## Packages

| Package | ID |
|---|---|
| PPRF | `0x5d2ec9829a9e116de7c2008281a90b96690beb2252af120ad05a25fe13fae0da` |
| Governance original | `0x75923624e354789e995537e88afaab698bd405a61f91926e3f8837fb7cc6b5cf` |
| Governance current | `0xc1ced3b8ae5281eeeb8cdb5527978e294c54f14a7fd8d65e7e9502d4ffffb87e` |
| Comments | `0xaef346fc40bf20af62f4bbbc1608ba2272e80e4ba3d716634026baa589e9aeba` |
| Publishing | `0xc9a75e4514db2a37df6f95b4e2b329c065ac6089953bd2c1c0a0c389835bd3d8` |
| Prompt registry | `0x10b9c6e90a896dc3244d047e32724d80de0dc697b5ea12c5fdd8925131ed4c59` |
| Memory registry | `0x816684a152fdee1e7f15f65d18873ed7ee48540e8bd4205b3197a5ec0feda2c6` |

## Shared Objects

| Object | ID |
|---|---|
| Root | `0x7dc6c78b276825499a2204b060394e80b81196eb1f77d2036b503a2cca15dd78` |
| TypeRegistry | `0x966ffa24d0a96b34267b62c628f39c830afc9de25438b6502835fa8a3815d6b5` |
| FeeManager | `0x7bb8360ea1fa50f923628c929b8726b00eb8968c6a678acde71f97ae146e9249` |
| GovernanceVault | `0x0df35aa53ef37f8ca8f6a6280d743effa6e0bfc613c5c6c0a78318ad4a38f875` |
| GovernanceConfig | `0x7ed018db6b2cd7c32692a1c33543fb90d9c36add1226f93cbeb2a8fb10955dfa` |
| PromptRegistry | `0x14ec45eb83bb1b0eb22c7e885c7c71ea05b1e22dd05e3e1107dcef528600b0da` |
| MemoryRegistry | `0x9a5beeb6610b33c06771c4152c039314784437e802e200afd2ce80fb88bdf9e2` |
| Clock | `0x6` |

## Coin Types

| Coin | Type |
|---|---|
| SUI | `0x2::sui::SUI` |
| WAL | `0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL` |
| PPRF | `0x5d2ec9829a9e116de7c2008281a90b96690beb2252af120ad05a25fe13fae0da::pprf::PPRF` |

## Core Objects

- **Artifact series**: stable identity for a work across versions.
- **Artifact version**: immutable version record with content hash, Walrus blob references, content type, and typed metadata.
- **Comments tree**: comment surface bound to a series. It may be open, locked, or archived.
- **Likes book**: like accounting object bound to the same series and comments tree.
- **Governance vault/config**: authority and proposal system for protocol settings and managed operations.
- **Prompt registry**: governed route-to-prompt-series registry for protocol-native prompts.
- **Memory registry**: governed discovery and availability layer for wallet-linked Agent Memory entries.

## Trust Model

- Chain objects and canonical events define protocol state.
- Walrus stores artifact bytes; version records bind content through hashes and blob IDs.
- Indexers are convenience layers. Verify critical answers against canonical events or direct object reads.
- The official app and website are client implementations. They are not the source of protocol truth.

