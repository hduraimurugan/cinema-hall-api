import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from "cors";
import chalk from 'chalk';
import dayjs from 'dayjs';
import pool from './db.js'; // DB connection
import authRoutes from './routes/auth.routes.js';
import screensRoutes from './routes/screens.routes.js';
import moviesRoutes from './routes/movies.routes.js';
import userMoviesRoutes from './routes/userMovies.routes.js';
import showsRoutes from './routes/shows.routes.js';
import userAuthRoutes from './routes/customerAuth.routes.js';
import otpRoutes from './routes/otp.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import adsRoutes from './routes/ads.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import { cleanupExpiredHolds } from './controllers/booking.Controller.js';
import { updateShowStatuses } from './controllers/shows.Controller.js';

dotenv.config();

const app = express();

// Boot timer
const appStartTime = process.hrtime();

// Allowed origins
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://cinema-hall-admin.vercel.app",
  "https://cinimax-eta.vercel.app"
];

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/customer', userAuthRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/screens', screensRoutes);
app.use('/api/movies', moviesRoutes);
app.use('/api/shows', showsRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/payment', paymentRoutes);

app.use('/api/user/movies', userMoviesRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/settings', settingsRoutes);

// Ping route
app.get('/ping', (req, res) => res.send('pong'));

// Root
app.get('/', async (req, res) => {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const response = {
    postgres: '✅ Postgres DB Connected via Neon',
    currentTime: `🕒 Current Time: ${now}`,
    server: `🔗 Server Running`
  };
  res.status(200).json(response);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 Global Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Format boot time
const formatElapsedTime = (start) => {
  const [s, ns] = process.hrtime(start);
  return `${(s * 1000 + ns / 1e6).toFixed(2)} ms`;
};

// 🔁 Local server boot logic (skip on Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

  const startServer = async () => {
    try {
      await pool.query('SELECT 1');

      console.log(`\n${chalk.green.bold('✅ Postgres DB Connected via Neon')}`);
      console.log(`${chalk.green('🚀 API Booted In:')} ${chalk.yellowBright(formatElapsedTime(appStartTime))}`);
      console.log(`${chalk.cyan('🕒 Time:')} ${chalk.magenta(now)}\n`);
      app.listen(PORT, () => {
        console.log(`${chalk.cyan('🔗 Server at:')} ${chalk.underline(`http://localhost:${PORT}`)}\n`);
      });

    } catch (err) {
      console.error(chalk.red.bold('\n❌ Failed to connect to DB'));
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  };

  startServer();

  // Run cleanup every 30 seconds
  setInterval(async () => {
    await cleanupExpiredHolds();
  }, 30000);

  // Run show status update every 60 seconds
  setInterval(async () => {
    await updateShowStatuses();
  }, 60000);

  process.on('unhandledRejection', (err) => {
    console.error('🔥 Unhandled Rejection:', err.message);
    setTimeout(() => process.exit(1), 5000);
  });
}

// ✅ Export app for Vercel
export default app;
