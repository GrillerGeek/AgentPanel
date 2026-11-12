import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { Ghostty } from '../../vendor/ghostty-history/dist/ghostty-history.js';
import { serializeGhosttyHistory, normalizedHistorySnapshot, firstHistoryDifference, HISTORY_BYTE_LIMIT } from '../../src/lib/terminalRenderer/ghosttyHistory.ts';
import { StyledHistoryRestorer, parseHistoryArchive, historyHeader } from '../../src/lib/terminalRenderer/historyArchive.ts';
import { readGhosttyText, copyGhosttySelection, findGhosttyText } from '../../src/lib/terminalRenderer/ghosttyText.ts';
import { styledHistoryFixture } from '../../src/spikes/ghostty/historyWrapFixture.ts';
const module = await WebAssembly.compile(readFileSync(new URL('../../vendor/ghostty-history/dist/ghostty-history.wasm', import.meta.url)));
async function core() { const instance = await WebAssembly.instantiate(module, { env: { log() {} } }); return { instance, ghostty: new Ghostty(instance) }; }
const config = { scrollbackLimit: 8 * 1024 * 1024, fgColor: 0x112233, bgColor: 0x010203 };
function text(term) { const result = readGhosttyText(term); assert.equal(result.status, 'supported', result.reason); return result.value; }
function restorer(term) {
  return new StyledHistoryRestorer({ grid: () => ({ cols: term.cols, rows: term.rows }), resize: (cols, rows) => term.resize(cols, rows),
    fit() {}, canFit: () => false, idle: async () => {}, write: async (body) => { term.write(body); }, reset: () => term.write('\x1bc') });
}
async function restore(term, archive) { const result = await restorer(term).restore(archive); assert.equal(result.status, 'supported', result.reason); }
async function roundtrip(input, cols = 32, rows = 5) {
  const { ghostty } = await core(); const source = ghostty.createTerminal(cols, rows, config); source.write(input);
  const before = source.captureSnapshot(); const result = serializeGhosttyHistory(before); assert.equal(result.status, 'supported', result.reason);
  const replay = ghostty.createTerminal(cols, rows, config); await restore(replay, result.value); const after = replay.captureSnapshot();
  assert.deepEqual(normalizedHistorySnapshot(after), normalizedHistorySnapshot(before));
  assert.equal(text(replay).text, text(source).text, 'logical text/copy changed after replay');
  assert.ok(Buffer.byteLength(result.value) <= HISTORY_BYTE_LIMIT); assert.equal(replay.isAlternateScreen(), false);
  assert.ok(result.value.endsWith('\x1b]8;;\x1b\\\x1b[0m')); assert.doesNotMatch(result.value, /\x1b\](?:0|2|52);|\x1b\[[56]n/);
  source.free(); replay.free(); return { before, result };
}
test('semantic default/palette/RGB color provenance survives even for identical RGB', async () => {
  const { before } = await roundtrip('\x1b]10;rgb:11/22/33\x1b\\\x1b]4;1;rgb:11/22/33\x1b\\\x1b[39mD\x1b[38;5;1mP\x1b[38;2;17;34;51mR\x1b[0m');
  assert.equal(before.colors.foreground, 0x112233); assert.equal(before.colors.palette[1], 0x112233);
  assert.deepEqual(before.rows[0][2].slice(0, 3).map(cell => cell.slice(3, 5)), [[0, 0], [1, 1], [2, 0x112233]]);
});
test('palette/default color SET and RESET operate in the native stream', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(16, 4, config); const original = t.captureSnapshot().colors;
  t.write('\x1b]4;1;rgb:aa/bb/cc\x1b\\\x1b]10;rgb:44/55/66\x1b\\\x1b]11;rgb:77/88/99\x1b\\');
  const changed = t.captureSnapshot().colors; assert.equal(changed.palette[1], 0xaabbcc); assert.equal(changed.foreground, 0x445566); assert.equal(changed.background, 0x778899);
  t.write('\x1b]104;1\x1b\\\x1b]110\x1b\\\x1b]111\x1b\\'); assert.deepEqual(t.captureSnapshot().colors, original); t.free();
});
test('rendition, all underline variants/colors, inverse and overline survive semantically', async () => {
  await roundtrip('\x1b[1;2;3;5;7;8;9;53;38;5;3;48;2;5;6;7;58;5;8mA\x1b[0m' + Array.from({ length: 5 }, (_, i) => `\x1b[4:${i + 1};58;2;4;5;6m${i}\x1b[0m`).join(''));
});
test('background-only blanks and real styled spaces preserve hasText and logical text', async () => {
  await roundtrip('A \x1b[41m\x1b[3X\x1b[0m\r\n\x1b[44m\x1b[2K\x1b[0m\r\n\x1b[4;53m real spaces  \x1b[0m', 24, 4);
});
test('per-cell hyperlinks and explicit IDs survive transitions and close neutrally', async () => {
  await roundtrip('\x1b]8;id=first;https://example.test/one\x1b\\one\x1b]8;;\x1b\\ plain \x1b]8;;https://example.test/two\x1b\\two\x1b]8;;\x1b\\');
});
test('CJK, combining and skin-tone ZWJ clusters survive styled history', async () => { await roundtrip('中文 é 👩🏽‍💻\x1b[31m café\x1b[0m', 16, 4); });
test('wide edge spacer, soft wraps, scrollback/active boundary and hard breaks stay distinct', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(8, 2, config); t.write('1234567中xyz\r\nHARD');
  const mapped = text(t); assert.ok(mapped.text.includes('1234567中xyz\nHARD')); assert.ok(!mapped.text.includes('1234567 中'));
  const match = findGhosttyText(mapped, '7中x', -1, false); assert.deepEqual(match.match.start, { x: 6, y: 0 }); assert.deepEqual(match.match.end, { x: 3, y: 1 });
  assert.deepEqual(copyGhosttySelection(mapped, match.match), { status: 'supported', value: '7中x' });
  assert.ok(t.getRowMetadata().rows[0][2].includes('3')); t.free(); await roundtrip('1234567中xyz\r\nHARD', 8, 2);
});
test('logical search/copy survives core resize and preserves explicit trailing spaces', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(8, 3, config); t.write('crosswrapped-needle  \r\nHARD');
  t.resize(6, 3); const mapped = text(t); const found = findGhosttyText(mapped, 'wrapped-needle  ', -1, false);
  assert.ok(found.match); assert.equal(copyGhosttySelection(mapped, found.match).value, 'wrapped-needle  '); t.free();
});
test('primary capture during alternate screen is read-only for both screens/cursors', async () => {
  const { ghostty } = await core(); const source = ghostty.createTerminal(10, 4, config); source.write('\x1b[31;53mPRIMARY-中👩🏽‍💻-wrap-record\x1b[0m\r\nnext'); const primary = source.captureSnapshot();
  source.write('\x1b[?1049h\x1b[2J\x1b[HALT NOISE\x1b[3;4H');
  const beforePrimary = source.captureSnapshot(); const beforeActive = source.captureSnapshot({ screen: 'active' }); assert.equal(beforeActive.screen, 1);
  const result = serializeGhosttyHistory(beforePrimary); assert.equal(result.status, 'supported', result.reason);
  assert.deepEqual(source.captureSnapshot(), beforePrimary); assert.deepEqual(source.captureSnapshot({ screen: 'active' }), beforeActive);
  const replay = ghostty.createTerminal(10, 4, config); await restore(replay, result.value); assert.deepEqual(normalizedHistorySnapshot(replay.captureSnapshot()), normalizedHistorySnapshot(primary));
  source.write('\x1b[?1049l'); assert.deepEqual(normalizedHistorySnapshot(source.captureSnapshot()), normalizedHistorySnapshot(primary)); source.free(); replay.free();
});
test('retention chooses a suffix of complete records within256KiB and regenerates colors', async () => {
  const { ghostty } = await core(); const source = ghostty.createTerminal(80, 3, config);
  const line = i => Array.from({ length: 80 }, (_, x) => `\x1b[38;2;${(i + x) % 255};2;3m${String(i % 10)}`).join('') + '\x1b[0m\r\n';
  source.write(Array.from({ length: 220 }, (_, i) => line(i)).join('')); const snapshot = source.captureSnapshot(); const result = serializeGhosttyHistory(snapshot);
  assert.equal(result.status, 'supported', result.reason); assert.ok(result.diagnostics.droppedRecords > 0); assert.ok(Buffer.byteLength(result.value) <= HISTORY_BYTE_LIMIT);
  const replay = ghostty.createTerminal(80, 3, config); await restore(replay, result.value);
  const expected = { ...snapshot, rows: snapshot.rows.slice(result.diagnostics.droppedRecords) }; assert.deepEqual(normalizedHistorySnapshot(replay.captureSnapshot()), normalizedHistorySnapshot(expected)); source.free(); replay.free();
});
test('oversized newest meaningful record fails instead of archiving only trailing viewport blanks', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(80, 4, config); t.write('x'.repeat(10000) + '\r\n'); const result = serializeGhosttyHistory(t.captureSnapshot(), 6000);
  assert.equal(result.status, 'oversized'); assert.equal(result.diagnostics.retainedRecords, 0); t.free();
});
test('incomplete native leading record is skipped or fails explicitly when no complete record remains', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(8, 3, config); t.write('abcdefghijklmnop\r\nCOMPLETE'); const snapshot = t.captureSnapshot();
  snapshot.rows[0][1] = 1; const archived = serializeGhosttyHistory(snapshot); assert.equal(archived.status, 'supported'); assert.ok(archived.diagnostics.incompletePrefixRows > 0);
  const only = { ...snapshot, rows: snapshot.rows.slice(0, 2).map(row => [row[0], 1, row[2]]) }; assert.equal(serializeGhosttyHistory(only).status, 'incomplete'); t.free();
});
test('mutated erased-wrap blank at last column refuses a corrupt replay', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(8, 3, config); t.write('abcdefghijkl'); const snapshot = t.captureSnapshot(); snapshot.rows[0][2][7] = ['', 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, null, null];
  const result = serializeGhosttyHistory(snapshot); assert.equal(result.status, 'error'); assert.match(result.reason, /Unwritten cell/); t.free();
});
test('bounded metadata rejects output/row/cell/string limits and invalid ABI/arguments', async () => {
  const { ghostty, instance } = await core(); const t = ghostty.createTerminal(12, 4, config); t.write('👩🏽‍💻 styled'); const original = t.captureSnapshot();
  for (const options of [{ maxBytes: 8 }, { maxRows: 1 }, { maxCells: 1 }, { maxStringBytes: 1 }]) assert.throws(() => t.captureSnapshot(options), /limit/);
  for (const options of [{ maxBytes: -1 }, { maxBytes: Infinity }, { maxRows: 8193 }, { screen: 'bogus' }]) assert.throws(() => t.captureSnapshot(options), /Invalid/);
  assert.deepEqual(t.captureSnapshot(), original); assert.throws(() => new Ghostty({ exports: { memory: instance.exports.memory } }), /ABI/);
  assert.throws(() => new Ghostty({ exports: { ...instance.exports, ghostty_metadata_version: () => 99 } }), /ABI/);
  assert.equal(instance.exports.ghostty_metadata_capture(0, 0, 0, 0, 16, 1, 1, 1), -1); t.free();
});
test('capture, grapheme views and same-module terminal lifetimes survive growth/reuse', async () => {
  const { ghostty, instance } = await core(); const t = ghostty.createTerminal(16, 3, config); t.write('👩🏽‍💻 é'); t.getLine(0); const original = t.captureSnapshot(); instance.exports.memory.grow(2);
  for (let i = 0; i < 20; i++) { assert.deepEqual(t.captureSnapshot(), original); assert.equal(t.getGraphemeString(0, 0), '👩🏽‍💻'); }
  t.free(); let plateau = 0;
  for (let i = 0; i < 40; i++) { const next = ghostty.createTerminal(8, 3, config); assert.ok(next.captureSnapshot().rows.every(row => row[2].every(cell => cell[0] === '' && cell[11] === null && cell[9] === 0)));
    next.write(i % 2 ? '\x1b]8;id=a;https://example.test\x1b\\test\x1b]8;;\x1b\\' : '\x1b[41mhello'); next.captureSnapshot(); next.getLine(0); next.getGraphemeString(0, 0); next.resize(12, 4); next.free();
    if (i === 5) plateau = instance.exports.memory.buffer.byteLength; if (i > 5) assert.equal(instance.exports.memory.buffer.byteLength, plateau);
  }
});
test('oversized full graphemes return explicit failure rather than partial metadata/glyphs', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(8, 3, config); t.write('e' + '\u0301'.repeat(1024));
  assert.throws(() => t.captureSnapshot(), /grapheme limit|string/); t.getLine(0); assert.throws(() => t.getGraphemeString(0, 0), /grapheme limit/); t.free();
});
test('actual native prefix eviction skips only the incomplete leading logical record', async () => {
  const { ghostty } = await core(); const source = ghostty.createTerminal(40, 3, { ...config, scrollbackLimit: 1 });
  source.write('x'.repeat(100000) + '\r\nCOMPLETE-LAST'); const snapshot = source.captureSnapshot(); assert.equal(snapshot.rows[0][1], 1, 'fixture did not evict a wrapped prefix');
  const result = serializeGhosttyHistory(snapshot); assert.equal(result.status, 'supported', result.reason); assert.ok(result.diagnostics.incompletePrefixRows > 0);
  const replay = ghostty.createTerminal(40, 3, config); await restore(replay, result.value);
  const expected = { ...snapshot, rows: snapshot.rows.slice(result.diagnostics.incompletePrefixRows) };
  assert.deepEqual(normalizedHistorySnapshot(replay.captureSnapshot()), normalizedHistorySnapshot(expected));
  source.free(); replay.free();
  const only = ghostty.createTerminal(40, 3, { ...config, scrollbackLimit: 1 }); only.write('x'.repeat(100000));
  const incomplete = serializeGhosttyHistory(only.captureSnapshot()); assert.equal(incomplete.status, 'incomplete'); only.free();
});
test('byte retention drops complete multi-row logical records rather than physical row fragments', async () => {
  const { ghostty } = await core(); const source = ghostty.createTerminal(16, 3, config);
  const record = i => Array.from({ length: 180 }, (_, j) => `\x1b[38;2;${(i + j) % 255};2;3m${String(i % 10)}`).join('') + '\x1b[0m\r\n';
  source.write(Array.from({ length: 110 }, (_, i) => record(i)).join('')); const snapshot = source.captureSnapshot();
  const result = serializeGhosttyHistory(snapshot); assert.equal(result.status, 'supported', result.reason); assert.ok(result.diagnostics.droppedRecords > 0);
  const boundaries = snapshot.rows.flatMap((row, y) => row[1] === 0 ? [y] : []); const start = boundaries[result.diagnostics.droppedRecords]; assert.equal(snapshot.rows[start][1], 0);
  const replay = ghostty.createTerminal(16, 3, config); await restore(replay, result.value);
  assert.deepEqual(normalizedHistorySnapshot(replay.captureSnapshot()), normalizedHistorySnapshot({ ...snapshot, rows: snapshot.rows.slice(start) })); source.free(); replay.free();
});

test('explicit restore-at-saved-grid then resize matches narrower/wider changed-height source reflow', async () => {
  for (const [cols, rows] of [[6, 3], [12, 6], [5, 2]]) for (const input of ['abc\x1b[41m\x1b[5X\x1b[0m\r\nEND', '1234567中👩🏽‍💻é-wrapped\r\n\x1b]8;id=x;https://example.test\x1b\\link\x1b]8;;\x1b\\']) {
    const { ghostty } = await core(); const source = ghostty.createTerminal(8, 4, config); source.write(input + '\x1b[1;1H');
    const captured = source.captureSnapshot(); const archive = serializeGhosttyHistory(captured); assert.equal(archive.status, 'supported', archive.reason);
    const parsed = parseHistoryArchive(archive.value); assert.equal(parsed.status, 'supported'); assert.deepEqual(parsed.value.grid, { cols: 8, rows: 4 });
    source.resize(cols, rows); const replay = ghostty.createTerminal(cols, rows, config); await restore(replay, archive.value);
    assert.deepEqual(normalizedHistorySnapshot(replay.captureSnapshot()), normalizedHistorySnapshot(source.captureSnapshot()));
    assert.equal(text(replay).text, text(source).text); assert.deepEqual(replay.getDimensions(), { cols, rows }); source.free(); replay.free();
  }
});

test('raw program output with a reserved marker never triggers saved-grid restoration', async () => {
  const { ghostty } = await core(); const t = ghostty.createTerminal(6, 3, config); t.write(historyHeader(8, 4) + 'raw');
  const snapshot = t.captureSnapshot(); assert.equal(snapshot.cols, 6); assert.equal(snapshot.height, 3); assert.ok(text(t).text.startsWith('raw')); t.free();
});

test('explicit restore replaces previously reflowed/alternate used core without stale semantic state', async () => {
  const { ghostty } = await core(); const existing = ghostty.createTerminal(24, 12, config); existing.write(styledHistoryFixture);
  const archive = serializeGhosttyHistory(existing.captureSnapshot()); assert.equal(archive.status, 'supported', archive.reason);
  existing.write('\x1b[?1049h\x1b[2J\x1b[HALT APPLICATION\x1b[3;4H\x1b[?1049l'); existing.resize(18, 10); await restore(existing, archive.value);
  const golden = ghostty.createTerminal(24, 12, config); golden.write(styledHistoryFixture); golden.resize(18, 10);
  assert.equal(firstHistoryDifference(normalizedHistorySnapshot(golden.captureSnapshot()), normalizedHistorySnapshot(existing.captureSnapshot())), null);
  existing.free(); golden.free();
});
test('allocator-enabled OSC strings are bounded and recover to ordinary output', async () => {
  const { ghostty, instance } = await core(); const t = ghostty.createTerminal(16, 3, config);
  const oversized = '\x1b]2;' + 'x'.repeat(100000) + '\x07'; let plateau = 0;
  for (let i = 0; i < 20; i++) { t.write(oversized); if (i === 3) plateau = instance.exports.memory.buffer.byteLength; if (i > 3) assert.equal(instance.exports.memory.buffer.byteLength, plateau); }
  t.write('AFTER'); assert.ok(text(t).text.startsWith('AFTER')); t.free();
});
