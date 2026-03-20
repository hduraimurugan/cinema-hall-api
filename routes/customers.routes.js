import express from 'express'
import { getAllCustomers } from '../controllers/customers.Controller.js'
import { verifySuperAdmin } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/', verifySuperAdmin, getAllCustomers)

export default router
