import pool from '../db.js'
import jwt from 'jsonwebtoken'
import logger from '../utils/logger.js'
import { recordAuditLog } from '../utils/auditLog.js'

// Create a new screen
export const createScreen = async (req, res) => {
    const {
        name,
        total_seats,
        premium_seats,
        gold_seats,
        silver_seats,
        premium_price,
        gold_price,
        silver_price,
        screen_position,
        layout,
        rows,
        columns
    } = req.body

    const client = await pool.connect()

    try {
        // Use the active hall from requireActiveHall middleware
        const cinemaHallId = req.currentHallId

        // Step 2: Insert screen
        const insertQuery = `
      INSERT INTO screens (
        cinema_hall_id,
        name,
        total_seats,
        premium_seats,
        gold_seats,
        silver_seats,
        premium_price,
        gold_price,
        silver_price,
        rows,
        columns,
        screen_position,
        layout
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `

        const values = [
            cinemaHallId,
            name,
            total_seats,
            premium_seats,
            gold_seats,
            silver_seats,
            premium_price,
            gold_price,
            silver_price,
            rows,
            columns,
            screen_position,
            JSON.stringify(layout)
        ]

        const result = await client.query(insertQuery, values)

        await recordAuditLog(req, {
            action: 'screens.create',
            resourceType: 'screen',
            resourceId: result.rows[0].id,
            resourceLabel: result.rows[0].name,
            hallId: cinemaHallId,
        })

        res.status(201).json(result.rows[0])
    } catch (error) {
        logger.error('Error creating screen:', { message: error.message })
        res.status(500).json({ message: 'Server error while creating screen' })
    } finally {
        client.release()
    }
}

// Edit an existing screen
export const editScreen = async (req, res) => {
    const { screenId } = req.params
    const updateFields = req.body
    const allowedFields = [
        'name',
        'total_seats',
        'premium_seats',
        'gold_seats',
        'silver_seats',
        'premium_price',
        'gold_price',
        'silver_price',
        'layout',
        'rows',
        'columns',
        'screen_position'
    ]

    const fieldsToUpdate = Object.keys(updateFields).filter((key) =>
        allowedFields.includes(key)
    )

    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ message: 'No valid fields to update' })
    }

    const client = await pool.connect()

    try {
        // Step 1: Ensure screen belongs to the active hall
        const screenCheckQuery = `
      SELECT s.* 
      FROM screens s
      WHERE s.id = $1 AND s.cinema_hall_id = $2
    `

        const screenCheckResult = await client.query(screenCheckQuery, [
            screenId,
            req.currentHallId
        ])

        if (screenCheckResult.rows.length === 0) {
            return res.status(404).json({ message: 'Screen not found or unauthorized' })
        }

        // Step 2: Build dynamic update query
        let queryStr = 'UPDATE screens SET '
        const values = []
        fieldsToUpdate.forEach((field, i) => {
            queryStr += `${field} = $${i + 1}, `
            values.push(
                field === 'layout' ? JSON.stringify(updateFields[field]) : updateFields[field]
            )
        })

        queryStr = queryStr.slice(0, -2) // Remove trailing comma
        queryStr += ' WHERE id = $' + (values.length + 1) + ' RETURNING *'
        values.push(screenId)

        const result = await client.query(queryStr, values)

        await recordAuditLog(req, {
            action: 'screens.update',
            resourceType: 'screen',
            resourceId: result.rows[0].id,
            resourceLabel: result.rows[0].name,
            hallId: req.currentHallId,
            metadata: { fields: fieldsToUpdate },
        })

        res.status(200).json(result.rows[0])
    } catch (error) {
        logger.error('Error editing screen:', { message: error.message })
        res.status(500).json({ message: 'Server error while updating screen' })
    } finally {
        client.release()
    }
}

// Delete a screen
export const deleteScreen = async (req, res) => {
    const { screenId } = req.params

    const client = await pool.connect()

    try {
        // Step 1: Check ownership
        const screenCheckQuery = `
      SELECT s.id
      FROM screens s
      WHERE s.id = $1 AND s.cinema_hall_id = $2
    `

        const screenCheckResult = await client.query(screenCheckQuery, [
            screenId,
            req.currentHallId
        ])

        if (screenCheckResult.rows.length === 0) {
            return res.status(404).json({ message: 'Screen not found or unauthorized' })
        }

        // Step 2: Delete screen
        const deleteQuery = 'DELETE FROM screens WHERE id = $1 RETURNING *'
        const result = await client.query(deleteQuery, [screenId])

        await recordAuditLog(req, {
            action: 'screens.delete',
            resourceType: 'screen',
            resourceId: result.rows[0].id,
            resourceLabel: result.rows[0].name,
            hallId: req.currentHallId,
        })

        res.status(200).json({ message: 'Screen deleted successfully', screen: result.rows[0] })
    } catch (error) {
        logger.error('Error deleting screen:', { message: error.message })
        res.status(500).json({ message: 'Server error while deleting screen' })
    } finally {
        client.release()
    }
}

// Get all screens for the admin's cinema hall
export const getMyScreens = async (req, res) => {
    const client = await pool.connect()

    try {
        const query = `
      SELECT s.*
      FROM screens s
      WHERE s.cinema_hall_id = $1
      ORDER BY s.created_at DESC
    `

        const result = await client.query(query, [req.currentHallId])

        res.status(200).json(result.rows)
    } catch (error) {
        logger.error('Error fetching screens:', { message: error.message })
        res.status(500).json({ message: 'Server error while fetching screens' })
    } finally {
        client.release()
    }
}