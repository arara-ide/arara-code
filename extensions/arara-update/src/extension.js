'use strict';

const vscode = require('vscode');
const { registerUpdate } = require('./register');

function activate(context) {
  registerUpdate(context, vscode);
}

function deactivate() {}

module.exports = { activate, deactivate };
