import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, publicOrigin } from '../src/config.js';

test('fresh configuration requires authentication and has no account, company contacts or external connections', async () => {
  const config = await loadConfig();
  assert.equal(config.runtime.agent4AuthRequired, true);
  assert.equal(config.runtime.ownerTimeZone, 'UTC');
  assert.equal(config.runtime.clientPagesEnabled, false);
  assert.equal(config.runtime.publicInquiryEnabled, false);
  for (const field of ['telegramBotToken','telegramOwnerUserId','telegramOwnerChatId','clientEmail','clientWhatsapp','clientPagesUrl','openaiApiKey','agent4GithubToken','googleCalendarClientSecret']) assert.equal(config.runtime[field], '', field);
  assert.equal(config.company.website, '');
});
test('public origins reject credentials, paths and insecure public hosting', () => {
  for (const value of ['https://owner:password@example.com','https://example.com/path','https://example.com?x=1','https://example.com/#token','http://example.com','file:///tmp/app']) assert.throws(() => publicOrigin(value));
  assert.equal(publicOrigin('https://workspace.example.com/'), 'https://workspace.example.com');
  assert.equal(publicOrigin('http://localhost:8782'), 'http://localhost:8782');
});
test('unsafe configuration fails closed', async () => {
  for (const [key, value] of [['AGENT4_AUTH_REQUIRED','false'],['AGENT4_TIME_ZONE','Invalid/Zone'],['AGENT4_VOICE_MAX_BYTES','99999999'],['AGENT4_SESSION_HOURS','0']]) {
    const previous = process.env[key]; process.env[key] = value;
    try { await assert.rejects(loadConfig(), new RegExp(key === 'AGENT4_AUTH_REQUIRED' ? 'requires authentication' : key)); }
    finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
  }
});
