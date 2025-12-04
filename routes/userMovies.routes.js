import express from 'express'
import {
  getAllMovies,
  getMovieById,
  getMoviesByLocation,
  getMoviesByState,
  getMovieDetailsWithShowtimes,
  getDistrictsInState,
  getCinemaHallsByLocation
} from '../controllers/userMovies.Controller.js'

const router = express.Router()

// Get all movies (with optional filters)
// Query params: ?page=1&limit=10&genre=Action&language=English&status=now_showing&search=avengers
router.get('/', getAllMovies)

// Get single movie by ID
router.get('/:id', getMovieById)

// Get movies showing in a specific district and state
// Query params: ?district=Mumbai&state=Maharashtra
router.get('/location/movies', getMoviesByLocation)

// Get movies showing in a state (all districts)
// Query params: ?state=Maharashtra
router.get('/state/movies', getMoviesByState)

// Get movie details with cinema halls and showtimes for a location
// Query params: ?district=Mumbai&state=Maharashtra
router.get('/:movieId/showtimes', getMovieDetailsWithShowtimes)

// Get all districts in a state where movies are showing
// Query params: ?state=Maharashtra
router.get('/location/districts', getDistrictsInState)

// Get all cinema halls in a location
// Query params: ?district=Mumbai&state=Maharashtra
router.get('/location/cinema-halls', getCinemaHallsByLocation)

export default router
