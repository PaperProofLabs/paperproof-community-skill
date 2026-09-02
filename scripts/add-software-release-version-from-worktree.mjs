#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_TYPES,
  PaperProofTxBuilder,
  extractAddVersionResult,
  robustExecuteTransaction,
  robustWalrusWriteBlob,
  stringifyForJson,
} from '@paperproof/sdk-ts';

import { loadSignerSet, normalizeAddress } from './lib/signer.mjs';
import {
  confirmLatestVersion,
  createResultError,
  createSkillRuntime,
  getArg,
  rawGetObject,
  runPublishPreflight,
} from './lib/publish-runtime.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

function usage() {
  return `
Package the current worktree as a zip and add it as a new softwareRelease version.

Usage:
  node scripts/add-software-release-version-from-worktree.mjs --series=<seriesId> --control-record=<id> --controller-nft=<id> --preflight --signer-env=<env> --account=4
  node scripts/add-software-release-version-from-worktree.mjs --series=<seriesId> --control-record=<id> --controller-nft=<id> --run --signer-env=<env> --account=4

Options:
  --series=<seriesId>                target software release series
  --project-name=<name>             defaults to current version projectName
  --version-name=<name>             defaults to v<nextVersion>
  --repository-url=<url>            defaults to current version repositoryUrl
  --license=<spdx>                  defaults to current version license
  --changelog=<text>                defaults to a generated note
  --source-hash=<text>              defaults to git:<shortsha>[+dirty]
  --control-record=<id>             required controller control record id
  --controller-nft=<id>             required controller NFT id
  --report-dir=<dir>                defaults to ./artifacts
  --output-zip=<path>               defaults to ./artifacts/<project>-<timestamp>.zip
  --signer-mode=auto|single-env|indexed-env|cli-keystore
  --cli-address=<0x...>
  --cli-alias=<name>
  --rpc=<url>
  --transport=grpc
  --query-transport=none|graphql
  --walrus-relay=<url>
`.trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { run: false, help: false, preflight: false };
  for (const item of argv) {
    if (item === '--run') args.run = true;
    else if (item === '--preflight' || item === '--preflight-only') args.preflight = true;
    else if (item === '--help' || item === '-h') args.help = true;
    else if (item.startsWith('--')) {
      const index = item.indexOf('=');
      if (index === -1) args[item.slice(2)] = true;
      else args[item.slice(2, index)] = item.slice(index + 1);
    }
  }
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadAccount(args, required) {
  const envSpecified = Boolean(getArg(args, 'signerEnv', 'signer-env'));
  const mode = args.signerMode ?? args['signer-mode'] ?? (args.account ? 'indexed-env' : 'auto');
  if (!required && !envSpecified && !args.account) return null;
  try {
    const accounts = await loadSignerSet(args, { defaultMode: mode });
    const requested = Number(args.account ?? 4);
    const account = (args.account || mode === 'indexed-env')
      ? accounts.find((item) => item.index === requested)
      : accounts[0];
    assert(account, `No signer account available for selection ${requested}.`);
    return { ok: true, account: requested, address: account.address, signer: account.signer };
  } catch (error) {
    if (!required) return { ...createResultError('signer', error), ok: false };
    throw error;
  }
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function execCapture(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function makeZip(outputZip) {
  await fs.mkdir(path.dirname(outputZip), { recursive: true });
  await execCapture('git', ['archive', '--format=zip', '--output', outputZip, 'HEAD'], SKILL_ROOT);
}

async function readFileInfo(filePath) {
  const bytes = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    fullPath: filePath,
    bytes,
    fileSize: stat.size,
    contentHash: `sha256:${sha256Hex(bytes)}`,
  };
}

async function uploadContent(runtime, signer, fileInfo, label) {
  const upload = await robustWalrusWriteBlob(runtime.walrusClient, signer, fileInfo.bytes, {
    label: label.slice(0, 96),
    fallback: false,
    attempts: runtime.retryAttempts,
    baseDelayMs: runtime.retryBaseDelayMs,
    epochs: 10,
    owner: signer.toSuiAddress(),
  });
  return {
    blobId: upload.blobId,
    blobObjectId: upload.blobObjectId,
    byteLength: fileInfo.fileSize,
    strategy: 'sdk-write-blob',
  };
}

function toSdkResponse(execution) {
  return {
    events: (execution.events ?? []).map((event) => ({
      type: event.type,
      packageId: event.packageId ?? event.type?.split('::')[0],
      transactionModule: event.transactionModule,
      sender: event.sender,
      parsedJson: event.parsedJson,
    })),
  };
}

function confirmationCommand(args, runtime) {
  const bits = [
    'node .\\scripts\\query-series.mjs',
    `--series=${args.series}`,
    `--transport=${runtime.transport}`,
    `--query-transport=${runtime.queryTransport}`,
    `--rpc=${runtime.rpcUrl}`,
  ];
  return bits.join(' ');
}

async function writeReport(reportDir, prefix, report) {
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${prefix}-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${stringifyForJson(report)}\n`, 'utf8');
  return reportPath;
}

function isControllerManagedSeries(details) {
  return Boolean(
    details?.series?.seriesControlEnabled
    || details?.series?.seriesControlRecordId
    || details?.series?.seriesControllerNftId,
  );
}

function objectFieldsFromRead(result) {
  return result?.data?.content?.fields
    ?? result?.content?.fields
    ?? result?.object?.content?.fields
    ?? result?.object?.json
    ?? null;
}

function objectOwnerFromRead(result) {
  const owner = result?.data?.owner ?? result?.owner ?? result?.object?.owner ?? null;
  if (!owner) return null;
  if (owner.AddressOwner) return owner.AddressOwner;
  if (owner.address) return owner.address;
  return null;
}

function authorityModeNameFromValue(value) {
  return Number(value) === 3 ? 'controller_only' : null;
}

async function resolveExplicitControllerState(runtime, seriesId, explicitBinding) {
  const [controlRecord, controllerNft] = await Promise.all([
    rawGetObject(runtime.baseClient, runtime.transport, explicitBinding.controlRecordId),
    rawGetObject(runtime.baseClient, runtime.transport, explicitBinding.controllerNftId),
  ]);
  const controlFields = objectFieldsFromRead(controlRecord);
  const nftFields = objectFieldsFromRead(controllerNft);
  assert(controlFields, `Control record ${explicitBinding.controlRecordId} is not readable.`);
  assert(nftFields, `Controller NFT ${explicitBinding.controllerNftId} is not readable.`);
  assert(
    String(controlFields.series_id ?? '') === String(seriesId),
    `Control record ${explicitBinding.controlRecordId} is not bound to series ${seriesId}.`,
  );
  assert(
    String(controlFields.controller_nft_id ?? '') === String(explicitBinding.controllerNftId),
    `Control record ${explicitBinding.controlRecordId} does not reference controller NFT ${explicitBinding.controllerNftId}.`,
  );
  assert(
    String(nftFields.series_id ?? '') === String(seriesId),
    `Controller NFT ${explicitBinding.controllerNftId} is not bound to series ${seriesId}.`,
  );
  assert(
    String(nftFields.control_record_id ?? '') === String(explicitBinding.controlRecordId),
    `Controller NFT ${explicitBinding.controllerNftId} does not reference control record ${explicitBinding.controlRecordId}.`,
  );
  const authorityMode = Number(controlFields.authority_mode ?? NaN);
  assert(authorityMode === 3, `Series ${seriesId} is not controller_only according to control record ${explicitBinding.controlRecordId}.`);
  return {
    controllerManaged: true,
    authorityMode,
    authorityModeName: String(nftFields.authority_mode_name ?? authorityModeNameFromValue(authorityMode) ?? ''),
    controlRecordId: explicitBinding.controlRecordId,
    controllerNftId: explicitBinding.controllerNftId,
    controllerHolder: objectOwnerFromRead(controllerNft),
  };
}

function resolvedAuthorityState(details, explicitControllerState = null) {
  return {
    controllerManaged: isControllerManagedSeries(details) || Boolean(explicitControllerState),
    authorityMode: details?.series?.seriesAuthorityMode ?? details?.controlSnapshot?.authorityMode ?? explicitControllerState?.authorityMode ?? null,
    authorityModeName: details?.series?.seriesAuthorityModeName ?? details?.controlSnapshot?.authorityModeName ?? explicitControllerState?.authorityModeName ?? null,
    seriesOwner: details?.series?.owner ?? null,
    controllerHolder: details?.controlSnapshot?.controllerHolder ?? explicitControllerState?.controllerHolder ?? null,
    controlRecordId: details?.series?.seriesControlRecordId ?? details?.controlSnapshot?.controlRecordId ?? explicitControllerState?.controlRecordId ?? null,
    controllerNftId: details?.series?.seriesControllerNftId ?? details?.controlSnapshot?.controllerNftId ?? explicitControllerState?.controllerNftId ?? null,
  };
}

function isControllerOnlySeries(details) {
  const authorityMode = details?.series?.seriesAuthorityMode;
  if (authorityMode != null) return Number(authorityMode) === 3;
  return (details?.series?.seriesAuthorityModeName ?? details?.controlSnapshot?.authorityModeName ?? null) === 'controller_only';
}

function seriesAuthoritySummary(details, explicitControllerState = null) {
  const state = resolvedAuthorityState(details, explicitControllerState);
  return {
    controllerManaged: state.controllerManaged,
    authorityMode: state.authorityModeName,
    seriesOwner: state.seriesOwner,
    controllerHolder: state.controllerHolder,
    controlRecordId: state.controlRecordId,
    controllerNftId: state.controllerNftId,
  };
}

function assertSignerMatchesSeriesAuthority(details, signerAddress, explicitControllerState = null) {
  if (!signerAddress) return;
  const normalizedSigner = normalizeAddress(signerAddress);
  const state = resolvedAuthorityState(details, explicitControllerState);
  if (state.controllerManaged) {
    const holder = state.controllerHolder;
    assert(holder, 'Series is controller-managed but no controller holder could be resolved from chain.');
    assert(
      normalizeAddress(holder) === normalizedSigner,
      `Controller holder ${holder} does not match signer ${signerAddress}.`,
    );
    return;
  }
  assert(
    normalizeAddress(details.series.owner) === normalizedSigner,
    `Series owner ${details.series.owner} does not match signer ${signerAddress}.`,
  );
}

function controllerBinding(details, explicitControllerState = null) {
  const state = resolvedAuthorityState(details, explicitControllerState);
  const controlRecordId = state.controlRecordId;
  const controllerNftId = state.controllerNftId;
  assert(controlRecordId, 'Controller-managed series is missing controlRecordId.');
  assert(controllerNftId, 'Controller-managed series is missing controllerNftId.');
  return { controlRecordId, controllerNftId };
}

function explicitControllerBinding(args) {
  const controlRecordId = getArg(args, 'controlRecord', 'control-record');
  const controllerNftId = getArg(args, 'controllerNft', 'controller-nft');
  assert(controlRecordId, 'Missing --control-record=<id>. Community add-version flows require an explicit controller binding.');
  assert(controllerNftId, 'Missing --controller-nft=<id>. Community add-version flows require an explicit controller binding.');
  return { controlRecordId, controllerNftId };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(usage());
    return;
  }

  assert(args.series, 'Missing --series=<seriesId>.');
  const explicitBinding = explicitControllerBinding(args);
  const run = Boolean(args.run);
  const runtime = createSkillRuntime(args);
  const reportDir = path.resolve(args['report-dir'] ?? path.join(SKILL_ROOT, 'artifacts'));
  const signerResult = await loadAccount(args, run);
  const preflight = await runPublishPreflight({
    runtime,
    requireSigner: run,
    signerResult,
    seriesId: args.series,
    expectedArtifactType: ARTIFACT_TYPES.softwareRelease,
  });

  const baseReport = {
    ok: false,
    run,
    preflightOnly: Boolean(args.preflight) && !run,
    transport: runtime.transport,
    queryTransport: runtime.queryTransport,
    rpcUrl: runtime.rpcUrl,
    walrusRelay: runtime.walrusRelay,
    sender: signerResult?.ok ? signerResult.address : null,
    signerAccount: signerResult?.ok ? signerResult.account ?? null : null,
    artifactType: 'softwareRelease',
    seriesId: args.series,
    preflight,
    uploadOk: false,
    transactionSubmitted: false,
    transactionDigest: null,
    chainResultObserved: false,
    latestVersionConfirmed: false,
    confirmationCommand: confirmationCommand(args, runtime),
  };

  if (args.preflight && !run) {
    const reportPath = await writeReport(reportDir, 'software-release-preflight', { ...baseReport, ok: preflight.ok });
    console.log(stringifyForJson({ ...baseReport, ok: preflight.ok, reportPath }));
    return;
  }

  if (!preflight.ok) {
    const reportPath = await writeReport(reportDir, 'software-release-preflight-failed', {
      ...baseReport,
      error: {
        category: 'preflight',
        code: 'PREFLIGHT_FAILED',
        summary: 'Preflight failed. No Walrus upload or add-version transaction was attempted.',
        criticalFailures: preflight.criticalFailures,
      },
    });
    console.log(stringifyForJson({
      ...baseReport,
      error: {
        category: 'preflight',
        code: 'PREFLIGHT_FAILED',
        summary: 'Preflight failed. No Walrus upload or add-version transaction was attempted.',
        criticalFailures: preflight.criticalFailures,
      },
      reportPath,
    }));
    return;
  }

  const details = await runtime.sdk.query.getSeriesDetails(args.series);
  const explicitControllerState = await resolveExplicitControllerState(runtime, args.series, explicitBinding);
  assert(Number(details.series.artifactType) === ARTIFACT_TYPES.softwareRelease, 'Target series is not a softwareRelease.');
  assert(
    isControllerOnlySeries(details) || explicitControllerState.authorityMode === 3,
    `Community add-version flow only supports controller_only series. Current mode: ${details?.series?.seriesAuthorityModeName ?? details?.controlSnapshot?.authorityModeName ?? explicitControllerState.authorityModeName ?? 'unknown'}.`,
  );
  {
    const discoveredBinding = controllerBinding(details, explicitControllerState);
    assert(
      discoveredBinding.controlRecordId === explicitBinding.controlRecordId,
      `Explicit control record ${explicitBinding.controlRecordId} does not match series binding ${discoveredBinding.controlRecordId}.`,
    );
    assert(
      discoveredBinding.controllerNftId === explicitBinding.controllerNftId,
      `Explicit controller NFT ${explicitBinding.controllerNftId} does not match series binding ${discoveredBinding.controllerNftId}.`,
    );
  }
  if (signerResult?.ok) {
    assertSignerMatchesSeriesAuthority(details, signerResult.address, explicitControllerState);
  }

  const current = details.currentVersion.rawFields ?? {};
  const shortSha = await execCapture('git', ['rev-parse', '--short', 'HEAD'], SKILL_ROOT);
  const isDirty = (await execCapture('git', ['status', '--porcelain'], SKILL_ROOT)).length > 0;
  const sourceHash = args['source-hash'] ?? `git:${shortSha}${isDirty ? '+dirty' : ''}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const projectName = args['project-name'] ?? current.project_name ?? 'paperproof-community-skill';
  const nextVersion = Number(details.series.currentVersion) + 1;
  const versionName = args['version-name'] ?? `v${nextVersion}`;
  const repositoryUrl = args['repository-url'] ?? current.repository_url ?? 'https://github.com/PaperProofLabs/paperproof-community-skill';
  const license = args.license ?? current.license ?? 'Apache-2.0';
  const changelog = args.changelog ?? `paperproof-community-skill transport and preflight hardening ${timestamp}`;
  const outputZip = path.resolve(args['output-zip'] ?? path.join(reportDir, `${projectName}-${timestamp}.zip`));

  await makeZip(outputZip);
  const fileInfo = await readFileInfo(outputZip);

  if (!run) {
    const reportPath = await writeReport(reportDir, 'software-release-dry-run', {
      ...baseReport,
      ok: true,
      artifactCode: details.series.artifactCode,
      seriesOwner: details.series.owner,
      previousVersion: details.series.currentVersion,
      previousVersionId: details.series.currentVersionId,
      previousContentHash: details.currentVersion.contentHash,
      projectName,
      versionName,
      sourceHash,
      zipPath: outputZip,
      zipSize: fileInfo.fileSize,
      contentHash: fileInfo.contentHash,
      authority: seriesAuthoritySummary(details, explicitControllerState),
    });
    console.log(stringifyForJson({
      ...baseReport,
      ok: true,
      artifactCode: details.series.artifactCode,
      seriesOwner: details.series.owner,
      previousVersion: details.series.currentVersion,
      previousVersionId: details.series.currentVersionId,
      previousContentHash: details.currentVersion.contentHash,
      projectName,
      versionName,
      sourceHash,
      zipPath: outputZip,
      zipSize: fileInfo.fileSize,
      contentHash: fileInfo.contentHash,
      authority: seriesAuthoritySummary(details, explicitControllerState),
      reportPath,
    }));
    return;
  }

  let upload;
  try {
    upload = await uploadContent(runtime, signerResult.signer, fileInfo, `paperproof-software-release-${projectName}`);
  } catch (error) {
    const reportPath = await writeReport(reportDir, 'software-release-upload-failed', {
      ...baseReport,
      artifactCode: details.series.artifactCode,
      seriesOwner: details.series.owner,
      previousVersion: details.series.currentVersion,
      previousVersionId: details.series.currentVersionId,
      previousContentHash: details.currentVersion.contentHash,
      zipPath: outputZip,
      zipSize: fileInfo.fileSize,
      contentHash: fileInfo.contentHash,
      authority: seriesAuthoritySummary(details, explicitControllerState),
      error: createResultError('upload', error, { transport: runtime.transport }),
    });
    console.log(stringifyForJson({
      ...baseReport,
      artifactCode: details.series.artifactCode,
      seriesOwner: details.series.owner,
      previousVersion: details.series.currentVersion,
      previousVersionId: details.series.currentVersionId,
      previousContentHash: details.currentVersion.contentHash,
      zipPath: outputZip,
      zipSize: fileInfo.fileSize,
      contentHash: fileInfo.contentHash,
      authority: seriesAuthoritySummary(details, explicitControllerState),
      error: createResultError('upload', error, { transport: runtime.transport }),
      reportPath,
    }));
    return;
  }

  const txb = new PaperProofTxBuilder(runtime.deployment);
  const versionInput = {
    seriesId: args.series,
    projectName,
    versionName,
    sourceHash,
    packageHash: fileInfo.contentHash,
    changelog,
    license,
    repositoryUrl,
    contentHash: fileInfo.contentHash,
    walrusBlobId: upload.blobId,
    walrusBlobObjectId: upload.blobObjectId,
    contentType: 'application/zip',
    versionMetadata: [
      { key: 'release_kind', value: 'codex-skill' },
      { key: 'commit', value: shortSha },
      { key: 'worktree', value: isDirty ? 'dirty' : 'clean' },
    ],
    versionChangeNote: args['version-change-note']
      ?? args.versionChangeNote
      ?? changelog,
  };
  const tx = txb.addSoftwareReleaseVersion({
    ...versionInput,
    ...explicitBinding,
  });
  tx.setSenderIfNotSet(signerResult.address);

  let execution;
  try {
    execution = await robustExecuteTransaction(runtime.baseClient, signerResult.signer, tx, 'add software release version', {
      attempts: runtime.retryAttempts,
      baseDelayMs: runtime.retryBaseDelayMs,
    });
  } catch (error) {
    const reportPath = await writeReport(reportDir, 'software-release-transaction-failed', {
      ...baseReport,
      artifactCode: details.series.artifactCode,
      seriesOwner: details.series.owner,
      previousVersion: details.series.currentVersion,
      previousVersionId: details.series.currentVersionId,
      previousContentHash: details.currentVersion.contentHash,
      zipPath: outputZip,
      zipSize: fileInfo.fileSize,
      contentHash: fileInfo.contentHash,
      uploadOk: true,
      upload,
      authority: seriesAuthoritySummary(details, explicitControllerState),
      error: createResultError('transaction', error, { transport: runtime.transport }),
    });
    console.log(stringifyForJson({
      ...baseReport,
      artifactCode: details.series.artifactCode,
      seriesOwner: details.series.owner,
      previousVersion: details.series.currentVersion,
      previousVersionId: details.series.currentVersionId,
      previousContentHash: details.currentVersion.contentHash,
      zipPath: outputZip,
      zipSize: fileInfo.fileSize,
      contentHash: fileInfo.contentHash,
      uploadOk: true,
      upload,
      authority: seriesAuthoritySummary(details, explicitControllerState),
      error: createResultError('transaction', error, { transport: runtime.transport }),
      reportPath,
    }));
    return;
  }

  const added = extractAddVersionResult(toSdkResponse(execution), runtime.deployment);
  const confirmation = await confirmLatestVersion({
    runtime,
    seriesId: args.series,
    expectedVersionId: added.versionId,
    expectedContentHash: fileInfo.contentHash,
  });

  const report = {
    ...baseReport,
    ok: true,
    artifactCode: details.series.artifactCode,
    seriesOwner: details.series.owner,
    previousVersion: details.series.currentVersion,
    previousVersionId: details.series.currentVersionId,
    previousContentHash: details.currentVersion.contentHash,
    newVersion: String(added.version),
    newVersionId: added.versionId,
    projectName,
    versionName,
    sourceHash,
    packageHash: fileInfo.contentHash,
    changelog,
    repositoryUrl,
    zipPath: outputZip,
    zipSize: fileInfo.fileSize,
    contentHash: fileInfo.contentHash,
    uploadOk: true,
    transactionSubmitted: true,
    transactionDigest: execution.digest,
    chainResultObserved: true,
    latestVersionConfirmed: confirmation.ok,
    authority: seriesAuthoritySummary(details, explicitControllerState),
    upload,
    confirmation,
    needsManualConfirmation: !confirmation.ok,
    operatorNote: !confirmation.ok
      ? 'Upload and transaction submission completed, but latest-version confirmation did not finish through the current read path. Re-run the confirmation command before treating this as failure.'
      : null,
  };

  const reportPath = await writeReport(reportDir, confirmation.ok ? 'software-release-success' : 'software-release-pending-confirmation', report);
  console.log(stringifyForJson({ ...report, reportPath }));
}

main().catch((error) => {
  console.error(stringifyForJson({
    ok: false,
    error: createResultError('fatal', error),
  }));
  process.exitCode = 1;
});
