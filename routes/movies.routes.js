import express from 'express'
import {
  addMovie,
  editMovie,
  deleteMovie,
  getAllMovies,
  updateMovieStatus
} from '../controllers/movies.Controller.js'

import { verifySuperAdmin } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.post('/add', verifySuperAdmin, addMovie)
router.put('/edit/:movieId', verifySuperAdmin, editMovie)
router.delete('/delete/:movieId', verifySuperAdmin, deleteMovie)
router.get('/', getAllMovies)
router.patch('/:movieId/status', verifySuperAdmin, updateMovieStatus)

export default router
