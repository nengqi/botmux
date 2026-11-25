import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTranscriptTerminalSettle } from '../src/services/transcript-terminal-settle.js';

describe('createTranscriptTerminalSettle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('finalizes immediately when the transcript already shows the terminal', () => {
    const proceed = vi.fn();
    createTranscriptTerminalSettle({ awaitingTerminal: () => false }).request(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('waits for the terminal marker to land, then finalizes once', () => {
    const proceed = vi.fn();
    let awaiting = true;
    createTranscriptTerminalSettle({ awaitingTerminal: () => awaiting }).request(proceed);
    vi.advanceTimersByTime(250);
    expect(proceed).not.toHaveBeenCalled();
    awaiting = false;
    vi.advanceTimersByTime(100);
    expect(proceed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('holds past the bound while the transcript is mid tool cycle (#3702)', () => {
    const proceed = vi.fn();
    let mid = true;
    let awaiting = true;
    createTranscriptTerminalSettle({
      awaitingTerminal: () => awaiting, midToolCycle: () => mid, timeoutMs: 2_000, pollMs: 100, maxHoldMs: 60_000,
    }).request(proceed);
    vi.advanceTimersByTime(30_000);
    expect(proceed).not.toHaveBeenCalled(); // a premature "done" between two tools does not settle the turn
    mid = false; // the final answer block landed (stop_reason end_turn) but the closing marker is still unread
    vi.advanceTimersByTime(1_000);
    expect(proceed).toHaveBeenCalledTimes(1);
    awaiting = false;
    vi.advanceTimersByTime(5_000);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('stops holding at maxHoldMs even if still mid tool cycle', () => {
    const proceed = vi.fn();
    createTranscriptTerminalSettle({
      awaitingTerminal: () => true, midToolCycle: () => true, timeoutMs: 2_000, pollMs: 100, maxHoldMs: 10_000,
    }).request(proceed);
    vi.advanceTimersByTime(9_000);
    expect(proceed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('a mid-cycle probe that throws finalizes as before', () => {
    const proceed = vi.fn();
    createTranscriptTerminalSettle({
      awaitingTerminal: () => true, midToolCycle: () => { throw new Error('unreadable'); }, timeoutMs: 2_000, pollMs: 100,
    }).request(proceed);
    vi.advanceTimersByTime(2_200);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('gives up after the bound and finalizes anyway', () => {
    const proceed = vi.fn();
    createTranscriptTerminalSettle({ awaitingTerminal: () => true, timeoutMs: 2_000, pollMs: 100 }).request(proceed);
    vi.advanceTimersByTime(1_900);
    expect(proceed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('reports a bound that ran out, and only that', () => {
    const proceed = vi.fn();
    const onTimeout = vi.fn(() => { expect(proceed).not.toHaveBeenCalled(); });
    let awaiting = true;
    const settle = createTranscriptTerminalSettle({ awaitingTerminal: () => awaiting, onTimeout, timeoutMs: 2_000, pollMs: 100 });
    settle.request(proceed);
    vi.advanceTimersByTime(2_100);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);

    settle.request(proceed);
    vi.advanceTimersByTime(300);
    awaiting = false;
    vi.advanceTimersByTime(100);
    expect(proceed).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not finalize when the agent goes back to work', () => {
    const proceed = vi.fn();
    const settle = createTranscriptTerminalSettle({ awaitingTerminal: () => true });
    settle.request(proceed);
    vi.advanceTimersByTime(300);
    settle.cancel();
    vi.advanceTimersByTime(5_000);
    expect(proceed).not.toHaveBeenCalled();
  });

  it('a newer finished signal replaces the pending one', () => {
    const proceed = vi.fn();
    let awaiting = true;
    const settle = createTranscriptTerminalSettle({ awaitingTerminal: () => awaiting });
    settle.request(proceed);
    vi.advanceTimersByTime(300);
    settle.request(proceed);
    awaiting = false;
    vi.advanceTimersByTime(100);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('finalizes as before when the transcript cannot be read', () => {
    const proceed = vi.fn();
    createTranscriptTerminalSettle({ awaitingTerminal: () => { throw new Error('EIO'); } }).request(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
