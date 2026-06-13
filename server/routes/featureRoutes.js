'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/featureController');

router.post('/profile/save',       ctrl.saveProfile);
router.post('/features/track',     ctrl.trackFeature);
router.post('/features/recommend', ctrl.recommendFeatures);

module.exports = router;
