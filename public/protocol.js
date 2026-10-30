export const MODEL = 'gemini-3.8-live-extended-thinking';
export const MODELS = Object.freeze({
  [MODEL]: {label: 'Gemini 3.8 Extended Thinking', asyncReasoning: true},
  'gemini-3.1-flash-live-preview': {label: 'Gemini 3.1 Flash Live', asyncReasoning: false},
});
export function modelProfile(model = MODEL) {
  if (!Object.hasOwn(MODELS, model)) throw new Error('Choose a supported Live model.');
  return MODELS[model];
}
export function liveConfig({model = MODEL, level = 'high', voice = 'Kore', instruction = ''} = {}) {
  modelProfile(model);
  if (!['low', 'medium', 'high'].includes(level)) throw new Error('Choose low, medium, or high thinking.');
  if (!['Kore', 'Puck', 'Aoede', 'Charon', 'Fenrir'].includes(voice)) throw new Error('Unsupported voice.');
  return {
    responseModalities: ['AUDIO'],
    thinkingConfig: {thinkingLevel: level, includeThoughts: true},
    inputAudioTranscription: {}, outputAudioTranscription: {},
    speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}},
    systemInstruction: instruction || 'You are a helpful voice assistant. Give clear, conversational answers. Explain conclusions when useful.',
    contextWindowCompression: {slidingWindow: {}},
  };
}

// One event may contain audio, summaries, and transcriptions together.
export function decodeEvent(message, model = MODEL) {
  const content = message.serverContent || {};
  const actions = [];
  if (content.interrupted) actions.push({type: 'interrupted'});
  if (content.inputTranscription) actions.push({type: 'transcript', role: 'user', ...content.inputTranscription});
  for (const part of content.modelTurn?.parts || []) {
    if (part.text) actions.push({type: part.thought ? 'thought' : 'modelText', text: part.text});
    if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) {
      actions.push({type: 'audio', ...part.inlineData});
    }
  }
  if (content.outputTranscription) actions.push({type: 'transcript', role: 'model', ...content.outputTranscription});
  if (content.turnComplete) actions.push({type: 'utteranceComplete'});
  const status = message.interactionStatus ?? content.interactionStatus ?? message.interaction_status;
  if (status) actions.push({type: 'status', status});
  else if (content.turnComplete && !modelProfile(model).asyncReasoning) actions.push({type: 'status', status: 'IDLE'});
  if (message.usageMetadata) actions.push({type: 'usage', data: message.usageMetadata});
  if (message.goAway) actions.push({type: 'goAway', data: message.goAway});
  return actions;
}

export function sanitizeEvent(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvent);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key,
    /^(data|thoughtSignature|thought_signature|apiKey|token|authorization)$/i.test(key) && typeof val === 'string'
      ? `[omitted: ${val.length} characters]` : sanitizeEvent(val)]));
}
