// src/shared/types.ts
export type TallyState = 'program' | 'preview' | 'off' | 'offline';

export interface AppConfig {
  atemIp: string;
  inputNumber: number;
  displayId: number | null;
  overlayStyle: 'border' | 'box' | 'both';
  borderWidth: number;
  overlayShowLabel: boolean;
  webServerPort: number;
}

// src/shared/constants.ts
export const IPC_CHANNELS = {
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  APP_QUIT: 'app-quit',
  TALLY_CHANGE: 'tally-change',
  ATEM_STATUS: 'atem-status',
} as const;