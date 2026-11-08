import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksTo, socialLabel, socialUrl } from '../shared/social';
import { emptyProfile, SECTIONS as sections, validateSection } from '../src/lib/questions';
import { socialIssues, socialLinksIn } from '../netlify/lib/watcher';

test('Instagram and Facebook: handles and links become one clean link', () => {
  assert.equal(socialUrl('instagram', '@willowskin'), 'https://www.instagram.com/willowskin/');
  assert.equal(socialUrl('instagram', 'willowskin'), 'https://www.instagram.com/willowskin/');
  assert.equal(socialUrl('instagram', 'instagram.com/willowskin?igsh=abc'), 'https://www.instagram.com/willowskin/');
  assert.equal(socialUrl('instagram', 'https://www.facebook.com/willow'), '');
  assert.equal(socialUrl('facebook', 'facebook.com/WillowSkinBeauty/'), 'https://www.facebook.com/WillowSkinBeauty');
  assert.equal(socialUrl('facebook', 'https://m.facebook.com/profile.php?id=1234'), 'https://www.facebook.com/profile.php?id=1234');
  assert.equal(socialUrl('facebook', ''), '');
  assert.equal(socialLabel('instagram', 'https://www.instagram.com/willowskin/'), '@willowskin');
});

test('website, Instagram and Facebook are all optional', () => {
  const p = emptyProfile();
  const first = sections[0];
  const errors = validateSection(first, p);
  assert.ok(!errors['business.website']);
  assert.ok(!errors['business.instagram']);
  assert.ok(!errors['business.facebook']);
  p.business.instagram = 'not a valid handle!!';
  assert.ok(validateSection(first, p)['business.instagram']);
});

test('a competitor without a website is accepted', () => {
  const p = emptyProfile();
  const sec = sections.find((s) => s.fields.some((f) => f.kind === 'competitors'))!;
  p.competitors.list = [{ name: 'The Beauty Room', url: '' }];
  assert.ok(!validateSection(sec, p)['competitors.list']);
  p.competitors.list = [{ name: 'The Beauty Room', url: 'not a site' }];
  assert.ok(validateSection(sec, p)['competitors.list']);
});

test('the Watcher flags a website that doesn’t link to the owner’s pages, and only then', () => {
  const html = '<footer><a href="https://instagram.com/willowskin">IG</a></footer>';
  const links = socialLinksIn([html]);
  assert.ok(linksTo('instagram', 'https://www.instagram.com/willowskin/', links));
  const profile = { business: { instagram: '@willowskin', facebook: 'facebook.com/willowskin' } };
  const issues = socialIssues(profile, 'https://willow.example', { up: true, socialLinks: links });
  assert.deepEqual(issues.map((i) => i.id), ['social-facebook']);
  assert.deepEqual(socialIssues(profile, '', { up: true, socialLinks: [] }), []);
  assert.deepEqual(socialIssues({ business: {} }, 'https://willow.example', { up: true, socialLinks: [] }), []);
});
