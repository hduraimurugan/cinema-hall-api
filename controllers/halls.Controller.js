import db from '../db.js';
import logger from '../utils/logger.js';

// GET /api/halls
// Returns all halls owned by the authenticated admin.
export const getMyHalls = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, location, district, state, latitude, longitude,
              phone, description, is_active, created_at
       FROM cinema_hall
       WHERE admin_id = $1 AND is_active = TRUE
       UNION
       SELECT ch.id, ch.name, ch.location, ch.district, ch.state, ch.latitude, ch.longitude,
              ch.phone, ch.description, ch.is_active, ch.created_at
       FROM cinema_hall ch
       JOIN hall_assignments ha ON ha.hall_id = ch.id
       JOIN organization_members om ON om.id = ha.org_member_id
       WHERE om.admin_id = $1 AND ch.is_active = TRUE
       ORDER BY created_at ASC`,
      [req.admin.id]
    );
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
    const { rows } = await db.query(
      `INSERT INTO cinema_hall
         (admin_id, name, location, district, state, latitude, longitude, phone, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, location, district, state, latitude, longitude,
                 phone, description, is_active, created_at`,
      [
        req.admin.id,
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
    // Verify ownership first
    const ownership = await db.query(
      `SELECT id FROM cinema_hall WHERE id = $1 AND admin_id = $2`,
      [id, req.admin.id]
    );
    if (ownership.rows.length === 0) {
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
       WHERE id = $10 AND admin_id = $11
       RETURNING id, name, location, district, state, latitude, longitude,
                 phone, description, is_active, created_at`,
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
        req.admin.id,
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
    const { rowCount } = await db.query(
      `DELETE FROM cinema_hall WHERE id = $1 AND admin_id = $2`,
      [id, req.admin.id]
    );

    if (rowCount === 0) {
      return res.status(403).json({ message: 'Hall not found or access denied' });
    }

    res.status(200).json({ message: 'Hall deleted successfully' });
  } catch (err) {
    logger.error('deleteHall error:', { message: err.message });
    res.status(500).json({ message: 'Failed to delete hall' });
  }
};
