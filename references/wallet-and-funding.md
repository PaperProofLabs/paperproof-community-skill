# Wallet and Funding

PaperProof writes require a Sui wallet and enough assets for the chosen operation. The skill must never request private keys, seed phrases, or raw wallet secrets.

## Wallet Data to Request

Ask only for:

- public wallet address;
- target network, normally `mainnet`;
- whether the user wants to sign in a browser wallet, CLI wallet, hosted agent wallet, or external transaction service.

Never ask for:

- seed phrase;
- private key;
- mnemonic;
- keystore password unless the user is operating their own local CLI and explicitly asks for CLI help.

## Balance Checks

Check:

- SUI balance for gas and protocol fees;
- WAL balance or storage capability for Walrus upload/extension;
- PPRF balance only for governance, voting, or protocol features that require it.

If exact fee estimation is unavailable, report that the check is approximate and ask the wallet to simulate or dry-run.

## Signing Model

- Browser apps should build unsigned PTBs and delegate signing to wallet adapters.
- Node tools may use an explicit signer only if the user has already configured it in that environment.
- When a helper supports multiple signer modes, prefer these in order: unsigned/dry-run, browser wallet, local CLI/keystore, then environment-managed signer material.
- AI agents should prepare transactions and explain them before execution.
- For mainnet writes, give the user the action label and the IDs that will be touched.

Supported local signer patterns in the current community helpers:

- `single-env`: `ADDRESS` + `PRIVATE_KEY`
- `indexed-env`: `ADDR_1`, `PRIVATE_KEY_1`, `ADDR_2`, `PRIVATE_KEY_2`, ...
- `cli-keystore`: `~/.sui/sui_config/client.yaml` + `sui.keystore`, optionally narrowed by `--cli-address` or `--cli-alias`

Operator guidance:

- Do not ask the user to paste a private key into chat.
- If signer discovery fails, ask only for a signer file path, CLI config directory, target public address, or target alias.
- If the CLI keystore contains multiple addresses and no active address, require `--cli-address` or `--cli-alias` instead of guessing.

## WAL and Walrus

Walrus operations may involve reserving storage, writing blobs, certifying availability, extending epochs, or transferring blob objects. These steps are not always atomic with PaperProof chain registration.

When the user asks whether they can publish, check both:

- whether content can be written to Walrus;
- whether the PaperProof registration transaction can be paid on Sui.

## Read-Only Tasks

Query and verification tasks normally do not need wallet signing. They may need network access to Sui, Walrus, or an indexer.

## Insufficient Funds Response

Tell the user:

- which asset is missing;
- estimated required amount if known;
- current detected amount if available;
- whether retry is reasonable after top-up;
- whether partial read-only verification can still proceed.
