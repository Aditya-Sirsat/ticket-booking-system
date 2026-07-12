// Creates (or upgrades) an admin account. Usage:
//   node db/seedAdmin.js admin@example.com "Admin Name" "StrongPassword123"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error('Usage: node db/seedAdmin.js <email> <name> <password>');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = $3, name = $2`,
    [name, email, hash]
  );
  console.log(`✅ Admin user ready: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
