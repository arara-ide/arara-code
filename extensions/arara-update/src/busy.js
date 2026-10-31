'use strict';

const UPDATE_BUSY_LIMIT_MS = 2 * 60_000;

const defaultTimer = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return { dispose: () => clearTimeout(timer) };
};

class UpdateBusy {
  constructor(publish, limitMs = UPDATE_BUSY_LIMIT_MS, setTimer = defaultTimer) {
    this.publish = publish;
    this.limitMs = limitMs;
    this.setTimer = setTimer;
    this.run = 0;
    this.active = false;
    this.timer = undefined;
  }

  get busy() {
    return this.active;
  }

  start() {
    if (this.active) return undefined;
    this.active = true;
    this.publish(true);
    return ++this.run;
  }

  wait(run) {
    if (!this.active || run !== this.run) return;
    this.timer?.dispose();
    this.timer = this.setTimer(() => this.finish(run), this.limitMs);
  }

  finish(run) {
    if (!this.active || run !== this.run) return;
    this.timer?.dispose();
    this.timer = undefined;
    this.active = false;
    this.publish(false);
  }

  dispose() {
    this.timer?.dispose();
    this.timer = undefined;
  }
}

module.exports = { UPDATE_BUSY_LIMIT_MS, UpdateBusy };
