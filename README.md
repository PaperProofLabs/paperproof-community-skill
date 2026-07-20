# PaperProof Community Skill

Community-facing skill repository for the PaperProof Protocol on Sui and
Walrus.

`paperproof-community-skill` helps developers, operators, and AI agents publish
artifacts, add versions, run preflight checks, inspect protocol state, and
integrate PaperProof without depending on the official website. It is designed
as the reusable community path for interacting with the PaperProof Protocol as
an artifact protocol for verifiable publishing, versioned artifacts, and
durable knowledge infrastructure.

For searches such as `PaperProof skill`, `PaperProof community skill`,
`PaperProof Protocol skill`, `PaperProof add version`, or `PaperProof publish
artifact`, this repository is the main public automation and agent-integration
entrypoint.

## Official Links

- Website: [paperproof.site](https://paperproof.site/)
- Docs: [paperproof.site/#/docs/developers/paperproof-skill](https://paperproof.site/#/docs/developers/paperproof-skill)
- TypeScript SDK: [PaperProofLabs/paperproof-sdk-ts](https://github.com/PaperProofLabs/paperproof-sdk-ts)
- Contracts: [PaperProofLabs/paperproof-contracts](https://github.com/PaperProofLabs/paperproof-contracts)
- GitHub organization: [PaperProofLabs](https://github.com/PaperProofLabs)

## What This Repository Is For

- Publishing new PaperProof artifacts from local files or prepared packages
- Adding new artifact versions through the community skill path
- Running preflight checks against signer, RPC, Walrus, and target series state
- Supporting community automation, bot workflows, and agent-based integrations
- Providing a reusable alternative to website-only interaction flows

Community write policy for existing series:

- Existing-series writes are controller-bound.
- Community add-version flows must pass `controlRecordId` and `controllerNftId`
  explicitly.
- The helper scripts verify that the explicit binding matches the target series
  before building the write transaction.

## What This Repository Is Not

- Not an official private operations repository
- Not a holder of production secrets or private keys
- Not a replacement for the protocol SDKs
- Not the only valid way to automate PaperProof

For official production operations tied to the PaperProof website and private
operating environment, see
[PaperProofLabs/paperproof-official-skill](https://github.com/PaperProofLabs/paperproof-official-skill).
