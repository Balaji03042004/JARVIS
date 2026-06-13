'use strict';

const express = require('express');
const router  = express.Router();
const upload  = require('../utils/upload');
const ctrl    = require('../controllers/chatController');

router.post('/chat',                      ctrl.chat);
router.get('/tts',                        ctrl.tts);
router.post('/transcribe', upload.single('audio'), ctrl.transcribe);
router.post('/vision',     upload.single('image'), ctrl.vision);
router.post('/image-gen',                 ctrl.imageGen);

module.exports = router;
