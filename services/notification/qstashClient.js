import { Client, Receiver } from '@upstash/qstash';

// Local dev: npx @upstash/qstash-cli@latest dev prints QSTASH_URL/TOKEN/SIGNING_KEYS
// that go straight into .env — same Client/Receiver code path as production,
// just pointed at the local simulator instead of the real Upstash project.
export const qstashClient = new Client({
    token: process.env.QSTASH_TOKEN,
    baseUrl: process.env.QSTASH_URL || undefined,
});

export const qstashReceiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

const dispatchUrl = () => `${process.env.API_BASE_URL}/api/notifications/dispatch`;

/**
 * Enqueue one channel's dispatch of a notification. Carries only IDs — the
 * dispatch webhook re-fetches fresh state rather than trusting a payload
 * that might be stale by the time QStash delivers it.
 *
 * @param {object} params
 * @param {string} params.notificationId
 * @param {string} params.event
 * @param {'customer'|'admin'} params.recipientType
 * @param {string} params.recipientId
 * @param {'email'|'push'} params.channel
 * @param {number} [params.notBefore] — unix seconds; omit for immediate dispatch
 */
export async function publishDispatch({ notificationId, event, recipientType, recipientId, channel, notBefore }) {
    return qstashClient.publishJSON({
        url: dispatchUrl(),
        body: { notificationId, event, recipientType, recipientId, channel },
        ...(notBefore ? { notBefore } : {}),
        retries: 3,
    });
}

export async function cancelScheduledMessage(qstashMessageId) {
    if (!qstashMessageId) return;
    await qstashClient.messages.delete(qstashMessageId);
}
