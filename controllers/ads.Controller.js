import pool from '../db.js';
import jwt from 'jsonwebtoken';

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
    console.error('getAllAds error:', err.message);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
};

// POST /api/ads/create — Admin: create a new ad
export const createAd = async (req, res) => {
  const { title, image_url, click_url, placement, start_date, end_date, is_active } = req.body;

  if (!title || !image_url || !placement || !start_date || !end_date) {
    return res.status(400).json({ error: 'title, image_url, placement, start_date, end_date are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ads (title, image_url, click_url, placement, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, image_url, click_url || null, placement, start_date, end_date, is_active ?? true]
    );
    res.status(201).json({ ad: rows[0] });
  } catch (err) {
    console.error('createAd error:', err.message);
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
    console.error('updateAd error:', err.message);
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
    console.error('deleteAd error:', err.message);
    res.status(500).json({ error: 'Failed to delete ad' });
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
    console.error('getAdClicks error:', err.message);
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
    console.error('getActiveAds error:', err.message);
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
    console.error('recordClick error:', err.message);
    res.status(500).json({ error: 'Failed to record click' });
  }
};
