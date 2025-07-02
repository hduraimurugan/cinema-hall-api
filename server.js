// server.js
import express from 'express';
import dotenv from 'dotenv';
import http from 'http';
import cookieParser from 'cookie-parser';
import chalk from 'chalk';
import dayjs from 'dayjs';
import authRoutes from './routes/auth.routes.js';
import pool from './db.js'; // DB connection for testing
import cors from "cors";

// Load env variables
dotenv.config();

// Create app and server
const app = express();
const server = http.createServer(app);

// App boot time tracking
const appStartTime = process.hrtime();

// Allowed client origins
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://military-assets-management-eta.vercel.app",
];

// CORS middleware (manual handling)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// Routes
app.use('/api/auth', authRoutes);


// Health check
app.get('/ping', (req, res) => res.send('pong'));

// Format elapsed boot time
const formatElapsedTime = (start) => {
  const [s, ns] = process.hrtime(start);
  return `${(s * 1000 + ns / 1e6).toFixed(2)} ms`;
};

// Global error handler (optional placeholder)
app.use((err, req, res, next) => {
  console.error('🔥 Global Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server with DB check
const startServer = async () => {
  const PORT = process.env.PORT || 5000;
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

  try {
    // Test DB connection
    await pool.query('SELECT 1');

    console.log(`\n${chalk.green.bold('✅ Postgres DB Connected via Neon')}`);
    console.log(`${chalk.green('🚀 Cinema API Ready In:')} ${chalk.yellowBright(formatElapsedTime(appStartTime))}`);
    console.log(`${chalk.cyan('🕒 Current Time:')} ${chalk.magenta(now)}\n`);

    server.listen(PORT, () => {
      console.log(`${chalk.cyan('🔗 Server Running At:')} ${chalk.underline(`http://localhost:${PORT}`)}\n`);
    });

  } catch (err) {
    console.error(chalk.red.bold('\n❌ Failed to connect to Postgres DB'));
    console.error(chalk.red(err.message));
    process.exit(1);
  }
};

startServer();
