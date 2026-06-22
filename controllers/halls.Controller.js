import db from '../db.js';
import logger from '../utils/logger.js';

// GET /api/halls
// Returns all halls owned by the authenticated admin.
export const getMyHalls = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const adminRole = req.admin.role;

    if (adminRole === 'superAdmin') {
      const { rows } = await db.query(
        `SELECT id, name, location, district, state, latitude, longitude,
                phone, description, is_active, created_at, org_id
         FROM cinema_hall
         WHERE is_active = TRUE
         ORDER BY created_at ASC`
      );
      return res.status(200).json({ halls: rows });
    }

    // Fetch organization membership
    const memberRes = await db.query(
      `SELECT om.org_id, r.key AS role_key
       FROM organization_members om
       JOIN roles r ON r.id = om.role_id
       WHERE om.admin_id = $1 AND om.status = 'active'
       LIMIT 1`,
      [adminId]
    );

    if (memberRes.rows.length === 0) {
      return res.status(200).json({ halls: [] });
    }

    const { org_id, role_key } = memberRes.rows[0];

    let queryStr;
    let queryParams;

    if (role_key === 'owner' || role_key === 'admin') {
      queryStr = `
        SELECT id, name, location, district, state, latitude, longitude,
               phone, description, is_active, created_at, org_id
        FROM cinema_hall
        WHERE org_id = $1 AND is_active = TRUE
        ORDER BY created_at ASC
      `;
      queryParams = [org_id];
    } else {
      queryStr = `
        SELECT ch.id, ch.name, ch.location, ch.district, ch.state, ch.latitude, ch.longitude,
               ch.phone, ch.description, ch.is_active, ch.created_at, ch.org_id
        FROM cinema_hall ch
        JOIN hall_assignments ha ON ha.hall_id = ch.id
        JOIN organization_members om ON om.id = ha.org_member_id
        WHERE om.admin_id = $1 AND ch.is_active = TRUE
        ORDER BY ch.created_at ASC
      `;
      queryParams = [adminId];
    }

    const { rows } = await db.query(queryStr, queryParams);
    res.status(200).json({ halls: rows });
  } catch (err) {
    logger.error('getMyHalls error:', { message: err.message });
    res.status(500).json({ message: 'Failed to fetch halls' });
  }
};

// POST /api/halls
// Creates a new hall for the authenticated admin.
export const createHall = async (req, res) => {
  const { name, location, district, state, latitude, longitude, phone, description } = req.body;

  if (!name || !location || !district || !state) {
    return res.status(400).json({ message: 'name, location, district, and state are required' });
  }

  try {
    let orgId = req.admin.orgId;
    if (!orgId) {
      const memberRes = await db.query(
        `SELECT org_id FROM organization_members WHERE admin_id = $1 AND status = 'active' LIMIT 1`,
        [req.admin.id]
      );
      if (memberRes.rows.length > 0) {
        orgId = memberRes.rows[0].org_id;
      }
    }
    if (!orgId) {
      return res.status(400).json({ message: 'User does not belong to any organization' });
    }

    const { rows } = await db.query(
      `INSERT INTO cinema_hall
         (admin_id, org_id, name, location, district, state, latitude, longitude, phone, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, location, district, state, latitude, longitude,
                 phone, description, is_active, created_at, org_id`,
      [
        req.admin.id,
        orgId,
        name.trim(),
        location.trim(),
        district.trim(),
        state.trim(),
        latitude ?? null,
        longitude ?? null,
        phone?.trim() ?? null,
        description?.trim() ?? null,
      ]
    );
    res.status(201).json({ hall: rows[0] });
  } catch (err) {
    logger.error('createHall error:', { message: err.message });
    res.status(500).json({ message: 'Failed to create hall' });
  }
};

// PUT /api/halls/:id
// Updates a hall. Admin must own the hall.
export const updateHall = async (req, res) => {
  const { id } = req.params;
  const { name, location, district, state, latitude, longitude, phone, description, is_active } = req.body;

  try {
    // Fetch hall info
    const hallCheck = await db.query(
      `SELECT org_id, admin_id FROM cinema_hall WHERE id = $1`,
      [id]
    );
    if (hallCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }
    const hall = hallCheck.rows[0];

    const isSuperAdmin = req.admin.role === 'superAdmin';
    let hasAccess = isSuperAdmin;

    if (!hasAccess) {
      const memberRes = await db.query(
        `SELECT om.org_id, r.key AS role_key
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.admin_id = $1 AND om.status = 'active'
         LIMIT 1`,
        [req.admin.id]
      );
      
      if (memberRes.rows.length > 0) {
        const { org_id, role_key } = memberRes.rows[0];
        if (hall.org_id === org_id) {
          if (role_key === 'owner' || role_key === 'admin' || hall.admin_id === req.admin.id) {
            hasAccess = true;
          }
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }

    const { rows } = await db.query(
      `UPDATE cinema_hall
       SET name        = COALESCE($1, name),
           location    = COALESCE($2, location),
           district    = COALESCE($3, district),
           state       = COALESCE($4, state),
           latitude    = COALESCE($5, latitude),
           longitude   = COALESCE($6, longitude),
           phone       = COALESCE($7, phone),
           description = COALESCE($8, description),
           is_active   = COALESCE($9, is_active)
       WHERE id = $10
       RETURNING id, name, location, district, state, latitude, longitude,
                 phone, description, is_active, created_at, org_id`,
      [
        name?.trim() ?? null,
        location?.trim() ?? null,
        district?.trim() ?? null,
        state?.trim() ?? null,
        latitude ?? null,
        longitude ?? null,
        phone?.trim() ?? null,
        description?.trim() ?? null,
        is_active ?? null,
        id,
      ]
    );

    res.status(200).json({ hall: rows[0] });
  } catch (err) {
    logger.error('updateHall error:', { message: err.message });
    res.status(500).json({ message: 'Failed to update hall' });
  }
};

// DELETE /api/halls/:id
// Deletes a hall (cascades to screens → shows → bookings via FK constraints).
// Admin must own the hall.
export const deleteHall = async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch hall info
    const hallCheck = await db.query(
      `SELECT org_id, admin_id FROM cinema_hall WHERE id = $1`,
      [id]
    );
    if (hallCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }
    const hall = hallCheck.rows[0];

    const isSuperAdmin = req.admin.role === 'superAdmin';
    let hasAccess = isSuperAdmin;

    if (!hasAccess) {
      const memberRes = await db.query(
        `SELECT om.org_id, r.key AS role_key
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.admin_id = $1 AND om.status = 'active'
         LIMIT 1`,
        [req.admin.id]
      );
      
      if (memberRes.rows.length > 0) {
        const { org_id, role_key } = memberRes.rows[0];
        if (hall.org_id === org_id) {
          if (role_key === 'owner' || role_key === 'admin' || hall.admin_id === req.admin.id) {
            hasAccess = true;
          }
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }

    await db.query(
      `DELETE FROM cinema_hall WHERE id = $1`,
      [id]
    );

    res.status(200).json({ message: 'Hall deleted successfully' });
  } catch (err) {
    logger.error('deleteHall error:', { message: err.message });
    res.status(500).json({ message: 'Failed to delete hall' });
  }
};
