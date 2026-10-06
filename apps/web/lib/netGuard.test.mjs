import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, fetchableUrl } from './netGuard.mjs';

test('ordinary public addresses pass', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '151.101.1.69', '2606:2800:220:1:248:1893:25c8:1946']) assert.equal(isPublicAddress(ip), true, ip);
});

test('loopback, private and link-local addresses do not', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', 'fec0::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '198.18.0.1', '192.0.0.8']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('what is not an address does not pass', () => {
  for (const ip of ['', 'example.com', '999.1.1.1', null, undefined]) assert.equal(isPublicAddress(ip), false, String(ip));
});

test('the edges of the private ranges are right', () => {
  assert.equal(isPublicAddress('172.15.0.1'), true);
  assert.equal(isPublicAddress('172.32.0.1'), true);
  assert.equal(isPublicAddress('100.63.0.1'), true);
  assert.equal(isPublicAddress('100.128.0.1'), true);
});

test('a website address with or without its scheme is fetchable', () => {
  assert.equal(fetchableUrl('https://www.pizzeria-roma.hu/menu').hostname, 'www.pizzeria-roma.hu');
  assert.equal(fetchableUrl('pizzeria-roma.hu').href, 'https://pizzeria-roma.hu/');
  assert.equal(fetchableUrl('http://roma.hu').protocol, 'http:');
});

test('local targets, bare addresses and other schemes are not', () => {
  for (const raw of ['http://localhost:3000', 'http://127.0.0.1/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest/meta-data', 'http://printer.local', 'http://db.internal', 'file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'javascript:alert(1)', '', 'not a url', 'http://intranet', 'http://example.com:6379/', 'https://example.com:8443/']) {
    assert.equal(fetchableUrl(raw), null, raw);
  }
});
