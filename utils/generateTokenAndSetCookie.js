import jwt from 'jsonwebtoken'

const isProduction = process.env.NODE_ENV === 'production'

export const generateTokenAndSetCookie = (res, admin) => {
    const payload = {
        id: admin.id,
        email: admin.email,
        name: admin.name
    }

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '15m',
    })

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
        expiresIn: '7d',
    })

    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 15 * 60 * 1000, // 15 min
    })

    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })

    return { accessToken, refreshToken }
}
