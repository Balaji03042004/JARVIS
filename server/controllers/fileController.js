'use strict';

const logger      = require('../utils/logger');
const fileService = require('../services/fileService');
const aiService   = require('../services/aiService');

// ─── Filesystem Actions ───────────────────────────────────────────────────────

exports.filesystem = async (req, res) => {
  const { action, path: reqPath, folderName } = req.body;
  try {
    if (action === 'drives') {
      const drives = await fileService.getDrives();
      return res.json({ success: true, drives });
    }
    if (action === 'resolve') {
      const result = fileService.resolveSpecialFolder(folderName);
      return res.json({ success: !!result.path, ...result });
    }
    if (action === 'list') {
      const result = fileService.listDirectory(reqPath);
      return res.json({ success: true, ...result });
    }
    if (action === 'info') {
      const info = fileService.getFileInfo(reqPath);
      return res.json({ success: true, path: reqPath, name: info.name, info });
    }
    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (e) {
    const msg = e.code === 'ENOENT'  ? `Path not found: ${reqPath}` :
                e.code === 'EACCES'  ? `Access denied: ${reqPath}`  :
                e.code === 'ENOTDIR' ? `Not a directory: ${reqPath}` : e.message;
    res.json({ success: false, error: msg });
  }
};

// ─── Documents ────────────────────────────────────────────────────────────────

exports.uploadDocument = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file received' });
  try {
    const result = await fileService.uploadDocument(req.file);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Document parse error: ' + err.message);
    res.status(500).json({ success: false, error: `Could not read document: ${err.message}` });
  }
};

exports.getDocuments = (req, res) => {
  res.json({ success: true, documents: fileService.getDocuments() });
};

exports.deleteDocument = (req, res) => {
  if (fileService.deleteDocument(req.params.id)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Document not found' });
  }
};

// ─── Codebase Context ─────────────────────────────────────────────────────────

exports.getCodebaseContext = (req, res) => {
  try { res.json({ success: true, context: fileService.getCodebaseContext() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

// ─── Apply Feature ────────────────────────────────────────────────────────────

exports.applyFeature = (req, res) => {
  try {
    const result = fileService.applyFeature(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Apply feature error: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Develop Feature (AI-generated code) ─────────────────────────────────────

exports.developFeature = async (req, res) => {
  const { description, userProfile, currentMode, language } = req.body;
  logger.info(`Feature dev: ${description}`);
  try {
    const codebaseCtx  = fileService.getCodebaseContext();
    const systemPrompt = `You are JARVIS, an advanced feature development engine for a Node.js/Express + Vanilla JS web app.
Your task is to generate clean, working code for new features.

Return a JSON object with EXACTLY this structure:
{
  "success": true,
  "featureName": "Short Feature Name",
  "description": "One sentence description",
  "type": "ui",
  "language": "javascript",
  "js": "// Plain JavaScript — no <script> tags, no markdown fences.",
  "css": "/* Plain CSS — no <style> tags */",
  "html": "<!-- Optional HTML fragment. Empty string if not needed. -->",
  "implementation": "Brief note on how it works"
}

IMPORTANT: Return ONLY valid JSON. No markdown. No code fences. Escape newlines as \\n.

${codebaseCtx}`;

    const response = await aiService.callGroq({
      model:       aiService.GROQ_MODEL,
      messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Generate a feature for: ${description}` }],
      max_tokens:  1500,
      temperature: 0.7
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ success: false, error: err });
    }

    let reply = (await response.json())?.choices?.[0]?.message?.content || '';
    reply = reply.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');

    try {
      const featureData = JSON.parse(reply);
      res.json({
        success:        true,
        featureName:    featureData.featureName,
        description:    featureData.description,
        type:           featureData.type     || 'ui',
        language:       featureData.language || 'javascript',
        js:             featureData.js   || featureData.code || '',
        css:            featureData.css  || '',
        html:           featureData.html || '',
        implementation: featureData.implementation || ''
      });
    } catch {
      res.json({ success: true, featureName: 'Custom Feature', description, type: 'ui', language: 'javascript', js: reply.replace(/```[\w]*\n?/g, '').replace(/```\n?/g, '').trim(), css: '', html: '', implementation: '' });
    }
  } catch (error) {
    logger.error('Feature dev error: ' + error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
