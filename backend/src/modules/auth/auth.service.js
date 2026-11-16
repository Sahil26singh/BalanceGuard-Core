import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

export async function authenticateUser(email, password) {
  const { rows } = await query(
    'SELECT id, email, password_hash, role FROM users WHERE email = $1;',
    [email.toLowerCase().trim()]
  );
  const user = rows[0];

  // Same error for "no such user" and "wrong password", so emails cannot be guessed
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const profile = { id: user.id, email: user.email, role: user.role };
  const token = jwt.sign(profile, env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'balanceguard-core',
    audience: 'balanceguard-core-api',
    expiresIn: '8h'
  });
  return { user: profile, token };
}

export async function getUserById(id) {
  const { rows } = await query('SELECT id, email, role, created_at FROM users WHERE id = $1;', [id]);
  return rows[0] || null;
}
