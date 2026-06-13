'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/systemController');

router.get('/system-info',            ctrl.getSystemInfo);
router.post('/run-command',           ctrl.runCommand);
router.get('/apps/scan',              ctrl.scanApps);
router.post('/apps/search',           ctrl.searchApps);
router.post('/open-app',              ctrl.openApp);
router.post('/close-app',             ctrl.closeApp);
router.get('/process-monitor',        ctrl.getProcesses);
router.post('/process-monitor/kill',  ctrl.killProcess);
router.get('/network-info',           ctrl.getNetworkInfo);
router.post('/git',                   ctrl.runGitCommand);
router.post('/run-code',              ctrl.runCode);
router.get('/windows',                ctrl.getWindows);
router.post('/windows/action',        ctrl.windowAction);

module.exports = router;
