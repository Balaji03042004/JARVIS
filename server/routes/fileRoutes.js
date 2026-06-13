'use strict';

const express = require('express');
const router  = express.Router();
const upload  = require('../utils/upload');
const ctrl    = require('../controllers/fileController');

router.post('/filesystem',                               ctrl.filesystem);
router.post('/upload-document', upload.single('file'),   ctrl.uploadDocument);
router.get('/documents',                                 ctrl.getDocuments);
router.delete('/documents/:id',                          ctrl.deleteDocument);
router.get('/codebase-context',                          ctrl.getCodebaseContext);
router.post('/apply-feature',                            ctrl.applyFeature);
router.post('/develop-feature',                          ctrl.developFeature);

module.exports = router;
