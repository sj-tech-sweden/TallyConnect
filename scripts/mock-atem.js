#!/usr/bin/env node
/**
 * Launches the pyAtemSim ATEM simulator so TallyConnect can be developed and
 * tested without real hardware.
 *
 *   npm run mock
 *
 * Clones pyAtemSim on first run, then runs `atem_server.py` (UDP/9910).
 * Point TallyConnect's ATEM IP at 127.0.0.1 to connect.
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'https://github.com/jonknoll/pyAtemSim.git';
const DEST = process.env.ATEM_MOCK_DIR || path.join(os.homedir(), '.tallyconnect-mock', 'pyAtemSim');
const PORT = process.env.ATEM_MOCK_PORT || '9910';
const ADDRESS = process.env.ATEM_MOCK_ADDRESS || '0.0.0.0';

function pythonCommand() {
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch {
      /* try next */
    }
  }
  return null;
}

function cloneIfNeeded() {
  if (fs.existsSync(path.join(DEST, 'atem_server.py'))) return;
  console.log(`Cloning pyAtemSim into ${DEST} ...`);
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  execSync(`git clone --depth 1 ${REPO} ${DEST}`, { stdio: 'inherit' });
}

function main() {
  const py = pythonCommand();
  if (!py) {
    console.error('Python 3 is required to run the ATEM simulator. Install it and retry.');
    process.exit(1);
  }

  cloneIfNeeded();

  console.log(`Starting pyAtemSim on udp://${ADDRESS}:${PORT}`);
  console.log("In TallyConnect, set the ATEM IP to 127.0.0.1 (or run: ATEM_IP=127.0.0.1 npm run dev)");
  console.log('Press Ctrl+C to stop.\n');

  const child = spawn(py, [path.join(DEST, 'atem_server.py'), '--address', ADDRESS, '--port', PORT], {
    stdio: 'inherit',
  });

  const shutdown = () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
