import test from 'node:test';
import assert from 'node:assert/strict';
import { humanizePlatformError } from '../public/modules/platform-errors.js';

test('maps Facebook missing-object Graph errors to operator-facing Chinese', () => {
  const message = humanizePlatformError(
    "Unsupported post request. Object with ID '1701654120897096' does not exist, cannot be loaded due to missing permissions, or does not support this operation. Please read the Graph API documentation at https://developers.facebook.com/docs/graph-api",
  );
  assert.match(message, /粉專 ID|Page token|me\/accounts/);
  assert.equal(/Unsupported post request/.test(message), false);
});
