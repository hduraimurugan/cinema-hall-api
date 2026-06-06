import { OAuth2Client } from 'google-auth-library'
import logger from './logger.js'

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

/**
 * Verify a Google token and extract user info.
 * Supports both ID tokens (from credential/one-tap flow) and access tokens (from implicit flow).
 * @param {string} token - Google ID token or access token from the frontend
 * @returns {Promise<{ email: string, name: string, picture: string, googleId: string }>}
 */
export const verifyGoogleToken = async (token) => {
  // Try ID token verification first
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()

    if (!payload || !payload.email) {
      throw new Error('No email in payload')
    }

    return {
      email: payload.email.toLowerCase(),
      name: payload.name || '',
      picture: payload.picture || null,
      googleId: payload.sub,
      emailVerified: payload.email_verified || false,
    }
  } catch (idTokenError) {
    // If ID token verification fails, try as access token via userinfo endpoint
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to verify Google access token')
      }

      const payload = await response.json()

      if (!payload || !payload.email) {
        throw new Error('Google token verification failed: no email in payload')
      }

      return {
        email: payload.email.toLowerCase(),
        name: payload.name || '',
        picture: payload.picture || null,
        googleId: payload.sub,
        emailVerified: payload.email_verified || false,
      }
    } catch (accessTokenError) {
      logger.error('Google token verification failed for both ID token and access token:', {
        idTokenError: idTokenError.message,
        accessTokenError: accessTokenError.message,
      })
      throw new Error('Invalid Google token')
    }
  }
}

/**
 * Exchange a GitHub authorization code for an access token.
 * @param {string} code - The authorization code from GitHub OAuth redirect
 * @returns {Promise<string>} - GitHub access token
 */
export const exchangeGithubCode = async (code) => {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })

  const data = await response.json()

  if (data.error) {
    logger.error('GitHub token exchange failed:', { error: data.error, description: data.error_description })
    throw new Error(data.error_description || 'GitHub token exchange failed')
  }

  return data.access_token
}

/**
 * Fetch GitHub user profile and verified email.
 * @param {string} accessToken - GitHub access token
 * @returns {Promise<{ email: string, name: string, picture: string, githubId: string, emailVerified: boolean }>}
 */
export const getGithubUser = async (accessToken) => {
  // Fetch user profile
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!userResponse.ok) {
    throw new Error('Failed to fetch GitHub user profile')
  }

  const user = await userResponse.json()

  // Fetch user emails to find verified primary email
  const emailsResponse = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!emailsResponse.ok) {
    throw new Error('Failed to fetch GitHub user emails')
  }

  const emails = await emailsResponse.json()

  // Find primary verified email
  const primaryEmail = emails.find(e => e.primary && e.verified)
  const verifiedEmail = primaryEmail || emails.find(e => e.verified)

  if (!verifiedEmail) {
    throw new Error('No verified email found on GitHub account. Please add a verified email to your GitHub profile.')
  }

  return {
    email: verifiedEmail.email.toLowerCase(),
    name: user.name || user.login || '',
    picture: user.avatar_url || null,
    githubId: String(user.id),
    emailVerified: verifiedEmail.verified,
  }
}
