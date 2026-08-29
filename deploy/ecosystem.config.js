// pm2 process definition — keeps the app alive across reboots/crashes.
// Start with: pm2 start deploy/ecosystem.config.js
// Persist across reboot: pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'sknlp-info-hub',
      cwd: '/root/the-record-app',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'production', PORT: 3000 }
    }
  ]
};
