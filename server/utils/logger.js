'use strict';

function log(message, level = 'INFO') {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[JARVIS][${level}] ${ts} — ${message}`);
}

function warn(msg)  { log(msg, 'WARN'); }
function error(msg) { log(msg, 'ERROR'); }
function info(msg)  { log(msg, 'INFO'); }
function debug(msg) { if (process.env.DEBUG) log(msg, 'DEBUG'); }

module.exports = { log, warn, error, info, debug };
