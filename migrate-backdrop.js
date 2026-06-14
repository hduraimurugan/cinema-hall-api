import pool from './db.js';
import dotenv from 'dotenv';

dotenv.config();

async function runBackdropMigration() {
  console.log('🏁 Starting production TMDB backdrop_path update script...');

  if (!process.env.TMDB_API_KEY) {
    console.error('❌ TMDB_API_KEY is not defined in environment variables.');
    process.exit(1);
  }

  try {
    // 1. Fetch movies that need a backdrop update
    const { rows: moviesToUpdate } = await pool.query(`
      SELECT id, tmdb_id, title 
      FROM movies 
      WHERE tmdb_id IS NOT NULL 
        AND (backdrop_path IS NULL OR backdrop_path = '');
    `);

    if (moviesToUpdate.length === 0) {
      console.log('✅ No movies found needing a backdrop_path update.');
      return;
    }

    console.log(`ℹ️ Found ${moviesToUpdate.length} movie(s) needing backdrop_path update.`);

    for (let i = 0; i < moviesToUpdate.length; i++) {
      const movie = moviesToUpdate[i];
      console.log(`[${i + 1}/${moviesToUpdate.length}] Processing "${movie.title}" (TMDB ID: ${movie.tmdb_id})...`);

      try {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${movie.tmdb_id}`;
        const res = await fetch(tmdbUrl, {
          headers: {
            Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
            Accept: 'application/json',
          },
        });

        if (res.ok) {
          const details = await res.json();
          if (details.backdrop_path) {
            const backdropUrl = `https://image.tmdb.org/t/p/original${details.backdrop_path}`;
            await pool.query(
              `UPDATE movies SET backdrop_path = $1 WHERE id = $2`,
              [backdropUrl, movie.id]
            );
            console.log(`   ✅ Updated backdrop_path to: ${backdropUrl}`);
          } else {
            console.warn(`   ⚠️ No backdrop_path found on TMDB for "${movie.title}".`);
          }
        } else {
          console.error(`   ❌ Failed to fetch TMDB details for "${movie.title}". Status: ${res.status}`);
        }
      } catch (movieErr) {
        console.error(`   ❌ Error updating backdrop for "${movie.title}":`, movieErr.message);
      }

      // Add a small delay between requests to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log('🎉 Backdrop migration complete.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runBackdropMigration();
