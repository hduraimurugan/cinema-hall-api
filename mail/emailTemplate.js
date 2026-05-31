// ─── Admin Auth Email Templates ───────────────────────────────────────────────
// Cinema-branded dark theme (slate-950 background, rose/pink primary).
// These are used by the admin authentication system.

// ── Admin: Verify Email ────────────────────────────────────────────────────────
export const ADMIN_VERIFY_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Admin Email</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f14;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f14;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding:0 0 32px 0;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);border-radius:12px;padding:10px 14px;vertical-align:middle;">
                    <span style="font-size:20px;">🎬</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">CineMax Admin</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:#16161e;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:40px 40px 32px;">
              <!-- Title -->
              <p style="color:#f43f5e;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px;">Email Verification</p>
              <h1 style="color:#ffffff;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">Verify your email address</h1>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px;">
                Hi <strong style="color:#e2e8f0;">{name}</strong>, welcome to CineMax Admin! Click the button below to verify your email and activate your account.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#f43f5e,#e11d48);border-radius:8px;padding:0;">
                    <a href="{verificationLink}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <!-- Info box -->
              <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(244,63,94,0.06);border:1px solid rgba(244,63,94,0.15);border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5;">⏱ This link expires in <strong style="color:#f43f5e;">24 hours</strong>. If it expires, you can request a new verification email from the login page.</p>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:13px;margin:0 0 8px;">Or copy this URL into your browser:</p>
              <p style="color:#475569;font-size:12px;word-break:break-all;margin:0 0 24px;background:#0f0f14;padding:10px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);">{verificationLink}</p>
              <p style="color:#64748b;font-size:13px;margin:0;">If you didn't create a CineMax Admin account, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="color:#334155;font-size:12px;margin:0;">© 2026 CineMax Admin · This is an automated message, please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

// ── Admin: Password Reset ──────────────────────────────────────────────────────
export const ADMIN_PASSWORD_RESET_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f14;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f14;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:0 0 32px 0;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);border-radius:12px;padding:10px 14px;vertical-align:middle;">
                    <span style="font-size:20px;">🎬</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">CineMax Admin</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#16161e;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:40px 40px 32px;">
              <p style="color:#f43f5e;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px;">Password Reset</p>
              <h1 style="color:#ffffff;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">Reset your password</h1>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px;">
                Hi <strong style="color:#e2e8f0;">{name}</strong>, we received a request to reset the password for your CineMax Admin account. Click the button below to choose a new password.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#f43f5e,#e11d48);border-radius:8px;padding:0;">
                    <a href="{resetLink}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5;">⏱ This link expires in <strong style="color:#fbbf24;">15 minutes</strong>. It can only be used once.</p>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:13px;margin:0 0 8px;">Or copy this URL into your browser:</p>
              <p style="color:#475569;font-size:12px;word-break:break-all;margin:0 0 24px;background:#0f0f14;padding:10px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);">{resetLink}</p>
              <p style="color:#64748b;font-size:13px;margin:0;">If you didn't request a password reset, please ignore this email. Your password will not change.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="color:#334155;font-size:12px;margin:0;">© 2026 CineMax Admin · This is an automated message, please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

// ── Admin: Password Changed Notification ──────────────────────────────────────
export const ADMIN_PASSWORD_CHANGED_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Changed</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f14;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f14;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:0 0 32px 0;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);border-radius:12px;padding:10px 14px;vertical-align:middle;">
                    <span style="font-size:20px;">🎬</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">CineMax Admin</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#16161e;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:40px 40px 32px;">
              <div style="width:48px;height:48px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);border-radius:50%;text-align:center;line-height:48px;font-size:22px;margin:0 0 20px;">✓</div>
              <p style="color:#22c55e;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px;">Security Notice</p>
              <h1 style="color:#ffffff;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">Your password was changed</h1>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Hi <strong style="color:#e2e8f0;">{name}</strong>, your CineMax Admin password was successfully changed on <strong style="color:#e2e8f0;">{changedAt}</strong>.
              </p>
              <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5;">If you did not make this change, your account may be compromised. <strong style="color:#ef4444;">Please reset your password immediately</strong> and contact support.</p>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:13px;margin:0;">All other active sessions were signed out as a security precaution.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="color:#334155;font-size:12px;margin:0;">© 2026 CineMax Admin · This is an automated message, please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

// ── Admin: Account Locked Notification ────────────────────────────────────────
export const ADMIN_ACCOUNT_LOCKED_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Locked</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f14;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f14;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:0 0 32px 0;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="display:inline-table;">
                <tr>
                  <td style="background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);border-radius:12px;padding:10px 14px;vertical-align:middle;">
                    <span style="font-size:20px;">🎬</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">CineMax Admin</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#16161e;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:40px 40px 32px;">
              <div style="width:48px;height:48px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:50%;text-align:center;line-height:48px;font-size:22px;margin:0 0 20px;">🔒</div>
              <p style="color:#ef4444;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px;">Security Alert</p>
              <h1 style="color:#ffffff;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">Your account has been locked</h1>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Hi <strong style="color:#e2e8f0;">{name}</strong>, your CineMax Admin account has been temporarily locked due to multiple failed login attempts.
              </p>
              <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:8px;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="color:#94a3b8;font-size:13px;margin:0 0 6px;line-height:1.5;"><strong style="color:#fca5a5;">Locked until:</strong> {lockedUntil}</p>
                    <p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5;">Your account will automatically unlock after this time. You can also reset your password now to regain immediate access.</p>
                  </td>
                </tr>
              </table>
              <p style="color:#64748b;font-size:13px;margin:0;">If this wasn't you, your account may be under attack. Please reset your password immediately.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="color:#334155;font-size:12px;margin:0;">© 2026 CineMax Admin · This is an automated message, please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

// ─── Legacy Customer Templates (kept for customer OTP / existing flows) ────────

export const VERIFICATION_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(to right, #4CAF50, #45a049); padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">Verify Your Email</h1>
  </div>
  <div style="background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p>Hello,</p>
    <p>Thank you for signing up! Your verification code is:</p>
    <div style="text-align: center; margin: 30px 0;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4CAF50;">{verificationCode}</span>
    </div>
    <p>Enter this code on the verification page to complete your registration.</p>
    <p>This code will expire in 15 minutes for security reasons.</p>
    <p>If you didn't create an account with us, please ignore this email.</p>
    <p>Best regards,<br>Your App Team</p>
  </div>
  <div style="text-align: center; margin-top: 20px; color: #888; font-size: 0.8em;">
    <p>This is an automated message, please do not reply to this email.</p>
  </div>
</body>
</html>
`;

export const WELCOME_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(to right, #4CAF50, #45a049); padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">Welcome On Board</h1>
  </div>
  <div style="background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p>Hello {name},</p>
    <p>Thank you for signing up! Your Verification is done.</p>
    
    <p>If you didn't create an account with us, please ignore this email.</p>
    <p>Best regards,<br>Your App Team</p>
  </div>
  <div style="text-align: center; margin-top: 20px; color: #888; font-size: 0.8em;">
    <p>This is an automated message, please do not reply to this email.</p>
  </div>
</body>
</html>
`;

export const PASSWORD_RESET_REQUEST_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(to right, #4CAF50, #45a049); padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">Password Reset</h1>
  </div>
  <div style="background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p>Hello,</p>
    <p>We received a request to reset your password. If you didn't make this request, please ignore this email.</p>
    <p>To reset your password, click the button below:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="{resetURL}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
    </div>
    <p>This link will expire in 1 hour for security reasons.</p>
    <p>Best regards,<br>Your App Team</p>
  </div>
  <div style="text-align: center; margin-top: 20px; color: #888; font-size: 0.8em;">
    <p>This is an automated message, please do not reply to this email.</p>
  </div>
</body>
</html>
`;

export const PASSWORD_RESET_SUCCESS_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Successful</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(to right, #4CAF50, #45a049); padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">Password Reset Successful</h1>
  </div>
  <div style="background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p>Hello,</p>
    <p>We're writing to confirm that your password has been successfully reset.</p>
    <div style="text-align: center; margin: 30px 0;">
      <div style="background-color: #4CAF50; color: white; width: 50px; height: 50px; line-height: 50px; border-radius: 50%; display: inline-block; font-size: 30px;">
        ✓
      </div>
    </div>
    <p>If you did not initiate this password reset, please contact our support team immediately.</p>
    <p>For security reasons, we recommend that you:</p>
    <ul>
      <li>Use a strong, unique password</li>
      <li>Enable two-factor authentication if available</li>
      <li>Avoid using the same password across multiple sites</li>
    </ul>
    <p>Thank you for helping us keep your account secure.</p>
    <p>Best regards,<br>Your App Team</p>
  </div>
  <div style="text-align: center; margin-top: 20px; color: #888; font-size: 0.8em;">
    <p>This is an automated message, please do not reply to this email.</p>
  </div>
</body>
</html>
`;

