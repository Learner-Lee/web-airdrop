/* QuickDrop: all file and text payloads travel over the encrypted DataChannel. */
'use strict';
const $ = id => document.getElementById(id);
const MAX_FILE = 100 * 1024 * 1024, CHUNK = 16384;
const state = { ws: null, pc: null, dc: null, room: new URL(location.href).searchParams.get('room'),
  candidates: [], ice: [], outgoing: null, receiving: null, sending: false, verified: false,
  peerVerified: false, sasReady: false, connected: false, generation: 0, retries: 0, reconnect: null,
  signalQueue: Promise.resolve(), messageQueue: Promise.resolve(), urls: new Set(), receivedBytes: 0 };
let noticeTimer;
function notify(message, permanent = false) {
  clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false;
  if (!permanent) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 12000);
}
function status(message, ready = false) { $('status').textContent = message; $('status').classList.toggle('ready', ready); }
function formatSize(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`; }
function setReady() {
  const ready = state.dc?.readyState === 'open' && state.verified && state.peerVerified;
  state.connected = ready; $('files').disabled = !ready || state.sending;
  $('dropzone').classList.toggle('disabled', !ready || state.sending);
  $('text').disabled = !ready; $('send-text').disabled = !ready;
  $('file-hint').textContent = ready ? '点击选择 · 支持一次选择多个文件' : '连接并确认配对后即可发送';
  $('verification').hidden = !state.sasReady || ready;
  $('pair-content').hidden = ready || state.sasReady;
  $('connected-info').hidden = !ready;
  $('connection-dot').classList.toggle('ready', ready);
  if (ready) { status('已连接', true); $('peer-status').textContent = '已连接'; }
}
function sendControl(message) {
  if (state.dc?.readyState !== 'open') throw new Error('连接已断开，请重新配对。');
  state.dc.send(JSON.stringify(message));
}
function signal(data) {
  if (state.ws?.readyState !== WebSocket.OPEN) throw new Error('信令连接已断开。');
  state.ws.send(JSON.stringify({ type: 'signal', data }));
}
function setItemResult(item, message, kind = '') {
  item.result.textContent = message; item.result.className = `result ${kind}`;
}
function item(title, subtitle, target = 'inbox') {
  if (target === 'inbox') $('empty-inbox').hidden = true;
  const root = document.createElement('div'); root.className = 'item';
  const name = document.createElement('strong'); name.textContent = title;
  const detail = document.createElement('p'); detail.textContent = subtitle;
  const result = document.createElement('span'); result.className = 'result';
  const actions = document.createElement('div'); actions.className = 'actions';
  root.append(name, detail, result, actions); $(target).prepend(root);
  return { root, detail, result, actions };
}
function progress(item) {
  if (!item.progress) { item.progress = document.createElement('progress'); item.progress.max = 1; item.progress.value = 0; item.root.insertBefore(item.progress, item.actions); }
  return item.progress;
}
function button(text, action, kind = 'secondary') {
  const node = document.createElement('button'); node.textContent = text; node.className = kind;
  node.addEventListener('click', action); return node;
}
function cancelOutgoing(message) {
  if (state.outgoing) { state.outgoing.abort.abort(new Error(message)); state.outgoing = null; }
}
function finishReceive(message, kind = 'error') {
  const receiver = state.receiving;
  if (!receiver) return;
  clearTimeout(receiver.timer); receiver.chunks = []; receiver.item.actions.replaceChildren();
  setItemResult(receiver.item, message, kind); state.receiving = null;
}
function resetPeer(message = '连接已断开，请重新配对。') {
  state.generation++;
  clearTimeout(state.iceTimer); clearTimeout(state.disconnectTimer);
  cancelOutgoing(message); finishReceive(message);
  if (state.dc) { state.dc.onclose = null; state.dc.close(); }
  if (state.pc) { state.pc.onconnectionstatechange = null; state.pc.close(); }
  state.pc = state.dc = null; state.candidates = [];
  state.verified = state.peerVerified = state.sasReady = false;
  $('verify').disabled = false; $('verify').textContent = '配对码一致，确认连接';
  $('peer-status').textContent = '等待加入'; setReady();
}
function ensurePeer() {
  if (state.pc) return state.pc;
  const pc = new RTCPeerConnection({ iceServers: state.ice,
    iceTransportPolicy: new URL(location.href).searchParams.get('relay') === '1' ? 'relay' : 'all' });
  state.pc = pc;
  state.iceTimer = setTimeout(() => { if (state.pc === pc && pc.connectionState !== 'connected') { resetPeer('连接超时，请新建房间重试。'); status('连接超时'); notify('两台设备未能建立连接，请新建房间重试。', true); } }, 45000);
  pc.onicecandidate = event => { if (event.candidate && state.pc === pc) { try { signal({ type: 'candidate', candidate: event.candidate }); } catch {} } };
  pc.ondatachannel = event => configureChannel(event.channel, pc);
  pc.onconnectionstatechange = () => {
    if (state.pc !== pc) return;
    if (pc.connectionState === 'connected') { clearTimeout(state.iceTimer); clearTimeout(state.disconnectTimer); }
    if (pc.connectionState === 'disconnected') state.disconnectTimer = setTimeout(() => {
      if (state.pc === pc && pc.connectionState === 'disconnected') { resetPeer(); status('连接中断'); notify('网络连接中断，请新建房间重新连接。', true); }
    }, 12000);
    if (pc.connectionState === 'failed') { resetPeer(); status('连接失败'); notify('连接失败，请检查网络后新建房间。', true); }
  };
  return pc;
}
async function offer() {
  resetPeer('正在重新连接。'); status('正在连接'); $('peer-status').textContent = '正在连接';
  const pc = ensurePeer(); configureChannel(pc.createDataChannel('quickdrop', { ordered: true }), pc);
  await pc.setLocalDescription(await pc.createOffer());
  if (state.pc === pc) signal({ type: 'offer', sdp: pc.localDescription });
}
async function handleSignal(data) {
  const pc = ensurePeer();
  if (data.type === 'offer') {
    status('正在连接'); await pc.setRemoteDescription(data.sdp);
    for (const candidate of state.candidates.splice(0)) await pc.addIceCandidate(candidate);
    await pc.setLocalDescription(await pc.createAnswer());
    if (state.pc === pc) signal({ type: 'answer', sdp: pc.localDescription });
  } else if (data.type === 'answer') {
    await pc.setRemoteDescription(data.sdp);
    for (const candidate of state.candidates.splice(0)) await pc.addIceCandidate(candidate);
  } else if (data.type === 'candidate') {
    if (pc.remoteDescription) await pc.addIceCandidate(data.candidate); else state.candidates.push(data.candidate);
  }
}
async function showSAS(pc) {
  // Bind the short code to the negotiated DTLS certificate fingerprints, not a server-selected value.
  const fingerprints = [pc.localDescription.sdp, pc.remoteDescription.sdp].map(sdp => {
    const matches = [...sdp.matchAll(/^a=fingerprint:sha-256 (.+)$/gmi)].map(match => match[1].trim().toUpperCase());
    if (!matches.length) throw new Error('无法核对设备身份，请重新连接。');
    return [...new Set(matches)].sort().join('|');
  }).sort();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprints.join('|'))));
  if (state.pc !== pc) return;
  const code = (new DataView(bytes.buffer).getUint32(0) % 1000000).toString().padStart(6, '0');
  $('sas').textContent = `${code.slice(0, 3)} ${code.slice(3)}`; state.sasReady = true;
  status('请核对配对码'); $('peer-status').textContent = '等待确认'; setReady();
  const stats = await pc.getStats();
  let pair;
  stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId); });
  if (!pair) stats.forEach(report => { if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') pair = report; });
  const relay = pair && [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)].some(candidate => candidate?.candidateType === 'relay');
  $('network-path').textContent = relay ? '正在通过中继加密传输' : '设备之间加密直连';
}
function configureChannel(dc, pc) {
  if (state.pc !== pc) return;
  state.dc = dc; dc.binaryType = 'arraybuffer'; dc.bufferedAmountLowThreshold = 262144;
  dc.onopen = () => { showSAS(pc).catch(err => { notify(err.message, true); resetPeer(); }); };
  dc.onclose = () => { if (state.dc === dc) { resetPeer(); status('连接中断'); notify('对方已断开连接。双方保持页面打开，并重新配对。', true); } };
  dc.onerror = () => { if (state.dc === dc) notify('传输通道发生错误，请重试。'); };
  dc.onmessage = event => {
    state.messageQueue = state.messageQueue.then(async () => {
      if (state.dc !== dc) return;
      if (typeof event.data === 'string') {
        if (event.data.length > 65536) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message && typeof message === 'object') await control(message);
      } else await binary(event.data);
    }).catch(err => { notify(err.message || '接收失败，请重试。'); finishReceive('接收失败，请重新发送。'); });
  };
}
function touchReceive(receiver) {
  clearTimeout(receiver.timer);
  receiver.timer = setTimeout(() => {
    if (state.receiving !== receiver) return;
    try { sendControl({ type: 'file-error', id: receiver.id }); } catch {}
    finishReceive('接收超时，请重新发送。');
  }, 90000);
}
async function control(message) {
  if (message.type === 'verify') { state.peerVerified = true; setReady(); return; }
  if (!state.connected) return;
  const current = state.outgoing;
  if (message.type === 'file-accept' && current?.id === message.id) current.accept.resolve();
  else if (message.type === 'file-reject' && current?.id === message.id) current.abort.abort(new Error('对方拒绝了文件。'));
  else if (message.type === 'file-ok' && current?.id === message.id) current.done.resolve();
  else if (message.type === 'file-error' && current?.id === message.id) current.abort.abort(new Error('对方接收失败，请重新发送。'));
  else if (message.type === 'file-cancel' && state.receiving?.id === message.id) finishReceive('发送方取消了传输。');
  else if (message.type === 'text') {
    if (typeof message.text !== 'string' || new TextEncoder().encode(message.text).length > 32768) return;
    const entry = item('收到一段文字', message.text);
    entry.actions.append(button('复制文字', () => copy(message.text)));
  } else if (message.type === 'file-meta') {
    if (typeof message.id !== 'string' || message.id.length > 80 || typeof message.name !== 'string' || message.name.length > 512 ||
      !Number.isSafeInteger(message.size) || message.size < 0 || message.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(message.hash || '')) return;
    // Cap retained downloads so repeated accepted transfers cannot grow browser memory without bound.
    if (state.receiving || state.receivedBytes + message.size > 300 * 1024 * 1024) {
      sendControl({ type: 'file-reject', id: message.id }); notify('请先完成当前接收；本页最多暂存 300 MiB，保存文件后可刷新重新配对。'); return;
    }
    const entry = item(message.name || '未命名文件', `${formatSize(message.size)} · 来自另一台设备`);
    const receiver = { ...message, item: entry, chunks: [], bytes: 0, accepted: false };
    state.receiving = receiver; setItemResult(entry, '是否接收这个文件？请仅接收你信任的内容。');
    const accept = button('接收文件', () => {
      if (state.receiving !== receiver) return;
      receiver.accepted = true; accept.disabled = reject.disabled = true;
      progress(entry); setItemResult(entry, '正在接收…'); sendControl({ type: 'file-accept', id: receiver.id }); touchReceive(receiver);
    }, 'primary');
    const reject = button('拒绝', () => {
      if (state.receiving !== receiver) return;
      sendControl({ type: 'file-reject', id: receiver.id }); finishReceive('已拒绝接收。', '');
    });
    receiver.actions = [accept, reject]; entry.actions.append(accept, reject); touchReceive(receiver);
  } else if (message.type === 'file-done' && state.receiving?.id === message.id) {
    const receiver = state.receiving;
    if (!receiver.accepted || receiver.bytes !== receiver.size) {
      sendControl({ type: 'file-error', id: receiver.id }); finishReceive('文件长度不一致，请重新发送。'); return;
    }
    clearTimeout(receiver.timer); setItemResult(receiver.item, '正在校验文件…');
    const blob = new Blob(receiver.chunks, { type: 'application/octet-stream' }); receiver.chunks = [];
    const hash = await sha256(await blob.arrayBuffer());
    if (state.receiving !== receiver) return;
    if (hash !== receiver.hash) {
      sendControl({ type: 'file-error', id: receiver.id }); finishReceive('文件校验失败，请重新发送。'); return;
    }
    const url = URL.createObjectURL(blob); state.urls.add(url); state.receivedBytes += receiver.size;
    const link = document.createElement('a'); link.href = url; link.download = receiver.name.replace(/[\/\\\x00-\x1f]/g, '_') || 'download';
    link.textContent = '下载保存 ↓'; link.className = 'download'; receiver.item.actions.replaceChildren(link);
    progress(receiver.item).value = 1; setItemResult(receiver.item, '已接收 · SHA-256 校验通过，请点击下载保存。', 'success');
    sendControl({ type: 'file-ok', id: receiver.id }); state.receiving = null;
  }
}
async function binary(data) {
  const receiver = state.receiving;
  if (!receiver?.accepted || !(data instanceof ArrayBuffer)) return;
  if (data.byteLength > CHUNK || receiver.bytes + data.byteLength > receiver.size) {
    sendControl({ type: 'file-error', id: receiver.id }); finishReceive('收到异常文件数据，已停止接收。'); return;
  }
  receiver.chunks.push(data); receiver.bytes += data.byteLength;
  progress(receiver.item).value = receiver.size ? receiver.bytes / receiver.size : 1;
  setItemResult(receiver.item, `${formatSize(receiver.bytes)} / ${formatSize(receiver.size)}`); touchReceive(receiver);
}
async function sha256(data) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join(''); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function waitFor(promise, signal, timeout, message) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason || new Error('已取消。')); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error(message)); }, timeout);
    promise.then(value => { cleanup(); resolve(value); }, err => { cleanup(); reject(err); });
  });
}
function waitBuffer(dc, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (dc.readyState !== 'open') return Promise.reject(new Error('连接已断开。'));
  if (dc.bufferedAmount < 1048576) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); dc.removeEventListener('bufferedamountlow', low); dc.removeEventListener('close', closed); signal.removeEventListener('abort', aborted); };
    const low = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new Error('连接已断开。')); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('网络发送超时。')); }, 60000);
    dc.addEventListener('bufferedamountlow', low, { once: true }); dc.addEventListener('close', closed, { once: true }); signal.addEventListener('abort', aborted, { once: true });
    if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) low();
  });
}
async function sendOne(file) {
  const entry = item(file.name, formatSize(file.size), 'outgoing');
  if (file.size > MAX_FILE) { setItemResult(entry, '超过单文件 100 MiB 上限。', 'error'); return; }
  const transfer = { id: crypto.randomUUID(), abort: new AbortController(), accept: deferred(), done: deferred() };
  state.outgoing = transfer;
  const dc = state.dc, generation = state.generation;
  const cancel = button('取消', () => transfer.abort.abort(new Error('已取消发送。'))); entry.actions.append(cancel);
  try {
    setItemResult(entry, '正在计算文件校验值…');
    const hash = await waitFor(file.arrayBuffer().then(sha256), transfer.abort.signal, 90000, '文件读取超时。');
    if (generation !== state.generation) throw new Error('连接已改变，请重新发送。');
    sendControl({ type: 'file-meta', id: transfer.id, name: file.name, size: file.size, hash });
    setItemResult(entry, '等待对方接收…');
    await waitFor(transfer.accept.promise, transfer.abort.signal, 90000, '对方未确认接收，请重试。');
    const started = performance.now();
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      await waitBuffer(dc, transfer.abort.signal);
      const chunk = await file.slice(offset, offset + CHUNK).arrayBuffer();
      if (transfer.abort.signal.aborted) throw transfer.abort.signal.reason;
      if (state.dc !== dc || dc.readyState !== 'open') throw new Error('连接已断开。');
      dc.send(chunk); progress(entry).value = Math.min(1, (offset + chunk.byteLength) / file.size);
      setItemResult(entry, `${formatSize(Math.min(file.size, offset + chunk.byteLength))} / ${formatSize(file.size)} · 发送中`);
    }
    sendControl({ type: 'file-done', id: transfer.id }); setItemResult(entry, '数据已发送，等待对方校验…');
    await waitFor(transfer.done.promise, transfer.abort.signal, 180000, '等待对方完成超时，请重试。');
    progress(entry).value = 1;
    setItemResult(entry, `对方已接收并通过校验 · ${((performance.now() - started) / 1000).toFixed(1)} 秒 · 等待对方自行下载保存`, 'success');
  } catch (err) {
    setItemResult(entry, err.message || '发送失败。', 'error');
    if (state.dc === dc && dc?.readyState === 'open') { try { sendControl({ type: 'file-cancel', id: transfer.id }); } catch {} }
  } finally { cancel.remove(); if (state.outgoing === transfer) state.outgoing = null; }
}
async function sendFiles(files) {
  if (!state.connected || state.sending) return;
  if (files.length > 50) { notify('一次最多选择 50 个文件。'); return; }
  state.sending = true; setReady();
  try { for (const file of files) { if (!state.connected) break; await sendOne(file); } }
  finally { state.sending = false; $('files').value = ''; setReady(); }
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); notify('已复制。'); }
  catch { notify('浏览器未允许自动复制，请长按或选中后手动复制。'); $('pair-link').select(); }
}
function connect() {
  clearTimeout(state.reconnect); status('连接中');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/quickdrop/ws`);
  state.ws = ws;
  ws.onopen = () => { state.retries = 0; ws.send(JSON.stringify(state.room ? { type: 'join', room: state.room } : { type: 'create' })); };
  ws.onmessage = event => {
    if (state.ws !== ws) return;
    let message; try { message = JSON.parse(event.data); } catch { return; }
    state.signalQueue = state.signalQueue.then(async () => {
      if (state.ws !== ws) return;
      if (message.type === 'joined') {
        state.room = message.room; state.ice = message.iceServers;
        const url = new URL(location.href); url.searchParams.set('room', state.room); history.replaceState(null, '', url);
        // Deliberately omit diagnostics options from shared pairing links.
        const link = `${location.origin}/quickdrop/?room=${state.room}`;
        $('pair-link').value = link; $('copy-link').disabled = false;
        $('qr').src = `/quickdrop/qr?room=${state.room}`; $('qr').hidden = false; $('qr-loading').hidden = true;
        $('room-expiry').textContent = `房间有效至 ${new Date(message.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        status('等待加入'); $('notice').hidden = true;
      } else if (message.type === 'peer-joined') await offer();
      else if (message.type === 'signal') await handleSignal(message.data);
      else if (message.type === 'peer-left') { resetPeer('对方已离开，传输已中止。'); status('等待加入'); }
      else if (message.type === 'error') { notify(message.message, true); status('无法加入'); }
    }).catch(err => { notify(err.message || '连接异常，请新建房间重试。', true); resetPeer(); status('连接异常'); });
  };
  ws.onclose = event => {
    if (state.ws !== ws) return;
    resetPeer('信令连接中断，当前传输已停止。'); status('连接中断');
    if (event.code === 1000) { notify('房间已过期，请点击“新建房间”。', true); return; }
    const delay = Math.min(30000, 1000 * 2 ** state.retries++);
    notify('连接中断，正在尝试重新连接…', true); state.reconnect = setTimeout(connect, delay);
  };
  ws.onerror = () => { if (state.ws === ws) notify('无法连接服务，正在重试…', true); };
}
$('verify').addEventListener('click', () => {
  if (!state.sasReady || state.dc?.readyState !== 'open') return;
  state.verified = true; sendControl({ type: 'verify' });
  $('verify').disabled = true; $('verify').textContent = '已确认，等待另一台设备确认…'; setReady();
});
$('new-room').addEventListener('click', () => {
  if ((state.sending || state.receiving) && !confirm('新建房间会中止当前传输，确定继续？')) return;
  resetPeer('已新建房间，当前传输已中止。');
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'create' }));
  else { if (state.ws) { state.ws.onclose = null; state.ws.close(); } state.room = null; connect(); }
});
$('copy-link').addEventListener('click', () => copy($('pair-link').value));
$('files').addEventListener('change', event => sendFiles([...event.target.files]));
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); if (state.connected && !state.sending) $('dropzone').classList.add('drag'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('drag'); });
$('dropzone').addEventListener('drop', event => sendFiles([...event.dataTransfer.files]));
window.addEventListener('dragover', event => event.preventDefault()); window.addEventListener('drop', event => event.preventDefault());
$('text').addEventListener('input', () => { $('text-count').textContent = `${(new TextEncoder().encode($('text').value).length / 1024).toFixed(1)} / 32 KiB`; });
$('send-text').addEventListener('click', () => {
  const text = $('text').value;
  if (!text.trim() || !state.connected) return;
  if (new TextEncoder().encode(text).length > 32768) return notify('文字超过 32 KiB，请缩短后发送。');
  sendControl({ type: 'text', text }); $('text').value = ''; $('text-count').textContent = '0 / 32 KiB'; notify('文字已发送。');
});
window.addEventListener('beforeunload', event => { if (state.sending || state.receiving) { event.preventDefault(); event.returnValue = ''; } });
if (!window.RTCPeerConnection || !window.crypto?.subtle || !window.isSecureContext) {
  status('浏览器不支持'); notify('请使用最新版 Safari、Chrome 或 Edge，并通过 HTTPS 打开本页。', true); $('new-room').disabled = true;
} else connect();
