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
import { requirePermission } from '../middleware/requirePermission.js'

const router = express.Router()

router.post('/create', verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('screens.create'), createScreen)
router.put('/update/:screenId', verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('screens.update'), editScreen)
router.delete('/delete/:screenId', verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('screens.delete'), deleteScreen)
router.get('/', verifyCinemaAdminAccessToken, requireActiveHall, requirePermission('screens.read'), getMyScreens)

export default router