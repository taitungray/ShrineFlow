import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSettingsPage,
  parsePlatformsPage,
  platformsHash,
  legacySettingsToPlatformsHash,
  SETTINGS_PAGES,
  PLATFORMS_PAGES,
} from '../public/modules/settings-page.js';
import { routeFromHash } from '../public/modules/tabs.js';

test('parseSettingsPage treats bare settings hash as gemini', () => {
  assert.equal(parseSettingsPage('#/settings'), 'gemini');
  assert.equal(parseSettingsPage('#/settings/'), 'gemini');
  assert.equal(parseSettingsPage('settings'), 'gemini');
});

test('parseSettingsPage reads known settings pages from hash', () => {
  assert.equal(parseSettingsPage('#/settings/brand'), 'brand');
  assert.equal(parseSettingsPage('#/settings/backup'), 'backup');
  assert.equal(parseSettingsPage('#/settings/gemini'), 'gemini');
});

test('parseSettingsPage ignores legacy platform hashes so they can redirect', () => {
  assert.equal(parseSettingsPage('#/settings/facebook'), '');
  assert.equal(parseSettingsPage('#/settings/instagram'), '');
  assert.equal(parseSettingsPage('#/settings/threads'), '');
});

test('parseSettingsPage falls back to gemini for unknown settings pages', () => {
  assert.equal(parseSettingsPage('#/settings/unknown'), 'gemini');
});

test('parseSettingsPage ignores non-settings hashes', () => {
  assert.equal(parseSettingsPage('#/help'), '');
  assert.equal(parseSettingsPage('#/overview'), '');
  assert.equal(parseSettingsPage('#/platforms'), '');
  assert.equal(parseSettingsPage(''), '');
});

test('SETTINGS_PAGES lists system settings tabs only', () => {
  assert.deepEqual([...SETTINGS_PAGES], ['gemini', 'brand', 'backup']);
});

test('parsePlatformsPage treats bare platforms hash as overview', () => {
  assert.equal(parsePlatformsPage('#/platforms'), 'overview');
  assert.equal(parsePlatformsPage('#/platforms/'), 'overview');
  assert.equal(parsePlatformsPage('platforms'), 'overview');
});

test('parsePlatformsPage reads platform credential pages', () => {
  assert.equal(parsePlatformsPage('#/platforms/facebook'), 'facebook');
  assert.equal(parsePlatformsPage('#/platforms/instagram'), 'instagram');
  assert.equal(parsePlatformsPage('#/platforms/threads'), 'threads');
});

test('parsePlatformsPage maps legacy settings platform hashes', () => {
  assert.equal(parsePlatformsPage('#/settings/facebook'), 'facebook');
  assert.equal(parsePlatformsPage('#/settings/instagram'), 'instagram');
  assert.equal(parsePlatformsPage('#/settings/threads'), 'threads');
});

test('parsePlatformsPage falls back to overview for unknown platform pages', () => {
  assert.equal(parsePlatformsPage('#/platforms/unknown'), 'overview');
});

test('PLATFORMS_PAGES lists overview and credential tabs', () => {
  assert.deepEqual([...PLATFORMS_PAGES], ['overview', 'facebook', 'instagram', 'threads']);
});

test('platformsHash writes overview as bare platforms route', () => {
  assert.equal(platformsHash('overview'), '#/platforms');
  assert.equal(platformsHash('facebook'), '#/platforms/facebook');
  assert.equal(platformsHash('unknown'), '#/platforms');
});

test('legacySettingsToPlatformsHash rewrites old settings platform URLs', () => {
  assert.equal(legacySettingsToPlatformsHash('#/settings/facebook'), '#/platforms/facebook');
  assert.equal(legacySettingsToPlatformsHash('#/settings/instagram'), '#/platforms/instagram');
  assert.equal(legacySettingsToPlatformsHash('#/settings/threads'), '#/platforms/threads');
  assert.equal(legacySettingsToPlatformsHash('#/settings/gemini'), '');
});

test('routeFromHash sends platform credential paths to platforms view', () => {
  assert.deepEqual(routeFromHash('#/platforms'), { view: 'platforms', path: 'platforms' });
  assert.deepEqual(routeFromHash('#/platforms/facebook'), { view: 'platforms', path: 'platforms/facebook' });
  assert.deepEqual(routeFromHash('#/settings/facebook'), { view: 'platforms', path: 'platforms/facebook' });
  assert.deepEqual(routeFromHash('#/settings/instagram'), { view: 'platforms', path: 'platforms/instagram' });
  assert.deepEqual(routeFromHash('#/settings/threads'), { view: 'platforms', path: 'platforms/threads' });
  assert.deepEqual(routeFromHash('#/settings'), { view: 'settings', path: 'settings' });
  assert.deepEqual(routeFromHash('#/settings/gemini'), { view: 'settings', path: 'settings/gemini' });
});
