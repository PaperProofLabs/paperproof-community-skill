#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_TYPES,
  PaperProofTxBuilder,
  extractPublishResult,
  robustExecuteTransaction,
  robustWalrusWriteBlob,
  stringifyForJson,
} from '@paperproof/sdk-ts';

import { loadSignerSet, normalizeAddress } from './lib/signer.mjs';
import {
  createResultError,
  createSkillRuntime,
  errorMessage,
  getBalances,
  getArg,
  pingWalrusRelay,
  rawGetObject,
} from './lib/publish-runtime.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const CONTENT_TYPE = 'application/vnd.paperproof.markdown-package+zip';
const FIXED_ZIP_DATE = new Date('2026-01-01T00:00:00.000Z');

let jszipCtor;

function usage() {
  return `
Publish a local Markdown long-form article as a new PaperProof blog_post artifact.

Usage:
  node scripts/publish-blog-post-from-local-file.mjs --file=<path> --summary="..." --tags=tag1,tag2 --license=<id>
  node scripts/publish-blog-post-from-local-file.mjs --preflight --file=<path> --summary="..." --tags=tag1,tag2 --signer-env=<env> --account=1
  node scripts/publish-blog-post-from-local-file.mjs --run --file=<path> --summary="..." --tags=tag1,tag2 --signer-env=<env> --account=1

Modes:
  default         dry run; no mainnet write
  --preflight     run structured readiness checks
  --run           upload to Walrus and publish the blog_post series

Required:
  --file=<path>      Markdown file whose first line is an H1 title
  --summary="..."    Short summary for blog_post metadata
  --tags=a,b,c       Comma-separated discovery tags

Optional:
  --language=en
  --license=<id>
  --slug=<id>
  --category=<text>
  --comments=open|locked
  --report-dir=<path>

Transport:
  --rpc=<url>
  --transport=grpc|jsonrpc
  --query-transport=none|jsonrpc|graphql|fallback
  --walrus-relay=<url>
  --retry-attempts=<n>
  --retry-base-ms=<ms>

Signer modes:
  --signer-mode=auto|single-env|indexed-env|cli-keystore
  --signer-env=<path>
  --cli-config-dir=<path>
  --cli-address=<0x...>
  --cli-alias=<name>
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

function loadJSZip() {
  if (jszipCtor) return jszipCtor;
  const requireFromSkill = createRequire(path.join(SKILL_ROOT, 'package.json'));
  jszipCtor = requireFromSkill('jszip');
  return jszipCtor;
}

function zipFileOptions() {
  return { date: FIXED_ZIP_DATE };
}

async function loadAccount(args, required) {
  const envSpecified = Boolean(getArg(args, 'signerEnv', 'signer-env'));
  const mode = args.signerMode ?? args['signer-mode'] ?? (args.account ? 'indexed-env' : 'auto');
  const signerHintsPresent = envSpecified
    || Boolean(args.account)
    || Boolean(process.env.ADDRESS && process.env.PRIVATE_KEY)
    || Boolean(process.env.ADDR_1 && process.env.PRIVATE_KEY_1);
  if (!required && !signerHintsPresent) return null;
  try {
    const accounts = await loadSignerSet(args, { defaultMode: mode });
    const requested = Number(args.account ?? 1);
    if (mode === 'indexed-env' || args.account) {
      const match = accounts.find((item) => item.index === requested);
      if (!match) throw new Error(`Could not find indexed signer account ${requested}.`);
      return { ok: true, account: requested, address: match.address, signer: match.signer };
    }
    const [first] = accounts;
    return { ok: true, account: requested, address: first.address, signer: first.signer };
  } catch (error) {
    if (!required) {
      return {
        ...createResultError('signer', error),
        ok: false,
      };
    }
    throw error;
  }
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function metadataAttributes(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => ({ key, value: String(value).slice(0, 511) }));
}

function shouldFallbackToManualWalrus(error) {
  const text = errorMessage(error).toLowerCase();
  return text.includes('fetch failed')
    || text.includes('rpcerror')
    || text.includes('getbalance')
    || text.includes('batchgetobjects')
    || text.includes('multigetobjects')
    || text.includes('terminated')
    || text.includes('aborterror')
    || text.includes('connection timeout')
    || text.includes('econnreset')
    || text.includes('tls')
    || text.includes('provided version doesn\'t match')
    || text.includes('provided version does not match')
    || text.includes('invalid withdraw reservation')
    || text.includes('rejected as invalid by more than 1/3 of validators by stake')
    || text.includes('unavailable for consumption')
    || text.includes('needs to be rebuilt');
}

async function waitForObjectReadable(baseClient, objectId, { attempts = 8, baseDelayMs = 1_200 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const object = await baseClient.getObject({
        id: objectId,
        options: { showContent: true, showOwner: true, showType: true },
      });
      if (!object.error && object.data) return object;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  if (lastError) throw lastError;
  throw new Error(`Timed out waiting for object ${objectId} to become readable.`);
}

function registeredBlobObjectId(execution, fallbackBlobId) {
  const event = (execution.events ?? []).find((item) => item.type?.endsWith('::BlobRegistered'));
  const fromEvent = event?.parsedJson?.object_id ?? event?.parsedJson?.objectId;
  if (typeof fromEvent === 'string' && fromEvent.startsWith('0x')) return fromEvent;

  const createdBlob = (execution.objectChanges ?? []).find(
    (item) => item?.type === 'created' && String(item.objectType ?? '').endsWith('::blob::Blob'),
  );
  if (typeof createdBlob?.objectId === 'string') return createdBlob.objectId;

  throw new Error(`Could not find Walrus blob object id for blob ${fallbackBlobId}.`);
}

async function manualWalrusUpload(runtime, signer, content, label) {
  const flow = runtime.walrusClient.walrus.writeBlobFlow({ blob: content.bytes });
  const encoded = await flow.encode();
  const nonce = encoded.nonce ? new Uint8Array(Buffer.from(encoded.nonce, 'base64')) : null;
  if (!nonce) throw new Error('Walrus manual flow did not return a nonce for upload relay mode.');

  const computed = await runtime.walrusClient.walrus.computeBlobMetadata({
    bytes: content.bytes,
    nonce,
  });
  if (computed.blobId !== encoded.blobId) {
    throw new Error(`Walrus blob id mismatch during manual fallback: ${computed.blobId} != ${encoded.blobId}`);
  }

  const registerExecution = await robustExecuteTransaction(
    runtime.baseClient,
    signer,
    flow.register({
      epochs: 10,
      deletable: true,
      owner: signer.toSuiAddress(),
    }),
    `${label} walrus register`,
    {
      attempts: runtime.retryAttempts,
      baseDelayMs: runtime.retryBaseDelayMs,
    },
  );
  const blobObjectId = registeredBlobObjectId(registerExecution, encoded.blobId);
  await waitForObjectReadable(runtime.baseClient, blobObjectId);

  const relayUpload = await runtime.walrusClient.walrus.writeBlobToUploadRelay({
    blobId: encoded.blobId,
    nonce,
    txDigest: registerExecution.digest,
    blob: content.bytes,
    blobObjectId,
    deletable: true,
    requiresTip: true,
    encodingType: computed.metadata.encodingType,
  });

  const certifyExecution = await robustExecuteTransaction(
    runtime.baseClient,
    signer,
    runtime.walrusClient.walrus.certifyBlobTransaction({
      certificate: relayUpload.certificate,
      blobId: encoded.blobId,
      blobObjectId,
      deletable: true,
    }),
    `${label} walrus certify`,
    {
      attempts: runtime.retryAttempts,
      baseDelayMs: runtime.retryBaseDelayMs,
    },
  );

  return {
    blobId: encoded.blobId,
    blobObjectId,
    byteLength: content.fileSize,
    registerDigest: registerExecution.digest,
    certifyDigest: certifyExecution.digest,
    strategy: 'manual-flow-fallback',
  };
}

async function uploadContent(runtime, signer, content, run, label) {
  if (!run) {
    const digest = content.contentHash.replace(/^sha256:/, '').slice(0, 24);
    return {
      ok: true,
      uploadOk: true,
      blobId: `local-blog-${digest}`,
      blobObjectId: `0x${'6'.repeat(64)}`,
      byteLength: content.fileSize,
      strategy: 'dry-run-placeholder',
    };
  }

  try {
    const upload = await robustWalrusWriteBlob(runtime.walrusClient, signer, content.bytes, {
      label: label.slice(0, 96),
      fallback: false,
      attempts: runtime.retryAttempts,
      baseDelayMs: runtime.retryBaseDelayMs,
      epochs: 10,
      owner: signer.toSuiAddress(),
      deletable: false,
    });
    return {
      ok: true,
      uploadOk: true,
      blobId: upload.blobId,
      blobObjectId: upload.blobObjectId,
      byteLength: content.fileSize,
      strategy: 'sdk-write-blob',
    };
  } catch (error) {
    if (!shouldFallbackToManualWalrus(error)) {
      return {
        ok: false,
        uploadOk: false,
        error: createResultError('upload', error, { transport: runtime.transport }),
      };
    }
    try {
      const upload = await manualWalrusUpload(runtime, signer, content, label.slice(0, 96));
      return {
        ok: true,
        uploadOk: true,
        ...upload,
      };
    } catch (fallbackError) {
      return {
        ok: false,
        uploadOk: false,
        fallbackAttempted: true,
        primaryError: createResultError('upload', error, { transport: runtime.transport }),
        error: createResultError('upload', fallbackError, { transport: runtime.transport }),
      };
    }
  }
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

function objectFieldsFromRead(result) {
  return result?.data?.content?.fields ?? result?.content?.fields ?? null;
}

function authorityModeFromExecution(execution) {
  const event = (execution?.events ?? []).find((item) =>
    String(item?.type ?? '').endsWith('::ArtifactControlRecordCreatedEvent'),
  );
  const mode = event?.parsedJson?.authority_mode;
  return mode == null ? null : Number(mode);
}

async function resolvePublishedSeriesReport(runtime, execution, published) {
  try {
    const details = await runtime.sdk.query.getSeriesDetails(published.seriesId);
    const authorityMode = details?.series?.seriesAuthorityModeName ?? details?.controlSnapshot?.authorityModeName ?? null;
    assert(
      authorityMode === 'controller_only',
      `Newly published blog series must be controller_only. Current mode: ${authorityMode ?? 'unknown'}.`,
    );
    return {
      verification: 'sdk-query',
      verificationWarning: null,
      seriesOwner: normalizeAddress(details.series.owner),
      currentVersion: details.series.currentVersion,
      currentVersionId: details.series.currentVersionId,
    };
  } catch (error) {
    const rawSeries = await rawGetObject(runtime.baseClient, runtime.transport, published.seriesId);
    const fields = objectFieldsFromRead(rawSeries);
    assert(fields, `Published series ${published.seriesId} is not readable from raw object fallback.`);
    const authorityMode = authorityModeFromExecution(execution);
    assert(
      authorityMode === 3,
      `Published series ${published.seriesId} could not confirm controller_only authority mode from execution events.`,
    );
    return {
      verification: 'raw-object-fallback',
      verificationWarning: errorMessage(error),
      seriesOwner: normalizeAddress(fields.owner),
      currentVersion: Number(fields.current_version ?? 0),
      currentVersionId: String(fields.current_version_id ?? published.versionId),
    };
  }
}

async function readMarkdownContent(args) {
  const fullPath = path.resolve(String(args.file));
  const markdown = await fs.readFile(fullPath, 'utf8');
  const titleLine = markdown.split(/\r?\n/, 1)[0] ?? '';
  assert(titleLine.startsWith('# '), 'Markdown source must start with an H1 title on the first line.');
  const title = titleLine.slice(2).trim();
  assert(title.length > 0, 'Markdown H1 title cannot be empty.');

  const summary = String(args.summary ?? '').trim();
  assert(summary.length > 0, 'Missing --summary="...".');

  const tags = String(args.tags ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  assert(tags.length > 0, 'Missing --tags=tag1,tag2.');

  const language = String(args.language ?? 'en').trim() || 'en';
  const slug = String(args.slug ?? path.basename(fullPath, path.extname(fullPath))).trim();
  const category = String(args.category ?? 'Community Blog').trim();
  const license = String(args.license ?? 'CC-BY-4.0').trim();

  const JSZip = loadJSZip();
  const zip = new JSZip();
  zip.file('index.md', markdown, zipFileOptions());
  zip.file(
    'manifest.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        appKind: 'blog_post',
        entry: 'index.md',
        title,
        source: path.basename(fullPath),
        postId: slug,
        contentType: 'text/markdown; charset=utf-8',
        assets: [],
      },
      null,
      2,
    )}\n`,
    zipFileOptions(),
  );

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return {
    fullPath,
    markdown,
    title,
    summary,
    tags,
    language,
    slug,
    category,
    license,
    bytes,
    fileSize: bytes.length,
    contentType: CONTENT_TYPE,
    contentHash: `sha256:${sha256Hex(bytes)}`,
  };
}

async function writeReport(reportDir, prefix, report) {
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${prefix}-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${stringifyForJson(report)}\n`, 'utf8');
  return reportPath;
}

async function runNewPublishPreflight({ runtime, requireSigner, signerResult }) {
  const checks = {};
  const criticalFailures = [];

  try {
    const rootObject = await rawGetObject(runtime.baseClient, runtime.transport, runtime.deployment.objects.root);
    checks.rpc = {
      ok: true,
      transport: runtime.transport,
      rpcUrl: runtime.rpcUrl,
      rootObjectId: runtime.deployment.objects.root,
      hasObject: Boolean(rootObject?.data ?? rootObject?.object),
    };
  } catch (error) {
    checks.rpc = {
      ...createResultError('rpc', error, { transport: runtime.transport }),
      rpcUrl: runtime.rpcUrl,
    };
    criticalFailures.push('rpc');
  }

  try {
    const relay = await pingWalrusRelay(runtime.walrusRelay);
    checks.walrusRelay = {
      ok: true,
      url: runtime.walrusRelay,
      status: relay.status,
      statusText: relay.statusText,
    };
  } catch (error) {
    checks.walrusRelay = {
      ...createResultError('walrusRelay', error, { transport: runtime.transport }),
      url: runtime.walrusRelay,
    };
    if (requireSigner) criticalFailures.push('walrusRelay');
  }

  if (signerResult) {
    checks.signer = signerResult.ok
      ? {
          ok: true,
          address: signerResult.address,
          account: signerResult.account ?? null,
        }
      : signerResult;
    if (!signerResult.ok && requireSigner) criticalFailures.push('signer');
  } else {
    checks.signer = {
      ok: !requireSigner,
      skipped: !requireSigner,
      summary: requireSigner ? 'Signer was required but not resolved.' : 'Signer not required for this preflight.',
    };
    if (requireSigner) criticalFailures.push('signer');
  }

  if (signerResult?.ok) {
    try {
      const balances = await getBalances(runtime.baseClient, runtime.transport, signerResult.address);
      checks.balances = {
        ok: true,
        address: signerResult.address,
        balances,
      };
    } catch (error) {
      checks.balances = {
        ...createResultError('balances', error, { transport: runtime.transport }),
        address: signerResult.address,
      };
      if (requireSigner) criticalFailures.push('balances');
    }
  } else {
    checks.balances = {
      ok: false,
      skipped: true,
      summary: 'Balance check skipped because signer was not available.',
    };
  }

  return {
    ok: criticalFailures.length === 0,
    criticalFailures,
    checks,
    transport: runtime.transport,
    queryTransport: runtime.queryTransport,
    rpcUrl: runtime.rpcUrl,
    walrusRelay: runtime.walrusRelay,
  };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(usage());
    return;
  }

  assert(args.file, 'Missing --file=<path>.');
  const run = Boolean(args.run);
  const runtime = createSkillRuntime(args);
  const reportDir = path.resolve(args['report-dir'] ?? path.join(SKILL_ROOT, 'artifacts'));
  const signerResult = await loadAccount(args, run);
  const content = await readMarkdownContent(args);
  const preflight = await runNewPublishPreflight({
    runtime,
    requireSigner: run,
    signerResult,
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
    artifactType: 'blogPost',
    sourceFile: content.fullPath,
    title: content.title,
    summary: content.summary,
    tags: content.tags,
    language: content.language,
    contentHash: content.contentHash,
    fileSize: content.fileSize,
    preflight,
    uploadOk: false,
    transactionSubmitted: false,
    transactionDigest: null,
  };

  if (args.preflight && !run) {
    const reportPath = await writeReport(reportDir, 'publish-blog-preflight', {
      ...baseReport,
      ok: preflight.ok,
    });
    console.log(stringifyForJson({ ...baseReport, ok: preflight.ok, reportPath }));
    return;
  }

  if (!preflight.ok) {
    const reportPath = await writeReport(reportDir, 'publish-blog-preflight-failed', {
      ...baseReport,
      error: {
        category: 'preflight',
        code: 'PREFLIGHT_FAILED',
        summary: 'Preflight failed. No Walrus upload or blog_post publish was attempted.',
        criticalFailures: preflight.criticalFailures,
      },
    });
    console.log(stringifyForJson({
      ...baseReport,
      error: {
        category: 'preflight',
        code: 'PREFLIGHT_FAILED',
        summary: 'Preflight failed. No Walrus upload or blog_post publish was attempted.',
        criticalFailures: preflight.criticalFailures,
      },
      reportPath,
    }));
    return;
  }

  if (!run) {
    const dryRun = {
      ...baseReport,
      ok: true,
      previewArtifactType: ARTIFACT_TYPES.blogPost,
      commentsPolicy: String(args.comments ?? 'open'),
      plannedSlug: content.slug,
      plannedLicense: content.license,
    };
    const reportPath = await writeReport(reportDir, 'publish-blog-dry-run', dryRun);
    console.log(stringifyForJson({ ...dryRun, reportPath }));
    return;
  }

  const upload = await uploadContent(runtime, signerResult.signer, content, run, `paperproof-publish-blog-${content.slug}`);
  if (!upload.ok) {
    const reportPath = await writeReport(reportDir, 'publish-blog-upload-failed', {
      ...baseReport,
      error: upload.error,
      upload,
    });
    console.log(stringifyForJson({
      ...baseReport,
      error: upload.error,
      upload,
      reportPath,
    }));
    return;
  }

  const txb = new PaperProofTxBuilder(runtime.deployment);
  const input = {
    title: content.title,
    summary: content.summary,
    tags: content.tags,
    language: content.language,
    contentHash: content.contentHash,
    walrusBlobId: upload.blobId,
    walrusBlobObjectId: upload.blobObjectId,
    contentType: content.contentType,
    seriesMetadata: metadataAttributes({
      app: 'community-blog',
      slug: content.slug,
      category: content.category,
      license: content.license,
    }),
    versionMetadata: metadataAttributes({
      schema: 'paperproof-blog-markdown-package-v1',
      source: path.basename(content.fullPath),
      date: new Date().toISOString().slice(0, 10),
    }),
  };

  const tx = txb.publishBlogPost(input);
  tx.setSenderIfNotSet(signerResult.address);

  let execution;
  try {
    execution = await robustExecuteTransaction(runtime.baseClient, signerResult.signer, tx, 'publish blog post', {
      attempts: runtime.retryAttempts,
      baseDelayMs: runtime.retryBaseDelayMs,
    });
  } catch (error) {
    const reportPath = await writeReport(reportDir, 'publish-blog-transaction-failed', {
      ...baseReport,
      uploadOk: true,
      upload,
      error: createResultError('transaction', error, { transport: runtime.transport }),
    });
    console.log(stringifyForJson({
      ...baseReport,
      uploadOk: true,
      upload,
      error: createResultError('transaction', error, { transport: runtime.transport }),
      reportPath,
    }));
    return;
  }

  const published = extractPublishResult(toSdkResponse(execution), runtime.deployment);
  assert(published.artifactType === ARTIFACT_TYPES.blogPost, `Unexpected artifact type ${published.artifactType}.`);
  const seriesReport = await resolvePublishedSeriesReport(runtime, execution, published);

  const report = {
    ...baseReport,
    ok: true,
    artifactCode: published.artifactCode,
    seriesId: published.seriesId,
    versionId: published.versionId,
    commentsTreeId: published.commentsTreeId,
    likesBookId: published.likesBookId,
    uploadOk: true,
    transactionSubmitted: true,
    transactionDigest: execution.digest,
    upload,
    previewUrl: `https://paperproof.site/#/artifact/${published.artifactCode}`,
    verification: seriesReport.verification,
    verificationWarning: seriesReport.verificationWarning,
    seriesOwner: seriesReport.seriesOwner,
    currentVersion: seriesReport.currentVersion,
    currentVersionId: seriesReport.currentVersionId,
  };
  const reportPath = await writeReport(reportDir, 'publish-blog-success', report);
  console.log(stringifyForJson({ ...report, reportPath }));
}

main().catch(async (error) => {
  const failure = {
    ok: false,
    error: createResultError('fatal', error),
  };
  console.error(stringifyForJson(failure));
  process.exitCode = 1;
});
