import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { requestForActor } from '../hq/src/actor-request.js';
import { createActorStorage } from '../hq/src/actor-storage.js';
import { filmCacheForActor, savePendingFilmUpload } from '../hq/src/film-upload-cache.js';
import { setActiveActor } from '../hq/src/room-actor.js';

test('private browser drafts stay with their account and tolerate blocked storage', () => {
  const entries = new Map();
  const provider = () => ({ getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) });
  for (const namespace of ['agent4-chat-v1', 'agent4.film-room.session']) {
    const owner = createActorStorage(namespace, 'owner-example', provider);
    const member = createActorStorage(namespace, 'member-example', provider);
    owner.write({ text: 'Private owner draft' });
    assert.equal(member.read(null), null);
    member.write({ text: 'Private member draft' });
    assert.deepEqual(owner.read(null), { text: 'Private owner draft' });
    assert.deepEqual(member.read(null), { text: 'Private member draft' });
  }
  const unavailable = createActorStorage('draft', 'owner-example', () => { throw new Error('Storage blocked'); });
  assert.equal(unavailable.read(null), null);
  assert.equal(unavailable.write('draft'), false);
  const signedOut = createActorStorage('draft', null, provider);
  assert.equal(signedOut.write('draft'), false);
  assert.equal(signedOut.read(null), null);
});

test('recording recovery and in-flight uploads remain isolated across account changes', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { indexedDB: new IDBFactory() };
  const owner = filmCacheForActor('owner-example');
  const member = filmCacheForActor('member-example');
  try {
    setActiveActor({ id: 'owner-example' });
    const pendingSave = savePendingFilmUpload({ blob: new Blob(['owner upload']) });
    setActiveActor({ id: 'member-example' });
    assert.equal(await pendingSave, true);
    assert.equal(await member.loadPendingFilmUpload(), undefined);
    assert.equal(await (await owner.loadPendingFilmUpload()).blob.text(), 'owner upload');

    const ownerSession = await owner.startRecordingSession({ title: 'Owner meeting' });
    assert.ok(ownerSession);
    assert.equal(await owner.appendRecordingChunk(ownerSession, 1, new Blob(['two'])), true);
    assert.equal(await owner.appendRecordingChunk(ownerSession, 0, new Blob(['one '])), true);
    const memberSession = await member.startRecordingSession({ title: 'Member meeting' });
    assert.ok(memberSession);
    assert.equal(await member.appendRecordingChunk(memberSession, 0, new Blob(['member audio'])), true);
    assert.equal(await (await owner.loadRecoveredRecording()).blob.text(), 'one two');
    assert.equal(await (await member.loadRecoveredRecording()).blob.text(), 'member audio');

    // Late recorder callbacks keep the account captured at mount time.
    assert.equal(await owner.updateRecordingSession(ownerSession, { title: 'Owner final title' }), true);
    assert.equal((await owner.loadRecoveredRecording()).session.title, 'Owner final title');
    assert.equal((await member.loadRecoveredRecording()).session.title, 'Member meeting');
    assert.equal(await member.clearRecordingSession(), true);
    assert.equal(await member.loadRecoveredRecording(), null);
    assert.equal(await (await owner.loadRecoveredRecording()).blob.text(), 'one two');
    assert.equal(await member.clearPendingFilmUpload(), true);
    assert.equal(await (await owner.loadPendingFilmUpload()).blob.text(), 'owner upload');
  } finally {
    setActiveActor(null);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});


test('delayed workflows cannot send requests or accept results after switching accounts', async () => {
  setActiveActor({ id: 'owner-example' });
  let calls = 0;
  let finish;
  const request = requestForActor('owner-example', () => {
    calls += 1;
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    const pending = request('/private');
    setActiveActor({ id: 'member-example' });
    finish({ private: 'owner response' });
    await assert.rejects(pending, /account changed/);
    await assert.rejects(request('/late-write', { method: 'POST' }), /account changed/);
    assert.equal(calls, 1, 'no network request starts using the next account');
  } finally {
    setActiveActor(null);
  }
});
