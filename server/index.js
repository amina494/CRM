import { config, isProd } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

if (isProd && config.sessionSecret === 'dev-insecure-secret-change-me') {
  console.error('Refusing to start: set SESSION_SECRET to a long random value in production.');
  process.exit(1);
}

openDb();
createApp().listen(config.port, () => {
  console.log(`Guest CRM API listening on http://localhost:${config.port}`);
  console.log(`Public links will use ${config.publicUrl}`);
});
