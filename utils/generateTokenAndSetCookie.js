import jwt from 'jsonwebtoken'

const isProduction = process.env.NODE_ENV === 'production'

export const generateTokenAndSetCookie = (res, admin) => {
    const payload = {
        id: admin.id,
        email: admin.email,
        name: admin.name
    }

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '1d',
    })

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
        expiresIn: '30d',
    })

    res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
    })

    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    })

    return { accessToken, refreshToken }
}
