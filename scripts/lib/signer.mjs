// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fromBase64 } from '@mysten/bcs';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeAddress(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/^"|"$/g, '');
  const noPrefix = raw.startsWith('0x') ? raw.slice(2) : raw.startsWith('x') ? raw.slice(1) : raw;
  return `0x${noPrefix.padStart(64, '0')}`;
}

export function parseEnv(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(match[1], value);
  }
  return values;
}

function readJsonIfExists(filePath) {
  if (!fsSync.existsSync(filePath)) return null;
  return JSON.parse(fsSync.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (!value) {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
      continue;
    }
    if (value === '~') value = null;
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parent[key] = value;
  }
  return root;
}

async function readEnvMap(envPath) {
  if (!envPath) return new Map(Object.entries(process.env));
  const text = await fs.readFile(path.resolve(envPath), 'utf8');
  return parseEnv(text);
}

function signerFromSecret(address, secret, label) {
  const normalizedAddress = normalizeAddress(address);
  const signer = keypairFromEncodedSecret(secret, label);
  assert(normalizeAddress(signer.toSuiAddress()) === normalizedAddress, `${label} signer mismatch.`);
  return { address: normalizedAddress, signer };
}

function keypairFromEncodedSecret(secret, label) {
  try {
    const decoded = decodeSuiPrivateKey(secret);
    assert(decoded.scheme === 'ED25519', `${label} must use an Ed25519 key.`);
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  } catch {
    const raw = fromBase64(secret);
    if (raw.length === 33 && raw[0] === 0) return Ed25519Keypair.fromSecretKey(raw.slice(1));
    if (raw.length === 32) return Ed25519Keypair.fromSecretKey(raw);
    throw new Error(`${label} is not a supported Ed25519 private key encoding.`);
  }
}

function cliConfigDir(args, options = {}) {
  return path.resolve(
    args.cliConfigDir
      ?? args['cli-config-dir']
      ?? options.cliConfigDir
      ?? path.join(os.homedir(), '.sui', 'sui_config'),
  );
}

function readCliClientConfig(configDir, args, options = {}) {
  const clientYaml = path.resolve(
    args.cliClientYaml
      ?? args['cli-client-yaml']
      ?? options.cliClientYaml
      ?? path.join(configDir, 'client.yaml'),
  );
  assert(fsSync.existsSync(clientYaml), `Sui CLI client config not found: ${clientYaml}.`);
  const parsed = parseSimpleYaml(fsSync.readFileSync(clientYaml, 'utf8').replace(/^\uFEFF/, ''));
  return { clientYaml, parsed };
}

function readCliAliases(configDir, args, options = {}) {
  const aliasesPath = path.resolve(
    args.cliAliases
      ?? args['cli-aliases']
      ?? options.cliAliases
      ?? path.join(configDir, 'sui.aliases'),
  );
  const aliases = readJsonIfExists(aliasesPath);
  return Array.isArray(aliases) ? aliases : [];
}

export async function loadCliKeystoreSigners(args = {}, options = {}) {
  const configDir = cliConfigDir(args, options);
  const { clientYaml, parsed } = readCliClientConfig(configDir, args, options);
  const configuredKeystore = parsed?.keystore?.File;
  const keystorePath = path.resolve(
    args.cliKeystore
      ?? args['cli-keystore']
      ?? options.cliKeystore
      ?? configuredKeystore
      ?? path.join(configDir, 'sui.keystore'),
  );
  assert(fsSync.existsSync(keystorePath), `Sui CLI keystore not found: ${keystorePath}.`);
  const encodedKeys = readJsonIfExists(keystorePath);
  assert(Array.isArray(encodedKeys) && encodedKeys.length > 0, `Sui CLI keystore is empty: ${keystorePath}.`);

  const aliasRecords = readCliAliases(configDir, args, options);
  const aliasByAddress = new Map();
  const addressByAlias = new Map();
  for (const item of aliasRecords) {
    if (!item?.alias || !item?.public_key_base64) continue;
    addressByAlias.set(String(item.alias), null);
  }

  const accounts = encodedKeys.map((encoded, index) => {
    const signer = keypairFromEncodedSecret(encoded, `CLI keystore entry ${index + 1}`);
    const address = normalizeAddress(signer.toSuiAddress());
    return { index: index + 1, address, signer, source: 'cli-keystore' };
  });

  for (const aliasRecord of aliasRecords) {
    if (!aliasRecord?.alias || !aliasRecord?.public_key_base64) continue;
    for (const account of accounts) {
      if (account.signer.getPublicKey().toBase64() === aliasRecord.public_key_base64) {
        account.alias = String(aliasRecord.alias);
        aliasByAddress.set(account.address, account.alias);
        addressByAlias.set(account.alias, account.address);
        break;
      }
    }
  }

  const cliAddress = args.cliAddress ?? args['cli-address'];
  const cliAlias = args.cliAlias ?? args['cli-alias'];
  if (cliAlias) {
    const aliasedAddress = addressByAlias.get(String(cliAlias));
    assert(aliasedAddress, `Sui CLI alias not found in ${path.join(configDir, 'sui.aliases')}: ${cliAlias}.`);
    const match = accounts.find((item) => item.address === aliasedAddress);
    assert(match, `Sui CLI alias ${cliAlias} does not map to a key present in ${keystorePath}.`);
    return [match];
  }
  if (cliAddress) {
    const normalized = normalizeAddress(cliAddress);
    const match = accounts.find((item) => item.address === normalized);
    assert(match, `Sui CLI keystore does not contain address ${normalized}.`);
    return [match];
  }

  const activeAddress = parsed?.active_address ? normalizeAddress(parsed.active_address) : null;
  if (activeAddress) {
    const match = accounts.find((item) => item.address === activeAddress);
    assert(match, `Active Sui CLI address ${activeAddress} is not present in ${keystorePath}.`);
    return [match];
  }

  assert(accounts.length === 1, `Sui CLI keystore has ${accounts.length} accounts and no active address. Use --cli-address=<0x...> or --cli-alias=<name>.`);
  return accounts;
}

function signerModeUsage() {
  return [
    'Supported signer sources:',
    '  --signer-mode=single-env   use ADDRESS / PRIVATE_KEY in the chosen env',
    '  --signer-mode=indexed-env  use ADDR_1 / PRIVATE_KEY_1 style indexed slots',
    '  --signer-mode=cli-keystore use the local Sui CLI keystore and active address',
    'Hints:',
    '  --signer-env=<path>        explicit env file for single-env or indexed-env',
    '  --cli-config-dir=<path>    explicit Sui CLI config dir containing client.yaml',
    '  --cli-address=<0x...>      pick one CLI keystore address explicitly',
    '  --cli-alias=<name>         pick one CLI alias explicitly',
  ].join('\n');
}

function enrichSignerError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`${detail}\n${signerModeUsage()}`);
}

export async function loadSingleSigner({
  envPath,
  addressVar = 'ADDRESS',
  privateKeyVar = 'PRIVATE_KEY',
}) {
  const env = await readEnvMap(envPath);
  const address = env.get(addressVar);
  const secret = env.get(privateKeyVar);
  assert(address, `Missing ${addressVar} in signer environment.`);
  assert(secret, `Missing ${privateKeyVar} in signer environment.`);
  return signerFromSecret(address, secret, addressVar);
}

export async function loadIndexedAccounts({
  envPath,
  maxAccounts = 16,
  addressPrefix = 'ADDR_',
  privateKeyPrefix = 'PRIVATE_KEY_',
}) {
  const env = await readEnvMap(envPath);
  const accounts = [];
  for (let index = 1; index <= maxAccounts; index += 1) {
    const address = env.get(`${addressPrefix}${index}`);
    const secret = env.get(`${privateKeyPrefix}${index}`);
    if (!address || !secret) continue;
    const account = signerFromSecret(address, secret, `${addressPrefix}${index}`);
    accounts.push({ index, ...account });
  }
  assert(accounts.length > 0, 'No usable signer accounts found in signer environment.');
  return accounts;
}

export async function loadSignerSet(args, options = {}) {
  const mode = String(
    args.signerMode
      ?? args['signer-mode']
      ?? options.defaultMode
      ?? 'auto',
  ).toLowerCase();
  const envPath = args.signerEnv ?? args['signer-env'] ?? options.envPath;
  if (mode === 'single-env') {
    const account = await loadSingleSigner({
      envPath,
      addressVar: args.addressVar ?? args['address-var'] ?? options.addressVar,
      privateKeyVar: args.privateKeyVar ?? args['private-key-var'] ?? options.privateKeyVar,
    });
    return [account];
  }
  if (mode === 'indexed-env') {
    try {
      return await loadIndexedAccounts({
        envPath,
        maxAccounts: Number(args.maxAccounts ?? args['max-accounts'] ?? options.maxAccounts ?? 16),
        addressPrefix: args.addressPrefix ?? args['address-prefix'] ?? options.addressPrefix,
        privateKeyPrefix: args.privateKeyPrefix ?? args['private-key-prefix'] ?? options.privateKeyPrefix,
      });
    } catch (error) {
      enrichSignerError(error);
    }
  }
  if (mode === 'cli-keystore') {
    try {
      return await loadCliKeystoreSigners(args, options);
    } catch (error) {
      enrichSignerError(error);
    }
  }
  if (mode !== 'auto') {
    throw new Error(`Unsupported --signer-mode=${mode}. Use auto, single-env, indexed-env, or cli-keystore.`);
  }

  try {
    const account = await loadSingleSigner({
      envPath,
      addressVar: args.addressVar ?? args['address-var'] ?? options.addressVar,
      privateKeyVar: args.privateKeyVar ?? args['private-key-var'] ?? options.privateKeyVar,
    });
    return [account];
  } catch {}

  try {
    return await loadIndexedAccounts({
      envPath,
      maxAccounts: Number(args.maxAccounts ?? args['max-accounts'] ?? options.maxAccounts ?? 16),
      addressPrefix: args.addressPrefix ?? args['address-prefix'] ?? options.addressPrefix,
      privateKeyPrefix: args.privateKeyPrefix ?? args['private-key-prefix'] ?? options.privateKeyPrefix,
    });
  } catch {}

  try {
    return await loadCliKeystoreSigners(args, options);
  } catch (error) {
    enrichSignerError(error);
  }
}
