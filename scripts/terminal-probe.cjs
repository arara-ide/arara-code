const path = require('node:path');
const os = require('node:os');
const app = path.resolve(process.argv[2]);
const library = process.argv[3] ? path.resolve(process.argv[3]) : path.join(app, 'node_modules.asar/node-pty');
require(path.join(library, 'build/Release/pty.node'));
const pty = require(library);
const terminal = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'test -t 0 && test -t 1 && read -r value && stty size && printf "\\036%s\\037" "$value"'], {
  cwd: os.tmpdir(), env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' }, cols: 80, rows: 24,
});
let output = '';
const timeout = setTimeout(() => { terminal.kill(); process.exit(2); }, 8000);
terminal.onData(data => { output += data; });
terminal.onExit(event => {
  clearTimeout(timeout);
  if (event.exitCode === 0 && output.includes('31 97') && output.includes('\x1eARARA_TERMINAL_OK\x1f')) {
    console.log('ARARA_PTY_OK');
    process.exit(0);
  }
  console.error(JSON.stringify({ ...event, output }));
  process.exit(1);
});
terminal.resize(97, 31);
terminal.write('ARARA_TERMINAL_OK\r');
