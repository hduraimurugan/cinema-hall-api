// Bridges Offers/Ads to the broadcast pipeline — "Notify users" on create,
// and the standalone Announce action on the list pages, both funnel through
// here so offers.Controller.js / ads.Controller.js stay thin.
//
// Every announcement is recorded as an admin_broadcasts row with
// source: 'offer' | 'ad' and origin_id pointing back at the offer/ad, so the
// Notifications page's Auto tab and the entity's own audit trail both have
// something to show. Callers are expected to await this AFTER their own
// transaction commits and to swallow errors — a dead FCM token or SMTP
// hiccup must never fail creating an offer or ad, the same discipline
// notify() follows for event notifications.

import pool from '../../db.js';
import { resolveAudience, sendBroadcastNow, scheduleBroadcastFor } from './broadcast.js';

const DEFAULT_CHANNELS = ['push', 'email'];

function formatDiscount(offer) {
    return offer.discount_type === 'percentage'
        ? `${Number(offer.discount_value)}% off${offer.max_discount_amount ? ` (up to ₹${offer.max_discount_amount})` : ''}`
        : `₹${Number(offer.discount_value)} off`;
}

function defaultOfferCopy(offer) {
    const validUntil = offer.valid_until ? new Date(offer.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const minAmount = Number(offer.min_booking_amount) > 0 ? ` on bookings above ₹${offer.min_booking_amount}` : '';
    return {
        title: offer.title || `New offer: ${offer.code}`,
        body: `Use code ${offer.code} for ${formatDiscount(offer)}${minAmount}. Valid until ${validUntil}.`,
    };
}

function defaultAdCopy(ad) {
    return {
        title: ad.title,
        body: 'Check out what\'s new at CineMax.',
    };
}

/**
 * @param {object} offer - a row from the `offers` table
 * @param {object} opts
 * @param {string} opts.adminId
 * @param {string[]} [opts.channels] - subset of ['push','email']
 * @param {string} [opts.title]
 * @param {string} [opts.body]
 * @param {string} [opts.imageUrl]
 * @param {Date|string} [opts.scheduledFor]
 * @returns {Promise<{broadcast: object, sent?: number, failed?: number}>}
 */
export async function announceOffer(offer, opts = {}) {
    const { adminId, channels = DEFAULT_CHANNELS, title, body, imageUrl, scheduledFor } = opts;
    const fallback = defaultOfferCopy(offer);

    const isHallScoped = offer.scope === 'hall' && offer.cinema_hall_id;
    const audienceType = isHallScoped ? 'hall_customers' : 'all_customers';

    const recipients = await resolveAudience({
        audienceType,
        cinemaHallId: isHallScoped ? offer.cinema_hall_id : undefined,
    });

    return runAnnouncement({
        adminId,
        title: title || fallback.title,
        body: body || fallback.body,
        imageUrl: imageUrl || null,
        audienceType,
        cinemaHallId: isHallScoped ? offer.cinema_hall_id : null,
        channels,
        source: 'offer',
        originId: offer.id,
        recipients,
        scheduledFor,
    });
}

/**
 * @param {object} ad - a row from the `ads` table
 * @param {object} opts - same shape as announceOffer's opts
 */
export async function announceAd(ad, opts = {}) {
    const { adminId, channels = DEFAULT_CHANNELS, title, body, scheduledFor } = opts;
    const fallback = defaultAdCopy(ad);

    // Ads have no cinema_hall_id (they're platform-global — see ads.Controller.js).
    const recipients = await resolveAudience({ audienceType: 'all_customers' });

    return runAnnouncement({
        adminId,
        title: title || fallback.title,
        body: body || fallback.body,
        imageUrl: ad.image_url || null,
        audienceType: 'all_customers',
        cinemaHallId: null,
        channels,
        source: 'ad',
        originId: ad.id,
        recipients,
        scheduledFor,
        extraData: ad.click_url ? { ctaUrl: ad.click_url, ctaLabel: 'View details' } : {},
    });
}

async function runAnnouncement({ adminId, title, body, imageUrl, audienceType, cinemaHallId, channels, source, originId, recipients, scheduledFor, extraData = {} }) {
    let scheduledDate = null;
    if (scheduledFor) {
        scheduledDate = new Date(scheduledFor);
        if (Number.isNaN(scheduledDate.getTime())) scheduledDate = null;
    }
    const isFutureSend = scheduledDate && scheduledDate.getTime() > Date.now();

    const { rows } = await pool.query(
        `INSERT INTO admin_broadcasts
           (created_by, title, body, image_url, audience_type, target_count, scheduled_for, channels, source, origin_id, cinema_hall_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
            adminId || null,
            title,
            body || null,
            imageUrl || null,
            audienceType,
            recipients.length,
            isFutureSend ? scheduledDate : null,
            channels,
            source,
            originId,
            cinemaHallId,
        ]
    );
    const broadcast = rows[0];

    if (isFutureSend) {
        await scheduleBroadcastFor(broadcast, recipients, scheduledDate, extraData);
        return { broadcast: { ...broadcast, status: 'scheduled' } };
    }

    const { sent, failed } = await sendBroadcastNow(broadcast, recipients, extraData);
    return { broadcast: { ...broadcast, status: 'sent', sent_count: sent, failed_count: failed }, sent, failed };
}
