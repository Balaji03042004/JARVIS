'use strict';

const logger        = require('../utils/logger');
const systemService = require('../services/systemService');

exports.getSystemInfo = (req, res) => {
  res.json(systemService.getSystemInfo());
};

exports.runCommand = async (req, res) => {
  const { command, shell = 'powershell' } = req.body;
  const result = await systemService.executeShellCommand(command, shell);
  if (!result.success && result.error === 'No command provided') return res.status(400).json(result);
  res.json(result);
};

exports.scanApps = async (req, res) => {
  const apps = await systemService.getScannedApps(req.query.refresh === 'true');
  res.json({ success: true, count: apps.length, apps: apps.map(a => ({ name: a.name, path: a.lnkPath })) });
};

exports.searchApps = async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false });
  const apps  = await systemService.getScannedApps();
  const match = systemService.fuzzyFindApp(apps, query);
  res.json({ success: !!match, match: match ? { name: match.name, path: match.lnkPath } : null });
};

exports.openApp = async (req, res) => {
  const { appName } = req.body;
  if (!appName) return res.status(400).json({ success: false, error: 'No app name provided' });
  const result = await systemService.openAnyAppTarget(appName);
  res.json(result);
};

exports.closeApp = async (req, res) => {
  const { target, browser, force = false } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target provided' });
  const result = await systemService.closeApp(target, browser, force);
  res.json(result);
};

exports.getProcesses = async (req, res) => {
  try {
    const processes = await systemService.getProcessList();
    res.json({ success: true, processes });
  } catch (e) { res.json({ success: false, error: e.message, processes: [] }); }
};

exports.killProcess = async (req, res) => {
  const { pid } = req.body || {};
  if (!pid || !/^\d+$/.test(String(pid))) return res.status(400).json({ success: false, error: 'Invalid PID' });
  try { await systemService.killProcess(pid); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
};

exports.getNetworkInfo = async (req, res) => {
  try { res.json({ success: true, ...(await systemService.getNetworkInfo()) }); }
  catch (e) { res.json({ success: false, error: e.message }); }
};

exports.runGitCommand = async (req, res) => {
  const { cwd, subcommand, args } = req.body || {};
  try {
    const output = await systemService.runGitCommand(cwd, subcommand, args);
    res.json({ success: true, output });
  } catch (e) { res.json({ success: false, error: e.message, output: '' }); }
};

exports.runCode = async (req, res) => {
  const { code, language } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: 'code required' });
  const result = await systemService.runCode(code, language);
  res.json(result);
};

exports.getWindows = async (req, res) => {
  try { res.json({ success: true, windows: await systemService.getWindows() }); }
  catch (e) { res.json({ success: false, error: e.message, windows: [] }); }
};

exports.windowAction = async (req, res) => {
  const { pid, action } = req.body || {};
  if (!pid || !/^\d+$/.test(String(pid))) return res.status(400).json({ success: false, error: 'Invalid PID' });
  try { res.json(await systemService.windowAction(pid, action)); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
};
