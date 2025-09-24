#!/bin/bash
# Validate tickers script using return-data system
cd "$(dirname "$0")/.."
node --max-old-space-size=10240 src/return-data/return-data.js --validate
