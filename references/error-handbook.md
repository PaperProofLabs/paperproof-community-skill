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

