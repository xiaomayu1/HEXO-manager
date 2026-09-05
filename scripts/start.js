#!/usr/bin/env node
'use strict';

/**
 * Launcher: clears ELECTRON_RUN_AS_NODE before spawning electron.exe.
 * When this env var is set, electron runs in Node.js compatibility mode
 * and require('electron') resolves to a path string instead of the API.
 */
const { spawn } = require('child_process');
const path = require('path');

const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')
);

const exe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const proc = spawn(exe, ['.'], { stdio: 'inherit', windowsHide: false, env });

proc.on('exit', (code) => process.exit(code ?? 0));
