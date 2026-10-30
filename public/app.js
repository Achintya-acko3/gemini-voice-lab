import {GoogleGenAI} from '/vendor/genai.js';
import {decodeEvent, sanitizeEvent, MODEL, MODELS} from './protocol.js';
import {AudioIO} from './audio.js';

const $ = id => document.getElementById(id);
let session = null, epoch = 0, connected = false, micOn = false, micPending = false;
let active = {}, entries = [], events = [], thoughtChunks = 0, sessionNumber = 0, sessionConfig = null;
let eventRenderTimer, connectionTimer;
let currentModel = MODEL, runs = [], currentRun = null;
function renderRuns() {
  $('runs').replaceChildren();
  for (const run of runs) {
    const row = document.createElement('tr');
    for (const value of [`${run.id} · ${MODELS[run.model].label}`, run.level, run.summaryChunks, run.summaryCharacters, run.utterances, run.state]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    $('runs').append(row);
  }
}
function updateRun(state) {
  if (!currentRun) return;
  if (state) currentRun.state = state;
  renderRuns();
}
const audio = new AudioIO(rms => { $('meter-fill').style.width = `${Math.min(100, rms * 500)}%`; });
const time = () => new Date().toISOString();
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function log(type, payload = {}) {
  events.push({time: time(), session: sessionNumber, model: currentModel, type, payload: sanitizeEvent(payload)});
  $('event-count').textContent = events.length;
  if (!eventRenderTimer) eventRenderTimer = setTimeout(() => {
    $('events').textContent = events.slice(-80).map(e => `${e.time}  run ${e.session} · ${e.model} · ${e.type}\n${JSON.stringify(e.payload, null, 2)}`).join('\n\n');
    eventRenderTimer = null;
  }, 180);
}
function append(role, text, continuing = true) {
  if (!text) return;
  const feed = $(role === 'thought' ? 'thoughts' : 'conversation');
  const follow = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
  let item = continuing ? active[role] : null;
  if (!item) {
    feed.querySelector('.empty')?.remove();
    const element = document.createElement('article'); element.className = `entry ${role}`;
    const meta = document.createElement('div'); meta.className = 'entry-meta';
    const name = document.createElement('span'); name.textContent = {user:'You', model:'Gemini', thought:'Thought summary', system:'Session'}[role];
    const stamp = document.createElement('span'); stamp.textContent = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    meta.append(name, stamp); const p = document.createElement('p'); element.append(meta, p); feed.append(element);
    name.textContent += ` · run ${sessionNumber}`;
    const record = {role, text: '', time: time(), session: sessionNumber, model: currentModel}; entries.push(record);
    item = {p, element, record}; if (continuing) active[role] = item;
  }
  item.record.text += text; item.p.textContent = item.record.text;
  $('message-count').textContent = `${entries.filter(e => ['user','model'].includes(e.role)).length} MESSAGES`;
  if (follow) feed.scrollTop = feed.scrollHeight;
}
function setConnected(value) {
  connected = value; $('connection').textContent = value ? 'Connected' : 'Disconnected'; $('connection').classList.toggle('live', value);
  $('settings').disabled = value; $('connect').disabled = value; $('disconnect').disabled = !value;
  $('mic').disabled = !value; $('prompt').disabled = !value; $('send').disabled = !value;
}
function resetMicUI() { micOn = false; micPending = false; $('mic').textContent = '◉ Turn mic on'; $('mic').classList.remove('active'); $('audio-status').textContent = 'Mic off'; }
function cleanup() { if (currentRun) { currentRun.endedAt = time(); updateRun('closed'); } clearTimeout(connectionTimer); audio.close(); resetMicUI(); active = {}; session = null; setConnected(false); $('reasoning').textContent = 'WAITING'; }
function endSession() { ++epoch; const current = session; cleanup(); try { current?.close(); } catch {} log('disconnected'); notice('Session ended. Your transcript and summaries are still available to export.'); }
function onMessage(message) {
  log('server', message);
  if (currentRun) {
    for (const part of message.serverContent?.modelTurn?.parts || []) {
      if (part.thought) currentRun.evidence.thoughtParts++;
      if (part.thoughtSignature) currentRun.evidence.signatureParts++;
      if (part.text && !part.thought) currentRun.evidence.unmarkedTextParts++;
      if (part.inlineData?.mimeType?.startsWith('audio/')) currentRun.evidence.audioParts++;
    }
  }
  for (const action of decodeEvent(message, currentModel)) {
    if (action.type === 'interrupted') {
      audio.stopPlayback();
      for (const role of ['model','thought']) {
        if (active[role]) { active[role].record.interrupted = true; active[role].element.classList.add('interrupted'); delete active[role]; }
      }
      notice('Interrupted. Listening for your next request.');
    } else if (action.type === 'transcript') {
      append(action.role, action.text);
      if (action.finished) delete active[action.role];
    } else if (action.type === 'thought') {
      append('thought', action.text); $('thought-count').textContent = ++thoughtChunks;
      currentRun.summaryChunks++; currentRun.summaryCharacters += action.text.length;
    } else if (action.type === 'audio') {
      audio.play(action.data, action.mimeType);
    } else if (action.type === 'modelText') {
      // Audio transcription is the canonical spoken transcript. Retain other text as a separate event.
      log('model-text', {text: action.text});
    } else if (action.type === 'utteranceComplete') {
      delete active.model; delete active.user; currentRun.utterances++;
      // Extended Thinking may emit more utterances; only interactionStatus says it is idle.
    } else if (action.type === 'status') {
      currentRun.lastInteractionStatus = action.status;
      updateRun(action.status === 'IDLE' ? 'idle' : 'processing');
      $('reasoning').textContent = action.status === 'IN_PROGRESS' ? 'THINKING' : action.status === 'IDLE' ? 'IDLE' : action.status;
      if (action.status === 'IDLE') {
        delete active.thought;
        notice(thoughtChunks ? 'Ready for your next message.' : 'Ready for your next message. No thought summary has been returned yet.');
      }
    } else if (action.type === 'usage') {
      currentRun.usage = action.data;
      $('tokens').textContent = action.data.totalTokenCount?.toLocaleString() ?? '—';
    } else if (action.type === 'goAway') {
      notice('Google will close this connection shortly. End the session and start a new one to continue.');
    }
  }
  updateRun();
}
$('connect').addEventListener('click', async () => {
  const currentEpoch = ++epoch; sessionNumber++; active = {}; thoughtChunks = 0; sessionConfig = null;
  currentModel = $('model').value;
  $('thought-count').textContent = '0'; $('tokens').textContent = '—';
  currentRun = {id: sessionNumber, model: currentModel, startedAt: time(), level: $('level').value, voice: $('voice').value, state: 'connecting', summaryChunks: 0, summaryCharacters: 0, utterances: 0, evidence: {thoughtParts: 0, signatureParts: 0, unmarkedTextParts: 0, audioParts: 0}};
  runs.push(currentRun); renderRuns();
  $('connect').disabled = true; $('settings').disabled = true; $('disconnect').disabled = false;
  $('connection').textContent = 'Connecting…'; notice('Creating a temporary token and opening the Live session…');
  const input = {model: currentModel, apiKey: $('key').value.trim(), level: $('level').value, voice: $('voice').value, instruction: $('instruction').value};
  try {
    await audio.prepare();
    const response = await fetch('/api/token', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input), signal:AbortSignal.timeout(35000)});
    const result = await response.json(); input.apiKey = ''; $('key').value = '';
    if (currentEpoch !== epoch) return;
    if (!response.ok) throw new Error(result.error || 'Token creation failed.');
    currentModel = result.model; sessionConfig = result.config; currentRun.config = result.config;
    const ai = new GoogleGenAI({apiKey: result.token, httpOptions:{apiVersion:'v1beta'}});
    connectionTimer = setTimeout(() => { if (currentEpoch === epoch) { endSession(); updateRun('error'); notice('Connection timed out. Check model access and try again.', true); } }, 20000);
    const live = await ai.live.connect({model:result.model, config:result.config, callbacks:{
      onopen: () => { if (currentEpoch === epoch) log('socket-open'); },
      onmessage: message => { if (currentEpoch === epoch) { try { onMessage(message); } catch (error) { notice(error.message, true); log('processing-error', {message:error.message}); } } },
      onerror: () => { if (currentEpoch === epoch) { endSession(); updateRun('error'); notice('Live connection error. Verify model access, API key, and network connectivity.', true); } },
      onclose: event => {
        if (currentEpoch !== epoch) return;
        ++epoch; cleanup(); updateRun(event.code === 1000 ? 'closed' : 'error'); log('socket-close', {code:event.code, reason:event.reason});
        notice(event.code === 1000 ? 'Session closed.' : `Connection closed (${event.code}). ${event.reason || 'Check model access and try again.'}`, event.code !== 1000);
      },
    }});
    if (currentEpoch !== epoch) { live.close(); return; }
    clearTimeout(connectionTimer); session = live; setConnected(true); $('reasoning').textContent = 'READY';
    updateRun('connected'); log('connected', {model:currentModel, config:sessionConfig});
    append('system', `Session ${sessionNumber} · ${MODELS[currentModel].label} · ${input.level} thinking · ${input.voice}`, false);
    notice('Connected. Turn on your microphone or send a text message.');
  } catch (error) {
    input.apiKey = ''; $('key').value = '';
    if (currentEpoch !== epoch) return;
    ++epoch; cleanup(); updateRun('error'); notice(error.message, true); log('connection-error', {message:error.message});
  }
});
$('disconnect').addEventListener('click', endSession);
$('model').addEventListener('change', () => { $('model-note').textContent = $('model').value; });
$('sample').addEventListener('click', () => {
  $('prompt').value = 'Three boxes are labeled Apples, Oranges, and Mixed. Every label is wrong. You may draw one fruit from one box without looking inside. Which box should you choose, and how can you correctly label all three? Explain your answer briefly.';
  if (connected) $('prompt').focus();
  notice('Comparison prompt loaded. Send it in a fresh session on each model with identical settings.');
});
$('mic').addEventListener('click', async () => {
  if (!session || micPending) return;
  if (micOn) {
    audio.stopMic(); resetMicUI();
    try { session.sendRealtimeInput({audioStreamEnd:true}); log('microphone-off'); } catch (error) { notice(error.message, true); }
    return;
  }
  const currentEpoch = epoch; micPending = true; $('mic').disabled = true;
  try {
    const started = await audio.startMic(chunk => {
      if (session && currentEpoch === epoch) {
        try { session.sendRealtimeInput({audio:chunk}); } catch { audio.stopMic(); resetMicUI(); notice('Microphone stream stopped. Reconnect to continue.', true); }
      }
    });
    if (!started || currentEpoch !== epoch || !connected) return;
    micOn = true; $('mic').textContent = '■ Turn mic off'; $('mic').classList.add('active'); $('audio-status').textContent = 'Mic live'; log('microphone-on'); notice('Listening. Speak naturally; you can interrupt Gemini.');
  } catch (error) {
    audio.stopMic(); resetMicUI();
    notice(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser, or use text input.' : `Microphone unavailable: ${error.message}`, true);
  } finally { micPending = false; $('mic').disabled = !connected; }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!session || !text) return;
  try {
    await audio.prepare();
    session.sendRealtimeInput({text});
    delete active.user; append('user', text, false); $('prompt').value = ''; log('user-text', {text}); notice('Message sent. Waiting for Gemini…');
  } catch (error) { notice(error.message, true); }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({schemaVersion:2, exportedAt:time(), runs, conversation:entries.filter(e => e.role !== 'thought'), thoughtSummaries:entries.filter(e => e.role === 'thought'), events}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `gemini-session-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => { ++epoch; try { session?.close(); } catch {} audio.close(); });
fetch('/api/health').then(r => r.json()).then(health => {
  if (health.serverKey) { $('key').placeholder = 'Configured on local server'; $('key').disabled = true; $('key-note').textContent = 'Using GEMINI_API_KEY from the local server environment.'; notice('Server API key configured. Start a session when ready.'); }
}).catch(() => notice('Local server unavailable. Run npm start and open http://localhost:8787.', true));
