import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSamePassword, linkErrorFromHash, passwordProblem, passwordSignInError, passwordStep, setPasswordError } from '../src/lib/password';

test('new passwords: long enough, not the email, not an easy one, typed the same twice', () => {
  assert.match(passwordProblem('short', 'short')!, /at least 8/);
  assert.match(passwordProblem('x'.repeat(73), 'x'.repeat(73))!, /72 characters or fewer/);
  assert.match(passwordProblem('amy@clinic.co.uk', 'amy@clinic.co.uk', 'Amy@clinic.co.uk')!, /other than your email/);
  assert.match(passwordProblem('aldereaseaesthetics', 'aldereaseaesthetics', 'aldereaseaesthetics@gmail.com')!, /other than your email/);
  assert.match(passwordProblem('Password123', 'Password123')!, /too easy/);
  assert.match(passwordProblem('aaaaaaaaaa', 'aaaaaaaaaa')!, /too easy/);
  assert.match(passwordProblem('12345678901', '12345678901')!, /too easy/);
  assert.match(passwordProblem('green kettle morning', 'green kettle mornin')!, /don’t match/);
  assert.equal(passwordProblem('green kettle morning', 'green kettle morning', 'amy@clinic.co.uk'), null);
});

test('which password screen comes before the app', () => {
  assert.equal(passwordStep(false, true), 'create');    // first link sign-in
  assert.equal(passwordStep(undefined, false), 'create'); // signed in before passwords existed
  assert.equal(passwordStep(true, true), 'new');        // used a link because they forgot it, or first time in this app
  assert.equal(passwordStep(true, false), undefined);   // signed in with their password
});

test('sign-in and save errors in plain words', () => {
  assert.match(passwordSignInError({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }), /don’t match.*sign-in link/);
  assert.match(passwordSignInError({ status: 400, code: 'invalid_grant', message: 'Invalid login credentials' }), /don’t match/);
  assert.match(passwordSignInError({ status: 400, code: 'email_not_confirmed' }), /invitation/);
  assert.match(passwordSignInError({ status: 429 }), /Wait a minute/);
  assert.match(passwordSignInError({ status: 0 }), /couldn’t be reached/);
  assert.equal(setPasswordError({ status: 422, code: 'weak_password', message: 'Password should contain at least one number.' }), 'Password should contain at least one number.');
  assert.match(setPasswordError({ status: 400, code: 'reauthentication_needed' }), /new sign-in link/);
  assert.match(setPasswordError({ status: 401 }), /run out/);
  assert.ok(isSamePassword('same_password'));
  assert.ok(isSamePassword('', 'New password should be different from the old password.'));
  assert.ok(!isSamePassword('weak_password', 'Password is too weak'));
});

test('an expired link explains itself', () => {
  assert.match(linkErrorFromHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')!, /expired or was already used/);
  assert.match(linkErrorFromHash('#error=server_error&error_description=Something')!, /didn’t work/);
  assert.equal(linkErrorFromHash('#access_token=abc&refresh_token=def'), null);
  assert.equal(linkErrorFromHash(''), null);
});
