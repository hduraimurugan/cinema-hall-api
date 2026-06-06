import express from 'express'
import { getAllCustomers, getCustomerDetails } from '../controllers/customers.Controller.js'
import { verifySuperAdmin } from '../middleware/verifyCinemaAdmin.js'

const router = express.Router()

router.get('/', verifySuperAdmin, getAllCustomers)
router.get('/:id', verifySuperAdmin, getCustomerDetails)

export default router
