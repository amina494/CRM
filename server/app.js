import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { channelStatus } from './services/messaging.js';
import { walletStatus } from './services/wallet.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import guestRoutes from './routes/guests.js';
import logisticsRoutes from './routes/logistics.js';
import publicRoutes from './routes/public.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Only believe the visitor address a proxy reports when we know a proxy is
  // there (TRUST_PROXY=1 behind nginx/Caddy). Otherwise anyone could claim any
  // address and slip past the sign-in limits.
  app.set('trust proxy', config.trustProxy);
  app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer'); // invitation and driver links never leak to other sites
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); // the app cannot be embedded in another site
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store'); // guest data is never cached
    next();
  });
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/public', publicRoutes);
  app.use('/api', authRoutes);
  app.use('/api', requireAuth);
  app.get('/api/meta', (req, res) => {
    res.json({ org: config.orgName, publicUrl: config.publicUrl, channels: channelStatus(), wallet: walletStatus() });
  });
  app.use('/api', eventRoutes, guestRoutes, logisticsRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built web app (npm run build) with client-side routing fallback.
  const dist = path.join(config.root, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Server error';
    if (/constraint failed/i.test(message)) {
      status = 400;
      if (/UNIQUE/i.test(message)) message = 'That value is already in use';
      else if (/CHECK/i.test(message)) message = 'One of the values is not allowed';
      else if (/FOREIGN KEY/i.test(message)) message = 'A linked record does not exist';
    }
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });
  return app;
}
