import express from 'express'
import {
  verifyCinemaAdminAccessToken,
} from '../middleware/verifyCinemaAdmin.js'
import {
  createScreen,
  editScreen,
  deleteScreen,
  getMyScreens
} from '../controllers/screens.Controller.js'

const router = express.Router()

router.post('/create', verifyCinemaAdminAccessToken, createScreen)
router.put('/update/:screenId', verifyCinemaAdminAccessToken, editScreen)
router.delete('/delete/:screenId', verifyCinemaAdminAccessToken, deleteScreen)
router.get('/', verifyCinemaAdminAccessToken, getMyScreens)

export default router