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

import { verifySuperAdmin } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/migrate-backdrops', runBackdropMigration)
router.post('/add', verifySuperAdmin, addMovie)
router.put('/edit/:movieId', verifySuperAdmin, editMovie)
router.delete('/delete/:movieId', verifySuperAdmin, deleteMovie)
router.get('/tmdb-ids', verifySuperAdmin, getMovieTmdbIds) // must be before /:id
router.get('/', getAllMovies)
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

router.get("/:id", getMovieById); // GET /movies/:id
router.patch('/:movieId/status', verifySuperAdmin, updateMovieStatus)

export default router
