import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../src/core/input.js';

test('empty snapshot is all zeros', () => {
  const inp = createInput();
  assert.deepEqual(inp.snapshot(), { throttleDelta: 0, pitch: 0, roll: 0, yaw: 0 });
});

test('W pushes the nose down; S pushes it up (user preference)', () => {
  const inp = createInput();
  inp.update([{ type: 'down', code: 'KeyW' }]);
  assert.equal(inp.snapshot().pitch, -1); // W = nose down
  inp.update([{ type: 'up', code: 'KeyW' }, { type: 'down', code: 'KeyS' }]);
  assert.equal(inp.snapshot().pitch, 1);  // S = nose up
});

test('arrow keys are aliases for WASD', () => {
  const inp = createInput();
  inp.update([{ type: 'down', code: 'ArrowUp' }, { type: 'down', code: 'ArrowLeft' }]);
  const s = inp.snapshot();
  assert.equal(s.pitch, -1); // ArrowUp follows W (nose down)
  assert.equal(s.roll, 1);   // left bank positive
});

test('roll and yaw directions', () => {
  const inp = createInput();
  inp.update([{ type: 'down', code: 'KeyD' }, { type: 'down', code: 'KeyE' }]);
  const s = inp.snapshot();
  assert.equal(s.roll, -1); // right bank negative
  assert.equal(s.yaw, -1);  // yaw right negative
});

test('throttle keys set rate; both held cancels to zero', () => {
  const inp = createInput();
  inp.update([{ type: 'down', code: 'ShiftLeft' }]);
  assert.equal(inp.snapshot().throttleDelta, 1);
  inp.update([{ type: 'down', code: 'ControlRight' }]);
  assert.equal(inp.snapshot().throttleDelta, 0);
  inp.update([{ type: 'up', code: 'ShiftLeft' }]); // only throttle-down remains
  assert.equal(inp.snapshot().throttleDelta, -1);
});

test('held keys persist across updates; release clears them', () => {
  const inp = createInput();
  inp.update([{ type: 'down', code: 'KeyW' }]);
  inp.update([]); // no events — still held
  assert.equal(inp.snapshot().pitch, -1);
  inp.update([{ type: 'up', code: 'KeyW' }]);
  assert.equal(inp.snapshot().pitch, 0);
});

test('malformed events are ignored without throwing', () => {
  const inp = createInput();
  inp.update([null, {}, { type: 'down' }, { type: 'bogus', code: 'KeyW' }]);
  assert.deepEqual(inp.snapshot(), { throttleDelta: 0, pitch: 0, roll: 0, yaw: 0 });
});

test('reset clears all state', () => {
  const inp = createInput();
  inp.update([{ type: 'down', code: 'KeyW' }, { type: 'down', code: 'ShiftLeft' }]);
  inp.reset();
  assert.deepEqual(inp.snapshot(), { throttleDelta: 0, pitch: 0, roll: 0, yaw: 0 });
});
