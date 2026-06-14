import db from "../db.js";
import logger from '../utils/logger.js';

/**
 * GET /api/dashboard/stats
 * Returns all data needed for the admin dashboard in a single call.
 * Auth: verifyCinemaAdminAccessToken + verifyCinemaHall
 */
export const getDashboardStats = async (req, res) => {
    const cinema_hall_id = req.currentHallId;

    const client = await db.connect();

    try {
        const [
            todayResult,
            allTimeResult,
            customersResult,
            offersResult,
            screensResult,
            trendResult,
            recentBookingsResult,
            todayShowsResult,
        ] = await Promise.all([
            // a) Today's stats
            client.query(`
                SELECT
                    COUNT(*) AS today_bookings,
                    COALESCE(SUM(b.total_amount), 0)    AS today_revenue,
                    COALESCE(SUM(b.convenience_fee), 0) AS today_convenience_fee,
                    COALESCE(SUM(b.gst_amount), 0)      AS today_gst
                FROM bookings b
                JOIN shows sh ON sh.id = b.show_id
                JOIN screens sc ON sc.id = sh.screen_id
                WHERE sc.cinema_hall_id = $1
                  AND sh.show_date = CURRENT_DATE
            `, [cinema_hall_id]),

            // b) All-time totals
            client.query(`
                SELECT
                    COUNT(*) AS total_bookings,
                    COALESCE(SUM(b.total_amount), 0) AS total_revenue
                FROM bookings b
                JOIN shows sh ON sh.id = b.show_id
                JOIN screens sc ON sc.id = sh.screen_id
                WHERE sc.cinema_hall_id = $1
            `, [cinema_hall_id]),

            // c) Total customers
            client.query(`SELECT COUNT(*) AS total_customers FROM customers`),

            // d) Active offers (hall-specific + global)
            client.query(`
                SELECT COUNT(*) AS active_offers
                FROM offers
                WHERE (cinema_hall_id = $1 OR scope = 'global')
                  AND is_active = true
                  AND valid_until >= NOW()
            `, [cinema_hall_id]),

            // e) Screens count
            client.query(`
                SELECT COUNT(*) AS total_screens FROM screens WHERE cinema_hall_id = $1
            `, [cinema_hall_id]),

            // f) Last 7 days revenue trend
            client.query(`
                SELECT
                    gs.date::date AS date,
                    COALESCE(SUM(b.total_amount), 0) AS revenue,
                    COUNT(b.id) AS bookings_count
                FROM generate_series(
                    CURRENT_DATE - INTERVAL '6 days',
                    CURRENT_DATE,
                    INTERVAL '1 day'
                ) AS gs(date)
                LEFT JOIN shows sh ON sh.show_date = gs.date
                    AND sh.screen_id IN (SELECT id FROM screens WHERE cinema_hall_id = $1)
                LEFT JOIN bookings b ON b.show_id = sh.id
                GROUP BY gs.date
                ORDER BY gs.date
            `, [cinema_hall_id]),

            // g) Recent 5 bookings
            client.query(`
                SELECT
                    b.id,
                    b.total_amount,
                    b.booking_status,
                    b.created_at,
                    m.title AS movie_title,
                    c.name  AS customer_name,
                    ARRAY(
                        SELECT (s->>'row') || (s->>'column')
                        FROM jsonb_array_elements(sc.layout->'seats') s
                        WHERE to_jsonb(b.seats) ? (s->>'id')
                    ) AS seat_labels
                FROM bookings b
                JOIN shows sh ON sh.id = b.show_id
                JOIN movies m ON m.id = sh.movie_id
                JOIN screens sc ON sc.id = sh.screen_id
                JOIN customers c ON c.id = b.customer_id
                WHERE sc.cinema_hall_id = $1
                ORDER BY b.created_at DESC
                LIMIT 5
            `, [cinema_hall_id]),

            // h) Today's shows with seat occupancy
            client.query(`
                SELECT
                    sh.id,
                    sh.start_time,
                    sh.status,
                    m.title AS movie_title,
                    sc.name AS screen_name,
                    (
                        SELECT COUNT(*)
                        FROM jsonb_array_elements(sc.layout->'seats') s
                        WHERE (s->>'isBlocked')::boolean IS NOT TRUE
                    ) AS total_seats,
                    (
                        SELECT COUNT(*)
                        FROM show_booked_seats sbs
                        WHERE sbs.show_id = sh.id AND sbs.status = 'BOOKED'
                    ) AS booked_seats
                FROM shows sh
                JOIN movies m ON m.id = sh.movie_id
                JOIN screens sc ON sc.id = sh.screen_id
                WHERE sc.cinema_hall_id = $1
                  AND sh.show_date = CURRENT_DATE
                ORDER BY sh.start_time
            `, [cinema_hall_id]),
        ]);

        const today = todayResult.rows[0];
        const allTime = allTimeResult.rows[0];

        return res.status(200).json({
            today: {
                bookings: parseInt(today.today_bookings),
                revenue: parseFloat(today.today_revenue),
                convenience_fee: parseFloat(today.today_convenience_fee),
                gst: parseFloat(today.today_gst),
            },
            allTime: {
                bookings: parseInt(allTime.total_bookings),
                revenue: parseFloat(allTime.total_revenue),
            },
            customers: parseInt(customersResult.rows[0].total_customers),
            activeOffers: parseInt(offersResult.rows[0].active_offers),
            screens: parseInt(screensResult.rows[0].total_screens),
            revenueTrend: trendResult.rows.map(r => ({
                date: r.date,
                revenue: parseFloat(r.revenue),
                bookings_count: parseInt(r.bookings_count),
            })),
            recentBookings: recentBookingsResult.rows,
            todayShows: todayShowsResult.rows.map(r => ({
                ...r,
                total_seats: parseInt(r.total_seats),
                booked_seats: parseInt(r.booked_seats),
            })),
        });
    } catch (error) {
        logger.error("❌ Dashboard stats error:", { error });
        return res.status(500).json({ error: "Failed to fetch dashboard stats" });
    } finally {
        client.release();
    }
};
