---
name: paperproof-protocol
description: Operate the PaperProof protocol for AI agents and developer assistants. Use when a user asks to publish, update, query, verify, inspect, or explain PaperProof artifacts, versions, comments, governance, native prompts, Agent Memory registrations, Walrus content, Sui package/object bindings, wallet readiness, or SDK-based PaperProof workflows. Prefer protocol, SDK, Sui, Walrus, and indexer interfaces over browser automation or website clicking.
---

# PaperProof Protocol

Use this skill as a protocol client guide, not as a website automation guide. Prefer `@paperproof/sdk-ts`, Sui clients, Walrus clients, and indexer APIs. Use the website only for human preview links or when the user explicitly requests browser interaction.

## First Decision

Classify the user request before acting:

- **Publish**: create a new PaperProof artifact series and first version.
- **Add version**: update an existing series without erasing earlier versions.
- **Query**: find artifacts, series, versions, owner activity, events, comments, governance, prompts, or memory entries.
- **Verify**: check chain bindings, canonical events, Walrus content, hashes, deployment IDs, or provenance.
- **Prepare**: choose an artifact type, draft metadata, build a publication checklist, or package files.
- **Operate official registries**: native prompts, Agent Memory registry, governance-controlled availability, or official content publishing.

## Non-Negotiable Rules

- Do not ask for or store private keys, seed phrases, or wallet secrets.
- Do not sign transactions for the user unless the runtime already has an explicit signer chosen by the user.
- Tell the user before any operation that writes to Sui mainnet or Walrus.
- Treat Sui objects, PaperProof events, Walrus blobs, and SDK deployment constants as protocol facts; do not infer facts from website DOM.
- For Walrus-backed artifacts, verify the bytes against the version content hash when the task is verification-sensitive.
- If a write depends on shared Sui objects, rebuild the transaction before retrying.
- If a task touches official registries or governance permissions, confirm the caller has authority before building write transactions.

## Reference Routing

- Read `references/protocol-map.md` for core objects, deployment constants, and package IDs.
- Read `references/artifact-types.md` when selecting an artifact type or filling metadata.
- Read `references/publish-workflows.md` for new publications, add-version flows, comments defaults, and Walrus staging.
- Read `references/query-verify-workflows.md` for reads, canonical event checks, Walrus verification, and reporting.
- Read `references/wallet-and-funding.md` for wallet, SUI, WAL, signing, and balance readiness checks.
- Read `references/official-registries.md` for native prompts, Agent Memory registry, governance control, and official content.
- Read `references/error-handbook.md` when diagnosing failed transactions, relayers, Walrus reads, or Move aborts.
- Read `references/sdk-reference.md` when writing code with the TypeScript SDK.

## Default Execution Pattern

1. Restate the detected task type and any irreversible action.
2. Gather missing inputs: wallet address, target artifact/series, files, metadata, desired visibility, and whether comments should be open or locked.
3. Check readiness: Sui network, deployment constants, wallet balance, WAL/storage path, file hashes, and authority if applicable.
4. Use the SDK or direct protocol APIs to prepare the operation.
5. For writes, return an unsigned transaction or ask the user's wallet/signer to review and sign.
6. After execution, extract and report artifact code, series ID, version ID, comments tree ID, likes book ID, Walrus blob ID/object ID, transaction digest, and preview URL if available.
7. For reads, distinguish missing data, expired Walrus content, non-canonical events, and temporary transport failures.

## Package Baseline

Use the published TypeScript SDK when possible:

```bash
npm install @paperproof/sdk-ts@0.2.6 @mysten/sui@^2.16.0
```

Initialize with:

```ts
import { createPaperProofSDK, MAINNET_DEPLOYMENT } from '@paperproof/sdk-ts';

const paperproof = createPaperProofSDK({ network: 'mainnet' });
```

Use `MAINNET_DEPLOYMENT` unless the user explicitly provides an upgraded deployment manifest.

## Output Style

For user-facing task results, include:

- **What happened**: publish/add-version/query/verify outcome.
- **Protocol IDs**: artifact code, series ID, version ID, blob ID/object ID, and transaction digest when available.
- **Confidence**: verified, partially verified, unavailable, or failed.
- **Next action**: only when the user must sign, top up funds, upload a file, renew a blob, or choose metadata.

