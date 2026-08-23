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
        default:
            return { title: event, body: '' };
    }
}
