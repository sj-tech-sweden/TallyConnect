import { describe, it, expect } from 'vitest';
import { computeTallyState, buildTallyPayload } from './tally';

const me = (programInput: number, previewInput: number): Parameters<typeof computeTallyState>[0] => ({
  video: { mixEffects: [{ programInput, previewInput }] },
});

describe('computeTallyState', () => {
  it('returns offline when the ATEM is not connected', () => {
    expect(computeTallyState(me(1, 2), false, 1)).toBe('offline');
  });

  it('returns offline when the ATEM state is missing', () => {
    expect(computeTallyState(null, true, 1)).toBe('offline');
    expect(computeTallyState(undefined, true, 1)).toBe('offline');
  });

  it('returns offline when mix effects are absent', () => {
    expect(computeTallyState({ video: {} }, true, 1)).toBe('offline');
  });

  it('returns program when the input is on program', () => {
    expect(computeTallyState(me(3, 2), true, 3)).toBe('program');
  });

  it('returns preview when the input is on preview', () => {
    expect(computeTallyState(me(1, 3), true, 3)).toBe('preview');
  });

  it('returns off when the input is neither program nor preview', () => {
    expect(computeTallyState(me(1, 2), true, 5)).toBe('off');
  });
});

describe('buildTallyPayload', () => {
  it('serializes the tally-change event', () => {
    expect(buildTallyPayload('program')).toBe(
      JSON.stringify({ type: 'tally-change', state: 'program' })
    );
    expect(buildTallyPayload('offline')).toBe(
      JSON.stringify({ type: 'tally-change', state: 'offline' })
    );
  });
});
