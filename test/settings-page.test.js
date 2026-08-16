import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettingsPage, SETTINGS_PAGES } from '../public/modules/settings-page.js';

test('parseSettingsPage treats bare settings hash as gemini', () => {
  assert.equal(parseSettingsPage('#/settings'), 'gemini');
  assert.equal(parseSettingsPage('#/settings/'), 'gemini');
  assert.equal(parseSettingsPage('settings'), 'gemini');
});

test('parseSettingsPage reads known settings pages from hash', () => {
  assert.equal(parseSettingsPage('#/settings/facebook'), 'facebook');
  assert.equal(parseSettingsPage('#/settings/instagram'), 'instagram');
  assert.equal(parseSettingsPage('#/settings/threads'), 'threads');
  assert.equal(parseSettingsPage('#/settings/brand'), 'brand');
  assert.equal(parseSettingsPage('#/settings/backup'), 'backup');
  assert.equal(parseSettingsPage('#/settings/gemini'), 'gemini');
});

test('parseSettingsPage falls back to gemini for unknown settings pages', () => {
  assert.equal(parseSettingsPage('#/settings/unknown'), 'gemini');
});

test('parseSettingsPage ignores non-settings hashes', () => {
  assert.equal(parseSettingsPage('#/help'), '');
  assert.equal(parseSettingsPage('#/overview'), '');
  assert.equal(parseSettingsPage(''), '');
});

test('SETTINGS_PAGES lists every settings tab', () => {
  assert.deepEqual([...SETTINGS_PAGES], ['gemini', 'brand', 'facebook', 'instagram', 'threads', 'backup']);
});
