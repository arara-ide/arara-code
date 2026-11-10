'use strict';

const vscode = require('vscode');
const { registerUpdate } = require('./register');
const { registerLinuxRestart } = require('./linux-restart');
const { registerCompanion } = require('./companion-register');

function activate(context) {
  registerUpdate(context, vscode);
  registerLinuxRestart(context, vscode);
  registerCompanion(context, vscode);
}

function deactivate() {}

module.exports = { activate, deactivate };
