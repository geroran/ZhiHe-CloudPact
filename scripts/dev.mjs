import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const python = isWindows ? 'python' : 'python3';
const children = [];

function run(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: isWindows,
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run(python, ['server/app.py']);
run(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev:web']);
