import {
    sendBookingConfirmationEmail,
    sendRefundInitiatedEmail,
    sendRefundSettledEmail,
    sendShowCancelledEmail,
    sendShowReminderEmail,
    sendBroadcastEmail,
} from '../../../mail/emails.js';

// event -> function(recipient, notification) that actually sends the email.
const EMAIL_SENDERS = {
    booking_confirmed: async (recipient, notification) => {
        await sendBookingConfirmationEmail(recipient.email, {
            name: recipient.name,
            movieTitle: notification.data.movieTitle,
            cinemaHallName: notification.data.cinemaHallName,
            showDate: notification.data.showDate,
            startTime: notification.data.startTime,
            seats: notification.data.seats,
            amount: notification.data.amount,
        });
    },
    refund_initiated: async (recipient, notification) => {
        await sendRefundInitiatedEmail(recipient.email, {
            name: recipient.name,
            movieTitle: notification.data.movieTitle,
            amount: notification.data.amount,
        });
    },
    refund_settled: async (recipient, notification) => {
        await sendRefundSettledEmail(recipient.email, {
            name: recipient.name,
            movieTitle: notification.data.movieTitle,
            amount: notification.data.amount,
        });
    },
    show_cancelled: async (recipient, notification) => {
        await sendShowCancelledEmail(recipient.email, {
            name: recipient.name,
            movieTitle: notification.data.movieTitle,
            showDate: notification.data.showDate,
            cinemaHallName: notification.data.cinemaHallName,
            amount: notification.data.amount,
        });
    },
    show_reminder: async (recipient, notification) => {
        await sendShowReminderEmail(recipient.email, {
            name: recipient.name,
            movieTitle: notification.data.movieTitle,
            startTime: notification.data.startTime,
            seats: notification.data.seats,
        });
    },
    // Powers Super Admin broadcasts and Offer/Ad announcements — title/body
    // are admin-authored (or defaulted by announceOffer/announceAd), not
    // templated from a fixed set of fields like the events above.
    admin_broadcast: async (recipient, notification) => {
        await sendBroadcastEmail(recipient.email, {
            name: recipient.name,
            title: notification.data.title || notification.title,
            message: notification.data.body || notification.body,
            imageUrl: notification.data.imageUrl,
            ctaUrl: notification.data.ctaUrl,
            ctaLabel: notification.data.ctaLabel,
        });
    },
};

/** @returns {string} the email address the notification was sent to (for the dispatch log's `target`) */
export async function sendEmailForNotification(recipient, notification) {
    const sender = EMAIL_SENDERS[notification.event];
    if (!sender) {
        throw new Error(`No email sender wired for event "${notification.event}"`);
    }
    await sender(recipient, notification);
    return recipient.email;
}
