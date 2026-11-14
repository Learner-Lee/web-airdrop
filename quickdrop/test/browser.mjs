import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import('playwright').catch(() => import('/tmp/quickdrop-test-tools/node_modules/playwright/index.mjs'));

const origin = process.argv[2] || 'http://localhost:3031';
const relay = process.argv.includes('--relay');
const prefix = relay ? 'relay' : origin.startsWith('https') ? 'production' : 'local';
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const report = [], errors = [];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const contexts = [], pages = [];
async function page(viewport = { width: 1365, height: 1100 }) {
  const context = await browser.newContext({ acceptDownloads: true, viewport }); contexts.push(context);
  await context.addInitScript(() => {
    window.__rtcLog = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener('icecandidate', event => window.__rtcLog.push({ event: 'candidate', type: event.candidate?.type, protocol: event.candidate?.protocol }));
        this.addEventListener('connectionstatechange', () => window.__rtcLog.push({ event: 'connection', state: this.connectionState }));
        this.addEventListener('iceconnectionstatechange', () => window.__rtcLog.push({ event: 'ice', state: this.iceConnectionState }));
      }
    };
  });
  const tab = await context.newPage(); pages.push(tab);
  tab.on('pageerror', error => errors.push(error.message)); return tab;
}
async function run(name, fn) { const time = Date.now(); await fn(); report.push({ name, ok: true, milliseconds: Date.now() - time }); console.log('PASS', name); }
const a = await page(), b = await page();
const aUrl = `${origin}/quickdrop/${relay ? '?relay=1' : ''}`;
let pairUrl;
async function pair() {
  await a.goto(aUrl);
  await a.locator('#pair-link').filter({ visible: true }).waitFor();
  await a.waitForFunction(() => document.getElementById('pair-link').value.includes('room='));
  pairUrl = await a.locator('#pair-link').inputValue();
  if (relay) pairUrl += '&relay=1';
  await b.goto(pairUrl);
  await Promise.all([a.locator('#sas').waitFor({ state: 'visible', timeout: 60000 }), b.locator('#sas').waitFor({ state: 'visible', timeout: 60000 })]);
  assert.equal(await a.locator('#sas').innerText(), await b.locator('#sas').innerText());
  assert.equal(await a.locator('#files').isDisabled(), true);
  await a.locator('#verify').click(); await b.locator('#verify').click();
  await Promise.all([a.locator('#connected-info').waitFor(), b.locator('#connected-info').waitFor()]);
}
const sha = data => createHash('sha256').update(data).digest('hex');
function sample(size) { const data = Buffer.alloc(size); for (let i = 0; i < size; i++) data[i] = i % 251; return data; }
async function transfer(from, to, name, data) {
  if (data.length >= 50000000) {
    const fixture = `/tmp/quickdrop-${name}`;
    await writeFile(fixture, data); await from.locator('#files').setInputFiles(fixture);
  } else await from.locator('#files').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: data });
  const entry = to.locator('#inbox .item').filter({ has: to.locator('strong', { hasText: name }) }).first();
  await entry.getByRole('button', { name: '接收文件' }).click({ timeout: 30000 });
  const link = entry.getByRole('link', { name: '下载保存 ↓' });
  await link.waitFor({ timeout: 180000 });
  const downloadPromise = to.waitForEvent('download'); await link.click();
  const download = await downloadPromise;
  const output = await readFile(await download.path());
  assert.equal(sha(output), sha(data)); assert.equal(output.length, data.length);
  await from.waitForFunction(() => !document.getElementById('files').disabled, { timeout: 30000 });
}
try {
  await run('Pairing and matching DTLS authentication codes', pair);
  await run('Selected connection route', async () => {
    const path = await a.locator('#network-path').innerText();
    if (relay) assert.match(path, /中继/); report.push({ route: path });
  });
  await run('Unicode text and URL in both directions', async () => {
    await a.locator('#text').fill('微信 QQ 中文测试 😀 https://example.com/?a=1&b=2'); await a.locator('#send-text').click();
    await b.getByText('微信 QQ 中文测试 😀 https://example.com/?a=1&b=2', { exact: true }).waitFor();
    await b.locator('#text').fill('<script>alert("hello")</script>'); await b.locator('#send-text').click();
    await a.getByText('<script>alert("hello")</script>', { exact: true }).waitFor();
  });
  await run('1 MiB binary transfer with downloaded hash verification', () => transfer(a, b, '微信-文件-1MiB.bin', sample(1048576)));
  await run('Reverse direction empty file', () => transfer(b, a, 'QQ-空文件.txt', Buffer.alloc(0)));
  await run('Explicit file rejection', async () => {
    await a.locator('#files').setInputFiles({ name: '拒收.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('reject') });
    await b.getByRole('button', { name: '拒绝', exact: true }).click();
    await a.getByText('对方拒绝了文件。', { exact: true }).waitFor();
    await a.waitForFunction(() => !document.getElementById('files').disabled);
  });
  if (!relay) {
    await run('Corrupted payload fails SHA-256 verification', async () => {
      await a.evaluate(() => {
        window.__originalSend = RTCDataChannel.prototype.send;
        window.__corruptNext = true;
        RTCDataChannel.prototype.send = function(data) {
          if (window.__corruptNext && data instanceof ArrayBuffer && data.byteLength) {
            window.__corruptNext = false; const altered = data.slice(0); new Uint8Array(altered)[0] ^= 1;
            return window.__originalSend.call(this, altered);
          }
          return window.__originalSend.call(this, data);
        };
      });
      await a.locator('#files').setInputFiles({ name: 'corruption.bin', mimeType: 'application/octet-stream', buffer: sample(1024) });
      await b.locator('#inbox .item').filter({ has: b.locator('strong', { hasText: 'corruption.bin' }) }).getByRole('button', { name: '接收文件' }).click();
      await b.getByText('文件校验失败，请重新发送。', { exact: true }).waitFor();
      await a.getByText('对方接收失败，请重新发送。', { exact: true }).waitFor();
      await a.evaluate(() => { RTCDataChannel.prototype.send = window.__originalSend; });
      await a.waitForFunction(() => !document.getElementById('files').disabled);
    });
    await run('Sequential multi-file queue', async () => {
      await a.locator('#files').setInputFiles([
        { name: 'batch-1.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
        { name: 'batch-2.txt', mimeType: 'text/plain', buffer: Buffer.from('two') }
      ]);
      for (const name of ['batch-1.txt', 'batch-2.txt']) {
        const entry = b.locator('#inbox .item').filter({ has: b.locator('strong', { hasText: name }) });
        await entry.getByRole('button', { name: '接收文件' }).click(); await entry.getByRole('link', { name: '下载保存 ↓' }).waitFor();
      }
      await a.waitForFunction(() => !document.getElementById('files').disabled);
    });
    await run('50 MiB binary transfer and downloaded hash verification', () => transfer(a, b, '视频样本-50MiB.bin', sample(50 * 1048576)));
    await run('Oversize file refused before sending', async () => {
      await a.evaluate(() => {
        const chunk = new Uint8Array(1048576); const file = new File(Array(101).fill(chunk), 'too-large.bin');
        const dt = new DataTransfer(); dt.items.add(file); const input = document.getElementById('files'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await a.getByText('超过单文件 100 MiB 上限。', { exact: true }).waitFor();
    });
    await run('Third device rejected and invalid room explained', async () => {
      const third = await page(); await third.goto(pairUrl); await third.getByText('房间已满，最多连接两台设备。', { exact: true }).waitFor();
      await third.goto(`${origin}/quickdrop/?room=${'x'.repeat(24)}`);
      await third.getByText('房间不存在或已过期，请让对方新建房间。', { exact: true }).waitFor();
      await third.close();
    });
    await run('Mobile layout fits 390px viewport', async () => {
      await b.setViewportSize({ width: 390, height: 844 });
      await b.screenshot({ path: new URL(`../test-results/${prefix}-mobile.png`, import.meta.url).pathname, fullPage: true });
      assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await b.setViewportSize({ width: 1365, height: 1100 });
    });
  }
  await a.screenshot({ path: new URL(`../test-results/${prefix}-desktop.png`, import.meta.url).pathname, fullPage: true });
  await run('Disconnect aborts pending file and room can be reused', async () => {
    await a.locator('#files').setInputFiles({ name: '断线.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('disconnect') });
    await b.locator('#inbox .item').filter({ has: b.locator('strong', { hasText: '断线.bin' }) }).getByRole('button', { name: '接收文件' }).waitFor();
    await b.close({ runBeforeUnload: false });
    await a.locator('#connected-info').waitFor({ state: 'hidden', timeout: 15000 });
    await a.getByText('对方已离开，传输已中止。', { exact: true }).waitFor();
    const replacement = await page(); await replacement.goto(pairUrl);
    await replacement.locator('#sas').waitFor({ timeout: 60000 });
    assert.equal(await a.locator('#sas').innerText(), await replacement.locator('#sas').innerText());
  });
  assert.deepEqual(errors, []);
} catch (error) {
  report.push({ ok: false, error: error.stack });
  for (let i = 0; i < pages.length; i++) if (!pages[i].isClosed()) {
    console.log('PAGE', i, await pages[i].locator('body').innerText());
    console.log('RTC', i, await pages[i].evaluate(() => window.__rtcLog));
    await pages[i].screenshot({ path: new URL(`../test-results/${prefix}-failure-${i}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await writeFile(new URL(`../test-results/${prefix}-report.json`, import.meta.url), JSON.stringify({ origin, relay, report, errors }, null, 2));
  await browser.close();
}
