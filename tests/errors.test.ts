import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanError, humanThrown, looksTechnical, parseJsonBody } from '../src/lib/errors';

test('errors: an empty 201 body from PostgREST is success, not a JSON error', () => {
  assert.equal(parseJsonBody(''), undefined);
  assert.equal(parseJsonBody('   \n'), undefined);
  assert.equal(parseJsonBody(null), undefined);
  assert.deepEqual(parseJsonBody('[{"id":1}]'), [{ id: 1 }]);
  assert.deepEqual(parseJsonBody(' {"ok":true} '), { ok: true });
  assert.equal(parseJsonBody('<!DOCTYPE html><html>Bad Gateway</html>'), undefined, 'an HTML error page is not parsed as JSON');
  assert.equal(parseJsonBody('Task timed out after 10.02 seconds'), undefined);
  assert.equal(parseJsonBody('{"broken":'), undefined);
});

test('errors: PostgREST, Supabase and parser messages are never shown to the owner', () => {
  const pg = humanError({ status: 400, body: { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null } });
  assert.ok(!/json/i.test(pg), pg);
  const rls = humanError({ status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "profiles"' } });
  assert.match(rls, /permission/);
  assert.ok(!/row-level|policy|table/.test(rls));
  const dup = humanError({ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "leads_user_id_name_key"' } });
  assert.match(dup, /already saved/);
  assert.equal(humanError({ status: 401, body: { message: 'JWT expired' } }), 'Your session has ended. Sign in again.');
  assert.ok(looksTechnical('Unexpected end of JSON input'));
  assert.ok(looksTechnical('JSON Parse error: Unexpected EOF'));
  assert.ok(looksTechnical('TypeError: Failed to fetch'));
  assert.ok(!looksTechnical('Enter an Instagram handle, like @theirbusiness, or a link to their page.'));
});

test('errors: our own functions’ messages are kept; gateway errors become a plain sentence', () => {
  assert.equal(humanError({ status: 400, body: { error: 'Type a question first.' } }), 'Type a question first.');
  assert.equal(humanError({ status: 429, body: { error: 'You’ve reached this month’s research allowance. It resets on the 1st, or contact hello@gainora.co.uk to raise it.' } }), 'You’ve reached this month’s research allowance. It resets on the 1st, or contact hello@gainora.co.uk to raise it.');
  assert.match(humanError({ status: 502, body: undefined, doing: 'answering' }), /didn’t answer answering|took too long/);
  assert.match(humanError({ status: 504, body: undefined }), /Try again in a minute/);
  assert.match(humanError({ status: 500, body: { error: 'SyntaxError: Unexpected token < in JSON at position 0' } }), /Something went wrong on our side/);
  assert.match(humanError({ status: 0 }), /No connection/);
  assert.equal(humanThrown(new Error('Unexpected end of JSON input'), 'Couldn’t save. Try again.'), 'Couldn’t save. Try again.');
  assert.equal(humanThrown(new Error('Add a name for each competitor.'), 'x'), 'Add a name for each competitor.');
});
