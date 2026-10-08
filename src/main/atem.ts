import { computeTallyState } from './tally';
import type { TallyState } from '../shared/types';

export type AtemStatus = 'connecting' | 'connected' | 'disconnected';

export interface AtemTallyClientOptions {
  ip: string;
  inputNumber: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export interface AtemLike {
  on(event: string, listener: (...args: any[]) => void): any;
  connect(address: string, port?: number): Promise<void>;
  disconnect(): Promise<void>;
  state?: unknown;
}

type TallyListener = (state: TallyState) => void;
type StatusListener = (status: AtemStatus) => void;

/**
 * Owns the ATEM connection and translates its state into a tally state.
 * Decoupled from Electron so it can be unit tested with a fake ATEM.
 */
export class AtemTallyClient {
  private atem: AtemLike;
  private ip: string;
  private inputNumber: number;
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;

  private status: AtemStatus = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private disposed = false;

  private tallyListeners = new Set<TallyListener>();
  private statusListeners = new Set<StatusListener>();

  constructor(opts: AtemTallyClientOptions, atemInstance?: AtemLike) {
    this.ip = opts.ip;
    this.inputNumber = opts.inputNumber;
    this.reconnectIntervalMs = opts.reconnectIntervalMs ?? 5000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? Infinity;
    // Lazy require keeps this module testable without loading electron-ATEM in CI.
    this.atem = atemInstance ?? new (require('atem-connection').Atem)();
    this.wire();
  }

  private wire() {
    this.atem.on('connected', () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      this.emitTally();
    });

    this.atem.on('stateChanged', () => {
      this.emitTally();
    });

    this.atem.on('disconnected', () => {
      this.setStatus('disconnected');
      this.emitTally();
      this.scheduleReconnect();
    });

    this.atem.on('error', () => {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });
  }

  connect() {
    if (this.disposed) return;
    this.setStatus('connecting');
    this.atem
      .connect(this.ip)
      .catch(() => {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      });
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) this.connect();
    }, this.reconnectIntervalMs);
  }

  private emitTally() {
    const state = this.getState();
    this.tallyListeners.forEach((l) => l(state));
  }

  private setStatus(status: AtemStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  getStatus(): AtemStatus {
    return this.status;
  }

  getState(): TallyState {
    return computeTallyState(this.atem.state as any, this.status === 'connected', this.inputNumber);
  }

  /** Update runtime config. Changing the IP triggers a reconnect. */
  updateConfig(opts: Partial<{ ip: string; inputNumber: number }>) {
    if (opts.inputNumber !== undefined) {
      this.inputNumber = opts.inputNumber;
    }
    if (opts.ip !== undefined && opts.ip !== this.ip) {
      this.ip = opts.ip;
      this.reconnectAttempts = 0;
      this.atem.disconnect().catch(() => undefined);
      this.connect();
    }
    this.emitTally();
  }

  onTally(cb: TallyListener): () => void {
    this.tallyListeners.add(cb);
    return () => this.tallyListeners.delete(cb);
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.tallyListeners.clear();
    this.statusListeners.clear();
    try {
      this.atem.disconnect();
    } catch {
      /* ignore */
    }
  }
}
