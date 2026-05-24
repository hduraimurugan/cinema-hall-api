import express from 'express'
import {
  verifyCinemaAdminAccessToken,
  requireActiveHall,
} from '../middleware/verifyCinemaAdmin.js'
import {
  createScreen,
  editScreen,
  deleteScreen,
  getMyScreens
} from '../controllers/screens.Controller.js'

const router = express.Router()

router.post('/create', verifyCinemaAdminAccessToken, requireActiveHall, createScreen)
router.put('/update/:screenId', verifyCinemaAdminAccessToken, requireActiveHall, editScreen)
router.delete('/delete/:screenId', verifyCinemaAdminAccessToken, requireActiveHall, deleteScreen)
router.get('/', verifyCinemaAdminAccessToken, requireActiveHall, getMyScreens)

export default router