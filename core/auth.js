'use strict';
/**
 * core/auth.js — Simple shared-password session auth
 *
 * Sessions are in-memory tokens (64-char hex). If the process restarts,
 * users just log in again. Fine for a small friend group.
 *
 * Usage:
 *   const { createAuth } = require('./auth');
 *   const auth = createAuth(process.env.APP_PASSWORD);
 *   app.use(express.json());
 *   app.post('/api/auth/login',  auth.loginHandler);
 *   app.get('/api/auth/logout',  auth.logoutHandler);
 *   app.use(auth.middleware);         // protect everything below
 *   // pass auth.verifyWs to WsServer
 */
const crypto = require('crypto');

const COOKIE  = 'sid';
const MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(s => s.trim().split('=').map(decodeURIComponent))
  );
}

function createAuth(password) {
  if (!password) throw new Error('APP_PASSWORD is required');

  const sessions = new Set();

  function isValid(req) {
    const cookies = parseCookies(req.headers.cookie);
    return sessions.has(cookies[COOKIE]);
  }

  function middleware(req, res, next) {
    const pub = req.path === '/login' ||
                req.path.startsWith('/api/auth/') ||
                req.path === '/favicon.ico';
    if (pub) return next();
    if (isValid(req)) return next();
    res.redirect('/login');
  }

  function verifyWs(info, cb) {
    const cookies = parseCookies(info.req.headers.cookie);
    cb(sessions.has(cookies[COOKIE]));
  }

  function loginHandler(req, res) {
    if (req.body?.password === password) {
      const token = crypto.randomBytes(32).toString('hex');
      sessions.add(token);
      const expires = new Date(Date.now() + MAX_AGE * 1000).toUTCString();
      res.setHeader('Set-Cookie',
        `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}; Path=/; Expires=${expires}`
      );
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'Wrong password' });
    }
  }

  function logoutHandler(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    sessions.delete(cookies[COOKIE]);
    res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; Path=/`);
    res.redirect('/login');
  }

  return { middleware, verifyWs, loginHandler, logoutHandler };
}

module.exports = { createAuth };
