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
import { verifySuperAdmin } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/popular', verifySuperAdmin, getTMDBPopular)
router.get('/now-playing', verifySuperAdmin, getTMDBNowPlaying)
router.get('/in-theatres', verifySuperAdmin, getTMDBInTheatres)
router.get('/upcoming', verifySuperAdmin, getTMDBUpcoming)
router.get('/top-rated', verifySuperAdmin, getTMDBTopRated)
router.get('/search', verifySuperAdmin, searchTMDB)
router.get('/movie/:tmdbId', verifySuperAdmin, getTMDBMovieDetails)

export default router
