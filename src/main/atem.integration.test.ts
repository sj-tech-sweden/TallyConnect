import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import { Atem } from 'atem-connection';
import path from 'path';

const RUN = process.env.RUN_ATEM_INTEGRATION === '1';
const PORT = 9931; // avoid clashing with a locally running mock on 9910
const HTTP_PORT = 9933;

/**
 * This integration test exercises the real `atem-connection` handshake against
 * our own Node ATEM simulator (scripts/mock-atem-node.js). It is opt-in so CI
 * never needs Python/hardware. pyAtemSim is intentionally NOT used here: it
 * speaks an older ATEM header that atem-connection does not understand, so it
 * never connects to this app.
 */
describe.skipIf(!RUN)('ATEM integration via Node simulator', () => {
  let child: any = null;
  let atem: any = null;

  beforeAll(async () => {
    // Ensure node is available.
    execSync('node --version', { stdio: 'ignore' });

    child = spawn(
      'node',
      [path.join(__dirname, '..', '..', 'scripts', 'mock-atem-node.js')],
      {
        stdio: 'ignore',
        env: {
          ...process.env,
          ATEM_MOCK_PORT: String(PORT),
          ATEM_MOCK_HTTP_PORT: String(HTTP_PORT),
          ATEM_MOCK_PROGRAM: '1',
          ATEM_MOCK_PREVIEW: '0',
        },
      },
    );

    // Give the simulator a moment to bind its UDP socket.
    await new Promise((r) => setTimeout(r, 500));
  }, 60000);

  afterAll(() => {
    if (atem) atem.disconnect();
    if (child) child.kill();
  });

  it('connects to the simulator and reflects tally state', async () => {
    atem = new Atem();
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connection timeout')), 8000);
      atem.on('connected', () => {
        clearTimeout(timer);
        resolve();
      });
      atem.on('error', (err: string) => reject(new Error(err)));
    });

    await atem.connect('127.0.0.1', PORT);
    await connected;

    const { computeTallyState } = await import('./tally');
    expect(computeTallyState(atem.state, true, 1)).toBe('program');

    // Flip the preview input via the simulator's HTTP control; the state change
    // should propagate to our computed tally state.
    await fetch(`http://127.0.0.1:${HTTP_PORT}/set?program=2&preview=1`);
    await new Promise((r) => setTimeout(r, 800));

    expect(computeTallyState(atem.state, true, 1)).toBe('preview');
  }, 15000);
});
