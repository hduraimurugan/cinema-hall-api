// Mirrors USER_DEFAULTS.notifications in
// cinema-hall-admin/src/lib/settings/settingsDefaults.js — used to default a
// recipient's per-event channel preferences when no user_settings/
// customer_settings row exists yet for the 'notifications' section.
export const DEFAULT_EVENT_PREFERENCES = {
    booking_confirmed: { email: true, sms: false, whatsapp: false, push: false },
    booking_cancelled: { email: true, sms: false, whatsapp: false, push: false },
    refund_initiated: { email: true, sms: false, whatsapp: false, push: false },
    refund_settled: { email: true, sms: false, whatsapp: false, push: false },
    show_cancelled: { email: true, sms: false, whatsapp: false, push: false },
    show_reminder: { email: true, sms: false, whatsapp: false, push: true },
    daily_report: { email: false, sms: false, whatsapp: false, push: false },
    security_alert: { email: true, sms: true, whatsapp: false, push: true },
    refund_failed: { email: true, sms: false, whatsapp: false, push: true },
    team_role_changed: { email: false, sms: false, whatsapp: false, push: true },
    team_removed: { email: true, sms: false, whatsapp: false, push: true },
    team_invite_accepted: { email: false, sms: false, whatsapp: false, push: true },
    admin_broadcast: { email: false, sms: false, whatsapp: false, push: true },
};
