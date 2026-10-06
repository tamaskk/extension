import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open } from './secretBox.mjs';

// fixed keys, 32 bytes each
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const SECRET = 'abcd efgh ijkl mnop';

test('what is sealed opens to the same text', () => {
  const sealed = seal(SECRET, KEY);

  assert.equal(open(sealed, KEY), SECRET);
});

test('the sealed text does not contain the secret and carries the version', () => {
  const sealed = seal(SECRET, KEY);

  assert.ok(sealed.startsWith('v1:'));
  assert.equal(sealed.split(':').length, 4);
  assert.ok(!sealed.includes(SECRET));
  assert.ok(!sealed.includes(Buffer.from(SECRET).toString('base64')));
});

test('the same secret sealed twice gives two different texts', () => {
  const first = seal(SECRET, KEY);
  const second = seal(SECRET, KEY);

  assert.notEqual(first, second);
  assert.equal(open(first, KEY), open(second, KEY));
});

test('one changed character in the ciphertext makes open throw', () => {
  const parts = seal(SECRET, KEY).split(':');
  const data = Buffer.from(parts[3], 'base64');
  data[0] ^= 1;
  parts[3] = data.toString('base64');

  assert.throws(() => open(parts.join(':'), KEY), /could not be opened/);
});

test('a changed tag makes open throw', () => {
  const parts = seal(SECRET, KEY).split(':');
  const tag = Buffer.from(parts[2], 'base64');
  tag[0] ^= 1;
  parts[2] = tag.toString('base64');

  assert.throws(() => open(parts.join(':'), KEY), /could not be opened/);
});

test('another key does not open it', () => {
  const sealed = seal(SECRET, KEY);

  assert.throws(() => open(sealed, OTHER_KEY), /could not be opened/);
});

test('a missing key is a clear error, for sealing and for opening', () => {
  const sealed = seal(SECRET, KEY);

  assert.throws(() => seal(SECRET, ''), /OUTREACH_SECRET_KEY is not set/);
  assert.throws(() => open(sealed, ''), /OUTREACH_SECRET_KEY is not set/);
});

test('a key of the wrong length is refused', () => {
  assert.throws(() => seal(SECRET, Buffer.alloc(16, 1).toString('base64')), /must be 32 bytes/);
  assert.throws(() => seal(SECRET, 'not base64 at all'), /must be 32 bytes/);
});

test('a key with quotes or stray characters around it is refused', () => {
  for (const bad of [`"${KEY}"`, KEY + '!!!', ' ' + KEY, KEY.slice(0, -1)]) {
    assert.throws(() => seal(SECRET, bad), /must be 32 bytes/, bad);
  }
});

test('an empty secret is not sealed', () => {
  assert.throws(() => seal('', KEY), /nothing to seal/);
  assert.throws(() => seal(undefined, KEY), /nothing to seal/);
});

test('plain text and other formats are not opened', () => {
  for (const bad of ['', SECRET, 'v2:a:b:c', 'v1:a:b', 'v1:AAAA:AAAA:AAAA']) {
    assert.throws(() => open(bad, KEY), /not a sealed value/, bad);
  }
});

test('the error of a failed open does not repeat the sealed text', () => {
  const sealed = seal(SECRET, KEY);

  assert.throws(() => open(sealed, OTHER_KEY), (e) => !e.message.includes(sealed.split(':')[3]) && !e.message.includes(SECRET));
});
