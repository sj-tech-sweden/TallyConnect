import type { TallyState } from '../shared/types';

export interface MixEffectState {
  programInput?: number;
  previewInput?: number;
}

export interface AtemStateLike {
  video?: {
    mixEffects?: MixEffectState[];
  };
}

/**
 * Pure computation of the tally state for a given ATEM input.
 * Extracted from main.ts so it can be unit tested without Electron/ATEM.
 */
export function computeTallyState(
  atemState: AtemStateLike | null | undefined,
  connected: boolean,
  inputNumber: number
): TallyState {
  if (!connected || !atemState?.video?.mixEffects?.[0]) {
    return 'offline';
  }

  const me = atemState.video.mixEffects[0];

  if (me.programInput === inputNumber) return 'program';
  if (me.previewInput === inputNumber) return 'preview';
  return 'off';
}

/** Builds the WebSocket payload broadcast to web tally clients. */
export function buildTallyPayload(state: TallyState): string {
  return JSON.stringify({ type: 'tally-change', state });
}
