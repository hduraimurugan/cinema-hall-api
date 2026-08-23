import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';

const bearerFrom = req =>
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null;

const tryVerify = (token) => {
    if (!token) return null;
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;
    }
};

/**
 * Notifications are read by both customers and admins through the same
 * endpoints. This checks both the customer and admin cookies and sets
 * req.recipient = { type: 'customer'|'admin', id } — avoiding a separate
 * route set (and duplicated controller logic) for each side.
 *
 * In production the two frontends live on different hostnames, so only one
 * of these cookies is ever present. Locally both run on "localhost" with
 * different ports, and cookies aren't port-scoped — a developer signed into
 * both a customer and an admin session at once will have BOTH cookies sent
 * on every request here. When that happens, the request's Origin header
 * (which frontend actually made the call) decides which identity wins,
 * rather than always preferring one arbitrarily and silently hiding the
 * other side's notifications.
 */
export const identifyRecipient = async (req, res, next) => {
    const customerDecoded = tryVerify(req.cookies.cusAccessToken || bearerFrom(req));
    const adminDecoded = tryVerify(req.cookies.accessToken);

    if (customerDecoded && adminDecoded) {
        const isAdminOrigin = req.headers.origin && req.headers.origin === process.env.ADMIN_FRONTEND_URL;
        req.recipient = isAdminOrigin
            ? { type: 'admin', id: adminDecoded.id }
            : { type: 'customer', id: customerDecoded.id };
        return next();
    }

    if (customerDecoded) {
        req.recipient = { type: 'customer', id: customerDecoded.id };
        return next();
    }

    if (adminDecoded) {
        req.recipient = { type: 'admin', id: adminDecoded.id };
        return next();
    }

    logger.warn('[identifyRecipient] No valid customer or admin token on request');
    return res.status(401).json({ error: 'Authentication required' });
};
