import express from 'express'
import {
    getTMDBPopular,
    getTMDBNowPlaying,
    getTMDBUpcoming,
    getTMDBTopRated,
    getTMDBInTheatres,
    searchTMDB,
    getTMDBMovieDetails,
} from '../controllers/tmdb.Controller.js'
import { verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/popular', verifyCinemaAdminAccessToken, getTMDBPopular)
router.get('/now-playing', verifyCinemaAdminAccessToken, getTMDBNowPlaying)
router.get('/in-theatres', verifyCinemaAdminAccessToken, getTMDBInTheatres)
router.get('/upcoming', verifyCinemaAdminAccessToken, getTMDBUpcoming)
router.get('/top-rated', verifyCinemaAdminAccessToken, getTMDBTopRated)
router.get('/search', verifyCinemaAdminAccessToken, searchTMDB)
router.get('/movie/:tmdbId', verifyCinemaAdminAccessToken, getTMDBMovieDetails)

export default router
