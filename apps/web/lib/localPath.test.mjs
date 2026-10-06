import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPath } from './localPath.mjs';

test('keeps a path on this site', () => {
  assert.equal(localPath('/'), '/');
  assert.equal(localPath('/leads'), '/leads');
  assert.equal(localPath('/leads?view=map#top'), '/leads?view=map#top');
});

test('falls back to / when the parameter is missing', () => {
  assert.equal(localPath(null), '/');
  assert.equal(localPath(undefined), '/');
  assert.equal(localPath(''), '/');
});

test('rejects another origin', () => {
  assert.equal(localPath('https://evil.example'), '/');
  assert.equal(localPath('//evil.example'), '/');
  assert.equal(localPath('evil.example'), '/');
});

test('rejects script and data URLs', () => {
  assert.equal(localPath('javascript:alert(1)'), '/');
  assert.equal(localPath('data:text/html,<script>alert(1)</script>'), '/');
});

test('rejects what a browser would normalise into another origin', () => {
  assert.equal(localPath('/\\evil.example'), '/');
  assert.equal(localPath('/\t/evil.example'), '/');
  assert.equal(localPath('/\n/evil.example'), '/');
  assert.equal(localPath('\\\\evil.example'), '/');
});
