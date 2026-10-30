import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeEvent, liveConfig, sanitizeEvent, MODEL, MODELS, modelProfile} from '../public/protocol.js';

test('processes all parts in a mixed Live message', () => {
  const actions = decodeEvent({interactionStatus:'IN_PROGRESS', serverContent:{
    inputTranscription:{text:'Question'}, outputTranscription:{text:'Answer'},
    modelTurn:{parts:[{thought:true,text:'Summary'},{inlineData:{data:'AAA=',mimeType:'audio/pcm;rate=24000'}},{text:'Additional text'}]}, turnComplete:true,
  }});
  assert.deepEqual(actions.map(a => a.type), ['transcript','thought','audio','modelText','transcript','utteranceComplete','status']);
  assert.equal(actions.at(-1).status, 'IN_PROGRESS');
});
test('utterance completion does not incorrectly infer idle', () => {
  assert.deepEqual(decodeEvent({serverContent:{turnComplete:true}}), [{type:'utteranceComplete'}]);
});
test('interruption is handled before any subsequent audio', () => {
  assert.deepEqual(decodeEvent({serverContent:{interrupted:true,modelTurn:{parts:[{inlineData:{data:'AA==',mimeType:'audio/pcm'}}]}}}).map(a=>a.type), ['interrupted','audio']);
});
test('preserves transcription completion and recognizes interaction status', () => {
  assert.deepEqual(decodeEvent({interactionStatus:'IDLE',serverContent:{inputTranscription:{text:'done',finished:true}}}), [{type:'transcript',role:'user',text:'done',finished:true},{type:'status',status:'IDLE'}]);
});
test('config enables actual API summaries and both transcriptions', () => {
  const config = liveConfig(); assert.deepEqual(config.thinkingConfig, {thinkingLevel:'high',includeThoughts:true});
  assert.deepEqual(config.inputAudioTranscription, {}); assert.deepEqual(config.outputAudioTranscription, {});
  assert.throws(() => liveConfig({level:'minimal'}));
});
test('export sanitization removes binary payloads and secrets recursively', () => {
  const result = sanitizeEvent({apiKey:'secret',serverContent:{parts:[{text:'Keep me',thoughtSignature:'opaque',inlineData:{data:'audio'}}]}});
  const encoded = JSON.stringify(result); assert.ok(!encoded.includes('secret')); assert.ok(!encoded.includes('opaque')); assert.ok(!encoded.includes('"audio"')); assert.ok(encoded.includes('Keep me'));
});

test('both model configurations request identical thinking and transcription settings', () => {
  const config38 = liveConfig({model: MODEL, level: 'high'});
  const config31 = liveConfig({model: 'gemini-3.1-flash-live-preview', level: 'high'});
  assert.deepEqual(config31, config38);
  for (const model of Object.keys(MODELS)) {
    for (const level of ['low', 'medium', 'high']) {
      assert.deepEqual(liveConfig({model, level}).thinkingConfig, {thinkingLevel: level, includeThoughts: true});
    }
  }
});
test('unsupported models are rejected before token creation', () => {
  for (const model of ['other-model', '__proto__', 'constructor', null]) {
    assert.throws(() => liveConfig({model}));
    assert.throws(() => modelProfile(model));
  }
});
test('3.1 goes idle on turn completion but 3.8 keeps waiting for interaction status', () => {
  const message = {serverContent:{turnComplete:true}};
  assert.deepEqual(decodeEvent(message, 'gemini-3.1-flash-live-preview'), [{type:'utteranceComplete'}, {type:'status',status:'IDLE'}]);
  assert.deepEqual(decodeEvent(message, MODEL), [{type:'utteranceComplete'}]);
});
test('explicit interaction status takes precedence over inferred 3.1 completion', () => {
  const actions = decodeEvent({interactionStatus:'IN_PROGRESS',serverContent:{turnComplete:true}}, 'gemini-3.1-flash-live-preview');
  assert.equal(actions.filter(a => a.type === 'status').length, 1);
  assert.equal(actions.at(-1).status, 'IN_PROGRESS');
});
test('both models extract every thought part without mistaking signatures or regular text for thoughts', () => {
  const message = {serverContent:{modelTurn:{parts:[{thought:true,text:'First summary'}, {thoughtSignature:'opaque'}, {text:'Answer'}, {thought:true,text:'Second summary'}]}}};
  for (const model of Object.keys(MODELS)) {
    const actions = decodeEvent(message, model);
    assert.deepEqual(actions.filter(a => a.type === 'thought').map(a => a.text), ['First summary','Second summary']);
    assert.equal(actions.filter(a => a.type === 'modelText').length, 1);
  }
});
