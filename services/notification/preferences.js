import pool from '../../db.js';
import { DEFAULT_EVENT_PREFERENCES } from './defaultPreferences.js';

/**
 * Resolve which channels (beyond in-app, which always fires) are enabled for
 * this (recipient, event) pair. A channel fires only if BOTH are true:
 *   - the org-level master switch for that channel is enabled
 *   - the recipient's per-event preference for that channel is enabled
 *
 * Recipient-level preferences default to DEFAULT_EVENT_PREFERENCES[event]
 * when no user_settings/customer_settings row exists yet — the service does
 * its own defaulting since there's no frontend involved in the dispatch path.
 */
export async function resolveEnabledChannels(recipient, event) {
    const [orgChannels, recipientPrefs] = await Promise.all([
        getOrgChannelSwitches(recipient.orgId),
        getRecipientEventPreferences(recipient, event),
    ]);

    return ['email', 'push'].filter(
        (channel) => orgChannels[channel]?.enabled && recipientPrefs[channel]
    );
}

/**
 * Same shape as resolveEnabledChannels() but skips the org-level channel
 * switch — used for Super Admin broadcasts, which are platform-wide and
 * have no single org to check a switch against (recipients come straight
 * from the platform customers/admins lists, not one org's membership).
 * Still respects the recipient's own per-event preference.
 */
export async function resolveEnabledChannelsForBroadcast(recipient, event) {
    const recipientPrefs = await getRecipientEventPreferences(recipient, event);
    return ['email', 'push'].filter((channel) => recipientPrefs[channel]);
}

async function getOrgChannelSwitches(orgId) {
    if (!orgId) return {};
    const { rows } = await pool.query(
        `SELECT value FROM organization_settings WHERE org_id = $1 AND section = 'notifications'`,
        [orgId]
    );
    return rows[0]?.value || {};
}

async function getRecipientEventPreferences(recipient, event) {
    const defaults = DEFAULT_EVENT_PREFERENCES[event] || { email: false, sms: false, whatsapp: false, push: false };

    const table = recipient.type === 'customer' ? 'customer_settings' : 'user_settings';
    const idCol = recipient.type === 'customer' ? 'customer_id' : 'admin_id';

    const { rows } = await pool.query(
        `SELECT value FROM ${table} WHERE ${idCol} = $1 AND section = 'notifications'`,
        [recipient.id]
    );
    const stored = rows[0]?.value?.[event];
    return stored ? { ...defaults, ...stored } : defaults;
}
