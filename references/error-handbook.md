# Error Handbook

Diagnose by layer. Do not collapse every failure into a generic publish failure.

## Layers

- **Input validation**: malformed object ID, empty title, oversized text, invalid content type.
- **Wallet state**: no address, wrong network, insufficient SUI/WAL/PPRF, missing signer.
- **Walrus**: upload failed, blob expired, blob not certified, relayer unavailable, CORS/preflight blocked.
- **Sui transport**: RPC/gRPC endpoint unavailable, stale shared object version, timeout.
- **Move abort**: protocol rejected the transaction.
- **Indexer**: lagging, incomplete page, unavailable API.
- **Rendering**: content downloaded but package decoding or Markdown rendering failed.

## Common PaperProof Issues

| Symptom | Likely cause | Response |
|---|---|---|
| Blob body loads forever | Walrus blob unreadable, expired, or content type mismatch | Check version header and read blob directly |
| Markdown package appears as gibberish | Zip package was not decompressed before rendering | Decode package, then render Markdown entry |
| No artifacts on first page but Load more works | initial query window has no matching type | Treat as pagination behavior unless indexer query is wrong |
| MoveAbort on memory create, no active entry expected | active entry already exists | Read active entry, switch button/action to delete or update |
| MemWal relayer request failed | relayer/network/CORS issue | Explain memory save unavailable; keep other Copilot features usable |
| Invalid params from chain read | wrong provider method shape or object/event query params | Check SDK provider adapter and endpoint compatibility |
| Stale shared object error | transaction built against old shared object versions | Rebuild PTB and retry once |
| `add-version-from-local-file.mjs` fails with `fetch failed` during Walrus upload | local gRPC transport is unstable while upload relay HTTP is still usable | Retry with the helper's manual Walrus fallback path, which builds register/certify transactions locally and keeps the same add-version workflow |
| `publish-blog-post-from-local-file.mjs` or another publish helper shows `BlobRegistered` success, but later fails on `certify` | Walrus shared objects changed version between register and certify | Wait for the blob object to become readable, rebuild the certify PTB, and treat this as a Walrus-stage conflict rather than a content or metadata problem |
| `ECONNRESET` or TLS reset before RPC handshake | endpoint path is unstable before gRPC can complete | Retry the helper with the same `--transport=grpc` settings and keep the exact RPC URL in the report |
| gRPC `GetFunction` / `GetBalance` / `UNAVAILABLE` | gRPC provider path is degraded | Retry with backoff, keep `--transport=grpc`, and separate "confirmation failed" from "transaction failed" in the operator report |
| Object read failure such as `getObject` or dynamic field resolution error | endpoint reachable but object read path is flaky | Retry with backoff, then separate "confirmation failed" from "transaction failed" in the operator report |
| Upload and transaction digest exist but `latestVersionConfirmed=false` | write may have succeeded, but readback confirmation path failed | Do not assume add-version failed; re-run the helper's confirmation command or `query-series.mjs` |
| Walrus upload failed after several `BlobRegistered` successes from the same signer | earlier attempts may already have left usable blob objects on-chain | Query recent transactions and blob objects before re-uploading the same bytes; if a certified blob exists, reuse it rather than starting from zero |
| Add-version is rejected on a valid owned series after controller/NFT rollout | the series is controller-managed but the transaction was built without the required controller binding | Re-read the series, inspect controller fields, and rebuild with `controlRecordId`, `controllerNftId`, and `versionChangeNote` |
| Artifact detail or API output appears to use the same text for description and changelog | downstream tool collapsed `seriesDescription` and `versionChangeNote` | Re-read series and version views separately and report them by their distinct meanings |

## Operator Notes

For community publish helpers, classify failures in this order:

- preflight failed before any write
- Walrus upload failed before transaction submission
- transaction submission failed
- chain result could not be observed from returned events
- latest version confirmation failed after a transaction digest was obtained

For controller-bound add-version flows, also classify:

- controller-binding mismatch before transaction submission
- controller NFT / control record resolution failure
- controller authority rejection from Move

For new `blogPost` publication, use a parallel classification:

- preflight failed before any write
- Walrus register failed
- Walrus certify failed after a successful register
- PaperProof publish transaction failed
- published artifact confirmation failed

`Walrus certify failed after a successful register` is especially important:
this often means the bytes and signer were fine, and the failure was caused by
shared-object churn on Walrus mainnet rather than by the PaperProof protocol.

Only the first three states should be treated as clear publish failures. The last two require follow-up confirmation before concluding the chain write failed.

## Move Abort Guidance

Use SDK abort explainers when available. Report:

- package/module/function if known;
- abort code;
- command index;
- user-level explanation;
- whether retrying helps.

Never recommend repeated retries for deterministic permission, active-entry, type-disabled, paused, or invalid-governance aborts.

## CORS and Static Sites

Browser clients cannot bypass CORS by changing frontend code. Use:

- browser-compatible endpoints;
- a server-side proxy;
- local Vite proxy during demos;
- direct Node.js scripts for agent operations.

If the official static site cannot reach a relayer, only the dependent feature should degrade.

## Expired Walrus Content

If a Walrus blob is expired or unavailable:

1. Keep chain metadata visible.
2. Report that bytes are not currently readable.
3. Check whether a newer version exists.
4. If the user owns the blob object and wants recovery/renewal, use Walrus extension flow where possible.

