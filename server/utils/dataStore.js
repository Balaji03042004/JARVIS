'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readData(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8')); }
  catch { return fallback !== undefined ? fallback : []; }
}

function writeData(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { readData, writeData, DATA_DIR };
