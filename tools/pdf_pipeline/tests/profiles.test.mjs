import test from 'node:test';
import assert from 'node:assert/strict';
import { parametersFor } from '../ocr/profiles.mjs';

test('normal text retains its character alphabet; numeric labels use a fixed alphabet', () => {
  const standard = parametersFor({ languages: 'eng+hin', psm: 3 });
  assert.equal(standard.tessedit_char_whitelist, undefined);
  const numeric = parametersFor({ languages: 'eng', psm: 7, profile: 'numeric_label' });
  assert.equal(numeric.tessedit_char_whitelist, '0123456789.');
  assert.throws(() => parametersFor({ languages: 'eng', psm: 7, profile: 'numeric_label', expected_sequence: ['99', '4'] }));
});

test('numeric priors cannot silently affect Hindi, prose layouts or arbitrary profiles', () => {
  for (const job of [
    {languages:'hin',psm:7,profile:'numeric_label'},
    {languages:'eng',psm:3,profile:'numeric_label'},
    {languages:'eng',psm:7,profile:'expected_1_to_9'},
  ]) assert.throws(() => parametersFor(job));
});
