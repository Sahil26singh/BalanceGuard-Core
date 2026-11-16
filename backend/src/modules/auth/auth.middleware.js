import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

/**
 * Middleware that authenticates incoming requests via Bearer JWT.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header. Expected: Bearer <token>'
      }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'balanceguard-core',
      audience: 'balanceguard-core-api'
    });
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: err.name === 'TokenExpiredError' ? 'Authentication token has expired' : 'Invalid authentication token'
      }
    });
  }
}

/**
 * Middleware that restricts route access by user role.
 * @param  {...string} roles - e.g. 'admin', 'reviewer'
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Requires one of roles: [${roles.join(', ')}]`
        }
      });
    }

    next();
  };
}

