'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { UPDATE_BUSY_LIMIT_MS, UpdateBusy } = require('../src/busy');

function setup() {
  const published = [];
  const timers = [];
  const busy = new UpdateBusy(value => published.push(value), UPDATE_BUSY_LIMIT_MS, (fn, ms) => {
    const timer = { fn, ms, disposed: false };
    timers.push(timer);
    return { dispose: () => { timer.disposed = true; } };
  });
  return { busy, published, timers };
}

describe('UpdateBusy', () => {
  it('publishes busy on start and refuses a second start while busy', () => {
    const { busy, published } = setup();
    assert.notEqual(busy.start(), undefined);
    assert.equal(busy.busy, true);
    assert.equal(busy.start(), undefined);
    assert.deepEqual(published, [true]);
  });

  it('ends when the installer closes and cancels the time limit', () => {
    const { busy, published, timers } = setup();
    const run = busy.start();
    busy.wait(run);
    assert.equal(timers[0].ms, 2 * 60_000);
    busy.finish(run);
    assert.equal(busy.busy, false);
    assert.equal(timers[0].disposed, true);
    assert.deepEqual(published, [true, false]);
  });

  it('ends after two minutes when nothing reports the installer closing', () => {
    const { busy, published, timers } = setup();
    busy.wait(busy.start());
    timers[0].fn();
    assert.equal(busy.busy, false);
    assert.deepEqual(published, [true, false]);
  });

  it('ignores a late close from a previous run', () => {
    const { busy, published, timers } = setup();
    const first = busy.start();
    busy.wait(first);
    timers[0].fn();
    busy.wait(busy.start());
    busy.finish(first);
    assert.equal(busy.busy, true);
    assert.deepEqual(published, [true, false, true]);
  });

  it('does not arm the limit after the run already ended', () => {
    const { busy, timers } = setup();
    const run = busy.start();
    busy.finish(run);
    busy.wait(run);
    assert.equal(timers.length, 0);
  });

  it('disposes the pending limit', () => {
    const { busy, timers } = setup();
    busy.wait(busy.start());
    busy.dispose();
    assert.equal(timers[0].disposed, true);
  });
});
