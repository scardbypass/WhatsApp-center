#!/usr/bin/env bash
set -e
npm install
test -f .env || cp .env.example .env
echo "Edit .env, then run: npm start"
