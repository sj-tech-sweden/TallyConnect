import { describe, it, expect, vi } from 'vitest';
import { AtemTallyClient, type AtemLike } from './atem';

class FakeAtem implements AtemLike {
  handlers: Record<string, Array<(...args: any[]) => void>> = {};
  state: any = undefined;
  connectCalls: string[] = [];

  on(event: string, listener: (...args: any[]) => void): this {
    (this.handlers[event] ||= []).push(listener);
    return this;
  }
  emit(event: string, ...args: any[]) {
    (this.handlers[event] || []).forEach((cb) => cb(...args));
  }
  connect(address: string): Promise<void> {
    this.connectCalls.push(address);
    this.emit('connected');
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.emit('disconnected');
    return Promise.resolve();
  }
}

const mixEffects = (programInput: number, previewInput: number) => ({
  video: { mixEffects: [{ programInput, previewInput }] },
});

describe('AtemTallyClient', () => {
  it('reports connected and emits a tally state once connected', () => {
    const atem = new FakeAtem();
    const client = new AtemTallyClient({ ip: '127.0.0.1', inputNumber: 1 }, atem);
    const tally = vi.fn();
    const status = vi.fn();
    client.onTally(tally);
    client.onStatus(status);

    client.connect();

    expect(atem.connectCalls).toEqual(['127.0.0.1']);
    expect(status).toHaveBeenCalledWith('connected');
    // state is undefined -> offline
    expect(tally).toHaveBeenCalledWith('offline');
    expect(client.getState()).toBe('offline');
  });

  it('recomputes tally on state changes', () => {
    const atem = new FakeAtem();
    const client = new AtemTallyClient({ ip: '127.0.0.1', inputNumber: 3 }, atem);
    const tally = vi.fn();
    client.onTally(tally);
    client.connect();

    atem.state = mixEffects(3, 2);
    atem.emit('stateChanged', atem.state, []);

    expect(tally).toHaveBeenLastCalledWith('program');
    expect(client.getState()).toBe('program');
  });

  it('emits disconnected and schedules a reconnect on drop', () => {
    vi.useFakeTimers();
    try {
      const atem = new FakeAtem();
      const client = new AtemTallyClient(
        { ip: '127.0.0.1', inputNumber: 1, reconnectIntervalMs: 100 },
        atem
      );
      const status = vi.fn();
      client.onStatus(status);
      client.connect();
      status.mockClear();

      atem.emit('disconnected');
      expect(status).toHaveBeenCalledWith('disconnected');

      // Advance past the reconnect interval -> a new connect attempt happens.
      vi.advanceTimersByTime(100);
      expect(atem.connectCalls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects to a new IP when updateConfig changes it', () => {
    const atem = new FakeAtem();
    const client = new AtemTallyClient({ ip: '127.0.0.1', inputNumber: 1 }, atem);
    client.connect();
    expect(atem.connectCalls).toEqual(['127.0.0.1']);

    client.updateConfig({ ip: '10.0.0.5' });
    expect(atem.connectCalls).toEqual(['127.0.0.1', '10.0.0.5']);
  });

  it('does not reconnect when only the input number changes', () => {
    const atem = new FakeAtem();
    const client = new AtemTallyClient({ ip: '127.0.0.1', inputNumber: 1 }, atem);
    client.connect();
    atem.connectCalls = [];

    client.updateConfig({ inputNumber: 4 });
    expect(atem.connectCalls).toEqual([]);
    expect(client.getState()).toBe('offline');
  });
});
