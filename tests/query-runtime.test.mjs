import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_GOVERNANCE_QUERY_TRANSPORT } from '../scripts/lib/governance-runtime.mjs';
import { resolveQueryTransport } from '../scripts/query-events.mjs';

test('community query-events defaults to GraphQL-safe posture', () => {
  assert.equal(resolveQueryTransport({}), 'graphql');
  assert.throws(() => resolveQueryTransport({ queryTransport: 'jsonrpc' }));
  assert.throws(() => resolveQueryTransport({ queryTransport: 'fallback' }));
});

test('community governance runtime defaults to GraphQL query transport', () => {
  assert.equal(DEFAULT_GOVERNANCE_QUERY_TRANSPORT, 'graphql');
});
