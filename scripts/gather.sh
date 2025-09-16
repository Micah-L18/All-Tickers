#!/bin/bash
# Collect comprehensive data script with memory allocation
cd "$(dirname "$0")/.."
node --max-old-space-size=50 src/return-data/return-data.js

# if the process exits with a heap memory error, retry up to 10 times
for i in {1..10}; do
    if [ $? -eq 0 ]; then
        break
    fi
    echo "Retrying... ($i/10)"
    node --max-old-space-size=250 src/return-data/return-data.js
done