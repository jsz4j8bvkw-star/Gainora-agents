import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantsFor } from '../netlify/lib/stripe';

// 11 November 2026: the three Stripe products carry gainora_key and gainora_grants, so every package switches on Command Centre.
test('a Stripe payment for each package switches on Command Centre, and the receptionist where it is included', async () => {
  delete process.env.STRIPE_AGENT_PRODUCTS;
  const of = async (key: string, grants: string) => (await grantsFor('prod_x', { metadata: { gainora_key: key, gainora_grants: grants } })).map((g) => `${g.agent}${g.plan ? ':' + g.plan : ''}`).sort();
  assert.deepEqual(await of('capture-booking', 'capture,watcher,scout,brief'), ['brief', 'capture:book', 'scout', 'watcher']);
  assert.deepEqual(await of('launch-grow', 'watcher,scout,brief,website'), ['brief', 'scout', 'watcher', 'website']);
  assert.deepEqual(await of('launch-capture-bundle', 'watcher,scout,brief,website,capture'), ['brief', 'capture:book', 'scout', 'watcher', 'website']);
});
