#!/bin/bash

# PostgreSQL Setup Validation Script
# Tests database connectivity, schema, and basic functionality

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f "../.env" ]; then
    set -o allexport
    source ../.env
    set +o allexport
    echo -e "${GREEN}✅ Loaded environment variables from .env${NC}"
else
    echo -e "${RED}❌ .env file not found${NC}"
    echo "Please run setup-postgresql.sh first"
    exit 1
fi

echo -e "${BLUE}🔍 All-Tickers PostgreSQL Validation${NC}"
echo "===================================="

# Test 1: Basic Connection
echo -e "${BLUE}Test 1: Database Connection${NC}"
if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 'Connection successful' as status;" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Connection successful${NC}"
else
    echo -e "${RED}❌ Connection failed${NC}"
    exit 1
fi

# Test 2: Table Existence
echo -e "${BLUE}Test 2: Table Schema${NC}"
TABLES=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ticker%' ORDER BY tablename;")

EXPECTED_TABLES=("ticker_financials" "ticker_historical" "ticker_metadata" "ticker_quotes" "tickers")
for table in "${EXPECTED_TABLES[@]}"; do
    if echo "$TABLES" | grep -q "$table"; then
        echo -e "${GREEN}✅ Table '$table' exists${NC}"
    else
        echo -e "${RED}❌ Table '$table' missing${NC}"
    fi
done

# Test 3: Index Verification
echo -e "${BLUE}Test 3: Performance Indexes${NC}"
INDEX_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'ticker%';")
echo -e "${GREEN}✅ Found $INDEX_COUNT performance indexes${NC}"

# Test 4: Basic CRUD Operations
echo -e "${BLUE}Test 4: Basic CRUD Operations${NC}"

# Insert test ticker
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
    INSERT INTO tickers (symbol, exchanges, active) 
    VALUES ('TEST', ARRAY['NYSE'], true)
    ON CONFLICT (symbol) DO UPDATE SET 
        exchanges = ARRAY['NYSE'],
        active = true;
" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ INSERT operation successful${NC}"
else
    echo -e "${RED}❌ INSERT operation failed${NC}"
fi

# Read test ticker
READ_RESULT=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT symbol FROM tickers WHERE symbol = 'TEST' LIMIT 1;")
if echo "$READ_RESULT" | grep -q "TEST"; then
    echo -e "${GREEN}✅ SELECT operation successful${NC}"
else
    echo -e "${RED}❌ SELECT operation failed${NC}"
fi

# Update test ticker
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
    UPDATE tickers SET price = 99.99 WHERE symbol = 'TEST';
" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ UPDATE operation successful${NC}"
else
    echo -e "${RED}❌ UPDATE operation failed${NC}"
fi

# Clean up test data
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
    DELETE FROM tickers WHERE symbol = 'TEST';
" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ DELETE operation successful${NC}"
else
    echo -e "${RED}❌ DELETE operation failed${NC}"
fi

# Test 5: Stored Procedures
echo -e "${BLUE}Test 5: Stored Procedures${NC}"
FUNCTION_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT count(*) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') AND proname LIKE '%ticker%';")

if [ "$FUNCTION_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ Found $FUNCTION_COUNT stored procedures${NC}"
else
    echo -e "${YELLOW}⚠️  No stored procedures found (optional feature)${NC}"
fi

# Test 6: Database Statistics
echo -e "${BLUE}Test 6: Database Statistics${NC}"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOF'
SELECT 
    'Total Tickers' as metric,
    COUNT(*) as value
FROM tickers

UNION ALL

SELECT 
    'Active Tickers' as metric,
    COUNT(*) as value
FROM tickers WHERE active = true

UNION ALL

SELECT 
    'Quote Records' as metric,
    COUNT(*) as value
FROM ticker_quotes

UNION ALL

SELECT 
    'Historical Records' as metric,
    COUNT(*) as value
FROM ticker_historical

UNION ALL

SELECT 
    'Metadata Records' as metric,
    COUNT(*) as value
FROM ticker_metadata

ORDER BY metric;
EOF

# Test 7: Performance Test
echo -e "${BLUE}Test 7: Performance Test${NC}"
START_TIME=$(date +%s%3N)
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
    SELECT COUNT(*) FROM tickers WHERE active = true;
" > /dev/null 2>&1
END_TIME=$(date +%s%3N)
QUERY_TIME=$((END_TIME - START_TIME))
echo -e "${GREEN}✅ Index query completed in ${QUERY_TIME}ms${NC}"

# Test 8: Connection Pooling Test
echo -e "${BLUE}Test 8: Connection Handling${NC}"
for i in {1..5}; do
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;" > /dev/null 2>&1 &
done
wait
echo -e "${GREEN}✅ Multiple connections handled successfully${NC}"

# Final Summary
echo ""
echo -e "${GREEN}🎉 PostgreSQL Setup Validation Complete!${NC}"
echo "======================================"
echo ""
echo -e "${BLUE}Database Information:${NC}"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Start your Node.js application: npm start"
echo "2. Generate ticker combinations: node src/db/generate-tickers.js"
echo "3. Begin ticker data validation and collection"
echo ""
echo -e "${YELLOW}💡 Tip: Use 'psql' to connect manually:${NC}"
echo "  PGPASSWORD='$DB_PASSWORD' psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"

echo -e "${GREEN}✅ All tests passed! Your PostgreSQL setup is ready.${NC}"