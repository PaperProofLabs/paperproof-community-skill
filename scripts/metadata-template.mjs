#!/usr/bin/env node

// Copyright (c) 2026 PaperProof Labs
// SPDX-License-Identifier: Apache-2.0

const type = (process.argv[2] ?? '').trim();

const templates = {
  preprint: {
    title: '',
    abstractText: '',
    authors: [],
    keywords: [],
    field: '',
    license: '',
    pageCount: 0,
    contentHash: '',
    walrusBlobId: '',
    walrusBlobObjectId: '',
    contentType: 'application/pdf',
    seriesMetadata: [],
    versionMetadata: [],
  },
  blogPost: {
    title: '',
    summary: '',
    tags: [],
    language: 'en',
    contentHash: '',
    walrusBlobId: '',
    walrusBlobObjectId: '',
    contentType: 'application/vnd.paperproof.markdown-package+zip',
    seriesMetadata: [],
    versionMetadata: [],
  },
  technicalReport: {
    title: '',
    abstractText: '',
    authors: [],
    organization: '',
    reportNumber: '',
    keywords: [],
    license: '',
    contentHash: '',
    walrusBlobId: '',
    walrusBlobObjectId: '',
    contentType: 'application/pdf',
    seriesMetadata: [],
    versionMetadata: [],
  },
  dataset: {
    title: '',
    description: '',
    format: '',
    fileCount: 0,
    sizeBytes: 0,
    license: '',
    keywords: [],
    contentHash: '',
    walrusBlobId: '',
    walrusBlobObjectId: '',
    contentType: 'application/zip',
    seriesMetadata: [],
    versionMetadata: [],
  },
  softwareRelease: {
    projectName: '',
    versionName: '',
    sourceHash: '',
    packageHash: '',
    changelog: '',
    license: '',
    repositoryUrl: '',
    contentHash: '',
    walrusBlobId: '',
    walrusBlobObjectId: '',
    contentType: 'application/zip',
    seriesMetadata: [],
    versionMetadata: [],
  },
  genericFile: {
    title: '',
    description: '',
    filename: '',
    fileSize: 0,
    license: '',
    contentHash: '',
    walrusBlobId: '',
    walrusBlobObjectId: '',
    contentType: 'application/octet-stream',
    seriesMetadata: [],
    versionMetadata: [],
  },
};

if (!templates[type]) {
  console.error(`Usage: node scripts/metadata-template.mjs <${Object.keys(templates).join('|')}>`);
  process.exit(2);
}

console.log(JSON.stringify(templates[type], null, 2));
