import { query } from '../../config/db.js';

/** Write one audit row. Pass a transaction client to make it part of that transaction. */
export async function recordAuditEvent(
  client,
  { entityType, entityId, action, actorId = null, actorRole = null, metadata = {} }
) {
  const db = client || { query };
  const { rows } = await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor_id, actor_role, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, entity_type, entity_id, action, actor_id, actor_role, metadata, created_at;`,
    [entityType, entityId, action, actorId, actorRole, JSON.stringify(metadata)]
  );
  return rows[0];
}

export async function listAuditLogs({ entityType, entityId, action, actorId, limit = 50, offset = 0 } = {}) {
  const params = [];
  const conditions = [];
  const filter = (column, value) => {
    if (!value) return;
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  };
  filter('al.entity_type', entityType);
  filter('al.entity_id', entityId);
  filter('al.action', action);
  filter('al.actor_id', actorId);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const count = await query(`SELECT COUNT(*) AS total FROM audit_log al ${where};`, params);

  params.push(Math.min(limit || 50, 100), offset || 0);
  const { rows } = await query(
    `SELECT al.id, al.entity_type, al.entity_id, al.action, al.actor_id, u.email AS actor_email,
            al.actor_role, al.metadata, al.created_at
     FROM audit_log al
     LEFT JOIN users u ON al.actor_id = u.id
     ${where}
     ORDER BY al.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params
  );

  return { logs: rows, total: Number(count.rows[0].total) };
}
