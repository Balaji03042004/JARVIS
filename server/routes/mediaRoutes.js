'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mediaController');

router.post('/music',           ctrl.music);
router.post('/spotify',         ctrl.spotify);
router.post('/youtube-search',  ctrl.youtubeSearch);
router.post('/browse',          ctrl.browse);

module.exports = router;
