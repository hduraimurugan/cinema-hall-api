// Event -> {title, body} builders shared by the in-app feed and (later)
// email/push channel senders. `data` is whatever the trigger site passed to
// notify() — see each case for the fields it expects.

export function buildNotificationContent(event, data = {}) {
    switch (event) {
        case 'booking_confirmed':
            return {
                title: 'Booking confirmed',
                body: `Your booking for ${data.movieTitle || 'your movie'} on ${data.showDate || ''} is confirmed. Seats: ${(data.seats || []).join(', ')}.`,
            };
        case 'booking_cancelled':
            return {
                title: 'Booking cancelled',
                body: `Your booking for ${data.movieTitle || 'your movie'} has been cancelled.`,
            };
        case 'refund_initiated':
            return {
                title: 'Refund initiated',
                body: `A refund of ₹${data.amount ?? ''} for ${data.movieTitle || 'your booking'} has been initiated.`,
            };
        case 'refund_settled':
            return {
                title: 'Refund settled',
                body: `Your refund of ₹${data.amount ?? ''} for ${data.movieTitle || 'your booking'} has been settled.`,
            };
        case 'show_cancelled':
            return {
                title: 'Show cancelled',
                body: `The show ${data.movieTitle || ''} on ${data.showDate || ''} has been cancelled. A refund has been initiated.`,
            };
        case 'show_reminder':
            return {
                title: 'Your show starts soon',
                body: `${data.movieTitle || 'Your movie'} starts at ${data.startTime || 'soon'}. Seats: ${(data.seats || []).join(', ')}.`,
            };
        case 'daily_report':
            return {
                title: 'Daily report',
                body: `Your daily report for ${data.reportDate || ''} is ready.`,
            };
        case 'security_alert':
            return {
                title: 'Security alert',
                body: data.message || 'A security event was detected on your account.',
            };
        case 'refund_failed':
            return {
                title: 'Refund failed',
                body: `A refund of ₹${data.amount ?? ''} for ${data.movieTitle || 'a booking'} failed to process${data.reason ? `: ${data.reason}` : '.'}`,
            };
        case 'team_role_changed':
            return {
                title: 'Your team role was updated',
                body: data.roleLabel
                    ? `Your role has been changed to ${data.roleLabel}.`
                    : `Your membership status has been updated to ${data.status || 'updated'}.`,
            };
        case 'team_removed':
            return {
                title: 'Removed from organization',
                body: 'You have been removed from the organization. Contact your administrator if this is unexpected.',
            };
        case 'team_invite_accepted':
            return {
                title: 'Invite accepted',
                body: `${data.newAdminName || 'A new team member'} has accepted your invite and joined the organization.`,
            };
        case 'admin_broadcast':
            // Title/body are composed by the super admin, not templated — see
            // controllers/broadcast.Controller.js.
            return {
                title: data.title || 'Notification',
                body: data.body || '',
            };
        default:
            return { title: event, body: '' };
    }
}
