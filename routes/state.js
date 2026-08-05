// ══════════════════════════════════════════════════════════════
//  /api/state — per-(tenant, project) state load and save
//
//  Every state read/write is scoped to req.user.tenantId AND a project
//  name. A client (tenant) can keep many named projects; each is its own
//  saved register, picked/typed at login and resumed under that name.
//  Consultants without a tenant_id pick a tenant via ?tenantId=xxx.
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_PROJECT = 'Default Project';

// Resolve which tenant the request is acting on.
// - client_user: always their own tenant_id, ignores query.
// - consultant: must pass ?tenantId=... (or it'd be ambiguous).
function _resolveTenant(req){
  if(req.user.role === 'client_user'){
    return req.user.tenantId || null;
  }
  // consultant
  return (req.query?.tenantId || req.body?.tenantId || '').toString() || null;
}

// Resolve the project name (free text the client typed at login).
// Falls back to a single default project when none is supplied.
function _resolveProject(req){
  const p = (req.query?.project ?? req.body?.project ?? '').toString().trim();
  return p || DEFAULT_PROJECT;
}

// GET /api/state/projects[?tenantId=xxx] — list this tenant's projects.
// Powers the "continue an existing project" picker.
router.get('/projects', requireAuth, async (req, res) => {
  const tenantId = _resolveTenant(req);
  if(!tenantId){
    return res.status(400).json({ error: 'tenant_required' });
  }
  try {
    const r = await pool.query(
      `SELECT project, updated_at FROM app_state
        WHERE tenant_id = $1 ORDER BY updated_at DESC`,
      [tenantId]
    );
    res.json({
      tenantId,
      projects: r.rows.map(x => ({ project: x.project, updatedAt: x.updated_at }))
    });
  } catch(err){
    console.error('GET /api/state/projects error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/state[?tenantId=xxx][&project=yyy]
router.get('/', requireAuth, async (req, res) => {
  const tenantId = _resolveTenant(req);
  if(!tenantId){
    return res.status(400).json({ error: 'tenant_required' });
  }
  const project = _resolveProject(req);
  try {
    const r = await pool.query(
      `SELECT state, updated_at FROM app_state
        WHERE tenant_id = $1 AND project = $2 LIMIT 1`,
      [tenantId, project]
    );
    if(!r.rows.length){
      // No state yet for this project — return empty so the frontend seeds it
      return res.json({ tenantId, project, state: null, updatedAt: null });
    }
    res.json({
      tenantId,
      project,
      state:     r.rows[0].state,
      updatedAt: r.rows[0].updated_at
    });
  } catch(err){
    console.error('GET /api/state error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/state  body: { state: {...}, tenantId?: 'xxx', project?: 'yyy' }
router.post('/', requireAuth, express.json({ limit: '50mb' }), async (req, res) => {
  const tenantId = _resolveTenant(req);
  if(!tenantId){
    return res.status(400).json({ error: 'tenant_required' });
  }
  const project = _resolveProject(req);
  const state = req.body?.state;
  if(!state || typeof state !== 'object'){
    return res.status(400).json({ error: 'state_object_required' });
  }
  try {
    // Verify the tenant exists (and the user is allowed to write to it)
    const t = await pool.query(`SELECT 1 FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
    if(!t.rows.length){
      return res.status(404).json({ error: 'tenant_not_found' });
    }
    if(req.user.role === 'client_user' && req.user.tenantId !== tenantId){
      return res.status(403).json({ error: 'forbidden' });
    }

    const r = await pool.query(
      `INSERT INTO app_state (tenant_id, project, state, updated_at, updated_by)
       VALUES ($1, $2, $3::jsonb, NOW(), $4)
       ON CONFLICT (tenant_id, project) DO UPDATE
         SET state = EXCLUDED.state,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [tenantId, project, JSON.stringify(state), req.user.id]
    );
    res.json({
      ok:        true,
      tenantId,
      project,
      updatedAt: r.rows[0].updated_at
    });
  } catch(err){
    console.error('POST /api/state error:', err);
    if(err.code === '54000' || /size/i.test(err.message)){
      return res.status(413).json({ error: 'state_too_large' });
    }
    res.status(500).json({ error: 'server_error' });
  }
});

const BRAND_PROJECT = '__ahs_client_brand__';

// DELETE /api/state?project=yyy[&tenantId=xxx] — delete a project and its data.
router.delete('/', requireAuth, express.json(), async (req, res) => {
  const tenantId = _resolveTenant(req);
  if(!tenantId){ return res.status(400).json({ error: 'tenant_required' }); }
  const project = (req.query?.project ?? req.body?.project ?? '').toString().trim();
  if(!project){ return res.status(400).json({ error: 'project_required' }); }
  if(project === BRAND_PROJECT){ return res.status(400).json({ error: 'reserved_project' }); }
  if(req.user.role === 'client_user' && req.user.tenantId !== tenantId){
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const r = await pool.query(
      `DELETE FROM app_state WHERE tenant_id = $1 AND project = $2`,
      [tenantId, project]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch(err){
    console.error('DELETE /api/state error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/state/rename  body: { project, newProject, tenantId? } — rename a project.
router.post('/rename', requireAuth, express.json(), async (req, res) => {
  const tenantId = _resolveTenant(req);
  if(!tenantId){ return res.status(400).json({ error: 'tenant_required' }); }
  const project    = (req.body?.project ?? '').toString().trim();
  const newProject = (req.body?.newProject ?? '').toString().trim();
  if(!project || !newProject){ return res.status(400).json({ error: 'project_required' }); }
  if(project === BRAND_PROJECT || newProject === BRAND_PROJECT){ return res.status(400).json({ error: 'reserved_project' }); }
  if(project === newProject){ return res.json({ ok: true, project: newProject }); }
  if(req.user.role === 'client_user' && req.user.tenantId !== tenantId){
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const exists = await pool.query(
      `SELECT 1 FROM app_state WHERE tenant_id = $1 AND project = $2 LIMIT 1`,
      [tenantId, newProject]
    );
    if(exists.rows.length){ return res.status(409).json({ error: 'project_exists' }); }
    const r = await pool.query(
      `UPDATE app_state SET project = $1, updated_at = NOW() WHERE tenant_id = $2 AND project = $3`,
      [newProject, tenantId, project]
    );
    if(r.rowCount === 0){ return res.status(404).json({ error: 'project_not_found' }); }
    res.json({ ok: true, project: newProject });
  } catch(err){
    if(err.code === '23505'){ return res.status(409).json({ error: 'project_exists' }); }
    console.error('POST /api/state/rename error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
