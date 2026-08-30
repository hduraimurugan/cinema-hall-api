import {
  PASSWORD_RESET_REQUEST_TEMPLATE,
  PASSWORD_RESET_SUCCESS_TEMPLATE,
  VERIFICATION_EMAIL_TEMPLATE,
  WELCOME_EMAIL_TEMPLATE,
  ADMIN_VERIFY_EMAIL_TEMPLATE,
  ADMIN_PASSWORD_RESET_TEMPLATE,
  ADMIN_PASSWORD_CHANGED_TEMPLATE,
  ADMIN_ACCOUNT_LOCKED_TEMPLATE,
  CUSTOMER_OTP_TEMPLATE,
  CUSTOMER_ACCOUNT_LOCKED_TEMPLATE,
  CUSTOMER_PASSWORD_CHANGED_TEMPLATE,
  BOOKING_CONFIRMATION_TEMPLATE,
  REFUND_INITIATED_TEMPLATE,
  REFUND_SETTLED_TEMPLATE,
  SHOW_CANCELLED_TEMPLATE,
  SHOW_REMINDER_TEMPLATE,
  BROADCAST_TEMPLATE,
} from "./emailTemplate.js"
import { transporter } from "./mail.config.js"
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

// ─── Admin Auth Emails ─────────────────────────────────────────────────────────

export const sendAdminVerificationEmail = async (email, name, verificationLink) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Verify your CineMax Admin email',
      html: ADMIN_VERIFY_EMAIL_TEMPLATE
        .replace(/{name}/g, name)
        .replace(/{verificationLink}/g, verificationLink),
      category: 'Admin Email Verification',
    })
    logger.info('Admin verification email sent', { email })
  } catch (error) {
    logger.error('Error sending admin verification email:', { message: error.message })
    throw new Error('Error sending admin verification email')
  }
}

export const sendAdminPasswordResetEmail = async (email, name, resetLink) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Reset your CineMax Admin password',
      html: ADMIN_PASSWORD_RESET_TEMPLATE
        .replace(/{name}/g, name)
        .replace(/{resetLink}/g, resetLink),
      category: 'Admin Password Reset',
    })
    logger.info('Admin password reset email sent', { email })
  } catch (error) {
    logger.error('Error sending admin password reset email:', { message: error.message })
    throw new Error('Error sending admin password reset email')
  }
}

export const sendAdminPasswordChangedEmail = async (email, name) => {
  const changedAt = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  })
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Your CineMax Admin password was changed',
      html: ADMIN_PASSWORD_CHANGED_TEMPLATE
        .replace(/{name}/g, name)
        .replace(/{changedAt}/g, changedAt),
      category: 'Admin Password Changed',
    })
    logger.info('Admin password changed notification sent', { email })
  } catch (error) {
    logger.error('Error sending admin password changed email:', { message: error.message })
    // Non-fatal: don't throw — password was already changed
  }
}

export const sendAdminAccountLockedEmail = async (email, name, lockedUntil) => {
  const lockedUntilStr = new Date(lockedUntil).toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  })
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Your CineMax Admin account has been locked',
      html: ADMIN_ACCOUNT_LOCKED_TEMPLATE
        .replace(/{name}/g, name)
        .replace(/{lockedUntil}/g, lockedUntilStr),
      category: 'Admin Account Locked',
    })
    logger.info('Admin account locked notification sent', { email })
  } catch (error) {
    logger.error('Error sending admin account locked email:', { message: error.message })
    // Non-fatal
  }
}

// ─── Legacy Customer Emails ────────────────────────────────────────────────────

export const sendVerificationEmail = async (email, verificationToken) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Verify your email",
            html: VERIFICATION_EMAIL_TEMPLATE.replace("{verificationCode}", verificationToken),
            category: "Email Verification"
        })
        logger.info('Email sent successfully');

    } catch (error) {
        logger.error(`Error sending verification email: ${error}`);
        throw new Error(`Error sending verification email: ${error}`)
    }
}

export const sendWelcomeEmail = async (email, name) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Email Verification Done",
            html: WELCOME_EMAIL_TEMPLATE.replace("{name}", name),
            category: "Email Verified"
        })

        logger.info('Welcome email sent succesfully');

    } catch (error) {
        logger.error(`Error sending welcome email: ${error}`);
        throw new Error(`Error sending verification email: ${error}`);
    }
}

export const sendPasswordResetEmail = async (email, resetURL) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Reset your Password",
            html: PASSWORD_RESET_REQUEST_TEMPLATE.replace("{resetURL}", resetURL),
            category: "Password Reset"
        })

        logger.info('Email sent for password reset successfully');

    } catch (error) {
        logger.error(`Error sending password reset email: ${error}`);
        throw new Error(`Error sending password reset email: ${error}`);
    }
}

export const sendResetSuccessEmail = async (email) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Password Reset Successful",
            html: PASSWORD_RESET_SUCCESS_TEMPLATE,
            category: "Password Reset Done"
        });

        logger.info('Password reset Successful');

    } catch (error) {
        logger.error(`Error sending password reset success email: ${error}`);
        throw new Error(`Error sending password reset success email: ${error}`);
    }
}

// ─── Customer Auth Emails ──────────────────────────────────────────────────────

/**
 * Send an OTP email to a customer.
 * @param {string} email
 * @param {string} name
 * @param {string} otp        - plain-text OTP to display (NOT the hash)
 * @param {'signup'|'password_reset'} type
 */
export const sendCustomerOtpEmail = async (email, name, otp, type = 'signup') => {
  const isReset = type === 'password_reset'
  const otpTitle    = isReset ? 'Password Reset OTP'   : 'Email Verification'
  const otpSubtitle = isReset ? 'Reset your password'  : 'Verify your email address'
  const subject     = isReset ? 'Your CineMax password reset OTP' : 'Verify your CineMax account'
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject,
      html: CUSTOMER_OTP_TEMPLATE
        .replace(/{name}/g,        name)
        .replace(/{otp}/g,         otp)
        .replace(/{otpTitle}/g,    otpTitle)
        .replace(/{otpSubtitle}/g, otpSubtitle),
      category: 'Customer OTP',
    })
    logger.info('Customer OTP email sent', { email, type })
  } catch (error) {
    logger.error('Error sending customer OTP email:', { message: error.message })
    throw new Error('Error sending customer OTP email')
  }
}

export const sendCustomerAccountLockedEmail = async (email, name, lockedUntil) => {
  const lockedUntilStr = new Date(lockedUntil).toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  })
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Your CineMax account has been locked',
      html: CUSTOMER_ACCOUNT_LOCKED_TEMPLATE
        .replace(/{name}/g,        name)
        .replace(/{lockedUntil}/g, lockedUntilStr),
      category: 'Customer Account Locked',
    })
    logger.info('Customer account locked notification sent', { email })
  } catch (error) {
    logger.error('Error sending customer account locked email:', { message: error.message })
    // Non-fatal
  }
}

// ─── Booking / Notification Emails ─────────────────────────────────────────

/**
 * @param {string} email
 * @param {object} data - { name, movieTitle, cinemaHallName, showDate, startTime, seats: string[], amount }
 */
export const sendBookingConfirmationEmail = async (email, data) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: `Booking confirmed: ${data.movieTitle}`,
      html: BOOKING_CONFIRMATION_TEMPLATE
        .replace(/{name}/g, data.name || 'there')
        .replace(/{movieTitle}/g, data.movieTitle || '')
        .replace(/{cinemaHallName}/g, data.cinemaHallName || '')
        .replace(/{showDate}/g, data.showDate || '')
        .replace(/{startTime}/g, data.startTime || '')
        .replace(/{seats}/g, (data.seats || []).join(', '))
        .replace(/{amount}/g, data.amount ?? ''),
      category: 'Booking Confirmation',
    })
    logger.info('Booking confirmation email sent', { email })
  } catch (error) {
    logger.error('Error sending booking confirmation email:', { message: error.message })
    throw new Error('Error sending booking confirmation email')
  }
}

/**
 * @param {string} email
 * @param {object} data - { name, movieTitle, amount }
 */
export const sendRefundInitiatedEmail = async (email, data) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: `Refund initiated: ${data.movieTitle}`,
      html: REFUND_INITIATED_TEMPLATE
        .replace(/{name}/g, data.name || 'there')
        .replace(/{movieTitle}/g, data.movieTitle || '')
        .replace(/{amount}/g, data.amount ?? ''),
      category: 'Refund Initiated',
    })
    logger.info('Refund initiated email sent', { email })
  } catch (error) {
    logger.error('Error sending refund initiated email:', { message: error.message })
    throw new Error('Error sending refund initiated email')
  }
}

/**
 * @param {string} email
 * @param {object} data - { name, movieTitle, amount }
 */
export const sendRefundSettledEmail = async (email, data) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: `Refund settled: ${data.movieTitle}`,
      html: REFUND_SETTLED_TEMPLATE
        .replace(/{name}/g, data.name || 'there')
        .replace(/{movieTitle}/g, data.movieTitle || '')
        .replace(/{amount}/g, data.amount ?? ''),
      category: 'Refund Settled',
    })
    logger.info('Refund settled email sent', { email })
  } catch (error) {
    logger.error('Error sending refund settled email:', { message: error.message })
    throw new Error('Error sending refund settled email')
  }
}

/**
 * @param {string} email
 * @param {object} data - { name, movieTitle, showDate, cinemaHallName, amount }
 */
export const sendShowCancelledEmail = async (email, data) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: `Show cancelled: ${data.movieTitle}`,
      html: SHOW_CANCELLED_TEMPLATE
        .replace(/{name}/g, data.name || 'there')
        .replace(/{movieTitle}/g, data.movieTitle || '')
        .replace(/{showDate}/g, data.showDate || '')
        .replace(/{cinemaHallName}/g, data.cinemaHallName || '')
        .replace(/{amount}/g, data.amount ?? ''),
      category: 'Show Cancelled',
    })
    logger.info('Show cancelled email sent', { email })
  } catch (error) {
    logger.error('Error sending show cancelled email:', { message: error.message })
    throw new Error('Error sending show cancelled email')
  }
}

/**
 * @param {string} email
 * @param {object} data - { name, movieTitle, startTime, seats: string[] }
 */
export const sendShowReminderEmail = async (email, data) => {
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: `Starting soon: ${data.movieTitle}`,
      html: SHOW_REMINDER_TEMPLATE
        .replace(/{name}/g, data.name || 'there')
        .replace(/{movieTitle}/g, data.movieTitle || '')
        .replace(/{startTime}/g, data.startTime || '')
        .replace(/{seats}/g, (data.seats || []).join(', ')),
      category: 'Show Reminder',
    })
    logger.info('Show reminder email sent', { email })
  } catch (error) {
    logger.error('Error sending show reminder email:', { message: error.message })
    throw new Error('Error sending show reminder email')
  }
}

/**
 * Sends a Super Admin broadcast / offer / ad announcement email. Unlike the
 * event-templated senders above, title/message here are admin-authored
 * (or defaulted by announceOffer/announceAd), so callers control the copy.
 * @param {string} email
 * @param {object} data - { name, title, message, imageUrl, ctaUrl, ctaLabel }
 */
export const sendBroadcastEmail = async (email, data) => {
  const imageBlock = data.imageUrl
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td><img src="${data.imageUrl}" alt="" style="width:100%;border-radius:8px;display:block;" /></td></tr></table>`
    : ''
  const ctaBlock = data.ctaUrl
    ? `<table cellpadding="0" cellspacing="0"><tr><td style="background:#f43f5e;border-radius:8px;"><a href="${data.ctaUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${data.ctaLabel || 'View details'}</a></td></tr></table>`
    : ''
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: data.title || 'CineMax announcement',
      html: BROADCAST_TEMPLATE
        .replace(/{name}/g, data.name || 'there')
        .replace(/{title}/g, data.title || 'Announcement')
        .replace(/{message}/g, data.message || '')
        .replace('{imageBlock}', imageBlock)
        .replace('{ctaBlock}', ctaBlock),
      category: 'Broadcast',
    })
    logger.info('Broadcast email sent', { email })
  } catch (error) {
    logger.error('Error sending broadcast email:', { message: error.message })
    throw new Error('Error sending broadcast email')
  }
}

export const sendCustomerPasswordChangedEmail = async (email, name) => {
  const changedAt = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  })
  try {
    await transporter.sendMail({
      from: process.env.MAIL_ID,
      to: email,
      subject: 'Your CineMax password was changed',
      html: CUSTOMER_PASSWORD_CHANGED_TEMPLATE
        .replace(/{name}/g,      name)
        .replace(/{changedAt}/g, changedAt),
      category: 'Customer Password Changed',
    })
    logger.info('Customer password changed notification sent', { email })
  } catch (error) {
    logger.error('Error sending customer password changed email:', { message: error.message })
    // Non-fatal
  }
}