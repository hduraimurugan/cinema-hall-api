import pool from '../db.js';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { announceAd } from '../services/notification/announce.js';

// GET /api/ads — Admin: list all ads with total click count
export const getAllAds = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, COUNT(ac.id)::int AS click_count
      FROM ads a
      LEFT JOIN ad_clicks ac ON ac.ad_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);
    res.json({ ads: rows });
  } catch (err) {
    logger.error('getAllAds error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
};

// POST /api/ads/create — Admin: create a new ad
export const createAd = async (req, res) => {
  const { title, image_url, click_url, placement, start_date, end_date, is_active, notify } = req.body;

  if (!title || !image_url || !placement || !start_date || !end_date) {
    return res.status(400).json({ error: 'title, image_url, placement, start_date, end_date are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ads (title, image_url, click_url, placement, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, image_url, click_url || null, placement, start_date, end_date, is_active ?? true]
    );

    let announced = false;
    if (notify?.enabled) {
      try {
        await announceAd(rows[0], {
          adminId: req.admin?.id,
          channels: notify.channels,
          title: notify.title,
          body: notify.body,
        });
        announced = true;
      } catch (notifyErr) {
        // Never fail ad creation over a dead FCM token or SMTP hiccup — the
        // ad already exists, only the announcement failed.
        logger.error('announceAd (on create) error:', { message: notifyErr.message });
      }
    }

    res.status(201).json({ ad: rows[0], announced });
  } catch (err) {
    logger.error('createAd error:', { message: err.message });
    res.status(500).json({ error: 'Failed to create ad' });
  }
};

// PUT /api/ads/update/:id — Admin: update an ad
export const updateAd = async (req, res) => {
  const { id } = req.params;
  const { title, image_url, click_url, placement, start_date, end_date, is_active } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE ads
       SET title=$1, image_url=$2, click_url=$3, placement=$4,
           start_date=$5, end_date=$6, is_active=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [title, image_url, click_url || null, placement, start_date, end_date, is_active, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Ad not found' });
    res.json({ ad: rows[0] });
  } catch (err) {
    logger.error('updateAd error:', { message: err.message });
    res.status(500).json({ error: 'Failed to update ad' });
  }
};

// DELETE /api/ads/delete/:id — Admin: delete an ad (cascades clicks)
export const deleteAd = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(`DELETE FROM ads WHERE id=$1`, [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Ad not found' });
    res.json({ message: 'Ad deleted' });
  } catch (err) {
    logger.error('deleteAd error:', { message: err.message });
    res.status(500).json({ error: 'Failed to delete ad' });
  }
};

// POST /api/ads/:id/announce — Admin: re-usable "Announce" action for an ad
// that already exists. Ads are already superAdmin-only end to end (routes.js),
// so no extra ownership check is needed here beyond the route guard.
export const announceAdById = async (req, res) => {
  const { id } = req.params;
  const { channels, title, body } = req.body || {};

  try {
    const { rows } = await pool.query(`SELECT * FROM ads WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Ad not found' });

    const { broadcast } = await announceAd(rows[0], {
      adminId: req.admin?.id,
      channels,
      title,
      body,
    });
    res.status(201).json({ broadcast });
  } catch (err) {
    logger.error('announceAdById error:', { message: err.message });
    res.status(500).json({ error: 'Failed to announce ad' });
  }
};

// GET /api/ads/:id/clicks — Admin: list click-throughs for an ad
export const getAdClicks = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT ac.id, ac.clicked_at,
             c.name  AS customer_name,
             c.email AS customer_email,
             c.phone AS customer_phone
      FROM ad_clicks ac
      LEFT JOIN customers c ON c.id = ac.customer_id
      WHERE ac.ad_id = $1
      ORDER BY ac.clicked_at DESC
    `, [id]);
    res.json({ clicks: rows });
  } catch (err) {
    logger.error('getAdClicks error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch clicks' });
  }
};

// GET /api/ads/active?placement=banner — Public: get currently active ads
export const getActiveAds = async (req, res) => {
  const { placement } = req.query;
  if (!placement) return res.status(400).json({ error: 'placement query param required' });

  try {
    const { rows } = await pool.query(`
      SELECT id, title, image_url, click_url, placement
      FROM ads
      WHERE is_active = true
        AND placement = $1
        AND start_date <= CURRENT_DATE
        AND end_date >= CURRENT_DATE
      ORDER BY created_at DESC
    `, [placement]);
    res.json({ ads: rows });
  } catch (err) {
    logger.error('getActiveAds error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch active ads' });
  }
};

// POST /api/ads/click/:id — Record a click (optional customer auth)
export const recordClick = async (req, res) => {
  const { id } = req.params;
  let customerId = null;

  // Attempt to identify the customer from cookie — continue anonymously if not present
  const token = req.cookies.cusAccessToken;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      customerId = decoded.id;
    } catch {
      // invalid token — anonymous click
    }
  }

  try {
    await pool.query(
      `INSERT INTO ad_clicks (ad_id, customer_id) VALUES ($1, $2)`,
      [id, customerId]
    );
    res.json({ recorded: true });
  } catch (err) {
    logger.error('recordClick error:', { message: err.message });
    res.status(500).json({ error: 'Failed to record click' });
  }
};
