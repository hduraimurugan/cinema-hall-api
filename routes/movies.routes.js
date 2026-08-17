import express from 'express'
import {
  addMovie,
  editMovie,
  deleteMovie,
  getAllMovies,
  getMovieById,
  updateMovieStatus,
  getMovieTmdbIds,
  runBackdropMigration
} from '../controllers/movies.Controller.js'

import { verifySuperAdmin, verifyCinemaAdminAccessToken } from '../middleware/verifyCinemaAdmin.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = express.Router()

// requirePermission lets superAdmin through unconditionally, so swapping
// verifySuperAdmin for it widens access to roles the owner has granted
// without locking the platform admin out.
router.get('/migrate-backdrops', runBackdropMigration)
router.post('/add', verifyCinemaAdminAccessToken, requirePermission('movies.create'), addMovie)
router.put('/edit/:movieId', verifyCinemaAdminAccessToken, requirePermission('movies.update'), editMovie)
router.delete('/delete/:movieId', verifyCinemaAdminAccessToken, requirePermission('movies.delete'), deleteMovie)
router.get('/tmdb-ids', verifySuperAdmin, getMovieTmdbIds) // must be before /:id
router.get('/', verifyCinemaAdminAccessToken, requirePermission('movies.read'), getAllMovies)
router.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }
  if (!imageUrl.startsWith('https://image.tmdb.org/')) {
    return res.status(400).send('Only TMDB images are allowed');
  }
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch image');
    }
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(500).send(error.message);
  }
});

router.get("/:id", verifyCinemaAdminAccessToken, requirePermission('movies.read'), getMovieById); // GET /movies/:id
router.patch('/:movieId/status', verifyCinemaAdminAccessToken, requirePermission('movies.update'), updateMovieStatus)

export default router
