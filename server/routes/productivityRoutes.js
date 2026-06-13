'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/productivityController');

router.get('/reminders',              ctrl.getReminders);
router.post('/reminders',             ctrl.createReminder);
router.delete('/reminders/:id',       ctrl.deleteReminder);
router.patch('/reminders/:id/fired',  ctrl.markReminderFired);

router.get('/notes',                  ctrl.getNotes);
router.post('/notes',                 ctrl.createNote);
router.put('/notes/:id',              ctrl.updateNote);
router.delete('/notes/:id',           ctrl.deleteNote);

router.get('/news',                   ctrl.getNews);
router.get('/news-context',           ctrl.getNewsContext);
router.post('/search',                ctrl.search);

module.exports = router;
