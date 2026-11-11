// Copy to ecosystem.config.cjs (git-ignored), fill in, chmod 600, then: pm2 start ecosystem.config.cjs && pm2 save
module.exports = { apps: [{
  name: 'quorwhere', script: 'server/index.js', cwd: '/opt/quorwhere',
  env: {
    NODE_ENV: 'production', PORT: 3040, PUBLIC_URL: 'https://your.domain',
    MAPILLARY_TOKEN: '',
    QUORVOX_ISSUER: 'https://id.example.com', QUORVOX_CLIENT_ID: '', QUORVOX_CLIENT_SECRET: '',
    ADMIN_QUORVOX_IDS: '',
  },
}] };
