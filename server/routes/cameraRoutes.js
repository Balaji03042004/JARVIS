'use strict';

const router = require('express').Router();
const c      = require('../controllers/cameraController');

router.get('/camera/devices',           c.listDevices);      // list webcams
router.get('/camera/status',            c.status);           // ffmpeg + recording status
router.post('/camera/open',             c.openApp);          // open Windows Camera app
router.post('/camera/capture',          c.capture);          // take a photo
router.post('/camera/record/start',     c.startRecording);   // start video recording
router.post('/camera/record/stop',      c.stopRecording);    // stop recording
router.get('/camera/captures',          c.listCaptures);     // list all captures
router.delete('/camera/captures/:filename', c.deleteCapture);// delete a capture
router.post('/camera/set-device',       c.setDevice);        // override default camera

module.exports = router;
