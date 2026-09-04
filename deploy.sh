#!/usr/bin/env bash
set -euo pipefail
npm install
node --check server.js
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
