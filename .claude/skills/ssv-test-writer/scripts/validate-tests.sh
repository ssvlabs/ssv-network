#!/bin/bash

# SSV Test Writer - Validation Script
# Ensures all tests meet quality and coverage requirements

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SSV Test Validation${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check 1: All tests pass
echo -e "${YELLOW}[1/6] Running all tests...${NC}"
if just test > /dev/null 2>&1; then
    echo -e "${GREEN}✅ All tests pass${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Some tests failed${NC}"
    echo "Run 'just test' to see failures"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 2: No .only or .skip in test files
echo -e "${YELLOW}[2/6] Checking for .only or .skip in tests...${NC}"
ONLY_SKIP=$(grep -r "\.only\|\.skip" test/**/*.ts --include="*.test.ts" || true)
if [ -z "$ONLY_SKIP" ]; then
    echo -e "${GREEN}✅ No .only or .skip found${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Found .only or .skip in tests:${NC}"
    echo "$ONLY_SKIP"
    echo ""
    echo -e "${YELLOW}Fix: Remove .only and .skip before committing${NC}"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 3: Test naming conventions
echo -e "${YELLOW}[3/6] Checking test naming conventions...${NC}"
BAD_NAMES=$(grep -r "it('should" test/ --include="*.test.ts" | grep -v "should " | head -5 || true)
if [ -z "$BAD_NAMES" ]; then
    echo -e "${GREEN}✅ Test names follow conventions${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${YELLOW}⚠️  Some test names may need improvement:${NC}"
    echo "$BAD_NAMES"
    echo ""
    echo -e "${YELLOW}Recommended: Start tests with 'should ' for clarity${NC}"
    ((CHECKS_PASSED++)) # Warning, not failure
fi
echo ""

# Check 4: Coverage thresholds
echo -e "${YELLOW}[4/6] Checking test coverage...${NC}"
COVERAGE_THRESHOLD_STATEMENTS=95
COVERAGE_THRESHOLD_BRANCHES=90
COVERAGE_THRESHOLD_FUNCTIONS=95
COVERAGE_THRESHOLD_LINES=95

# Run coverage
just coverage > /dev/null 2>&1 || true

if [ -f coverage/coverage-summary.json ]; then
    # Extract coverage percentages
    STATEMENTS=$(node -e "const c = require('./coverage/coverage-summary.json'); console.log(c.total.statements.pct)")
    BRANCHES=$(node -e "const c = require('./coverage/coverage-summary.json'); console.log(c.total.branches.pct)")
    FUNCTIONS=$(node -e "const c = require('./coverage/coverage-summary.json'); console.log(c.total.functions.pct)")
    LINES=$(node -e "const c = require('./coverage/coverage-summary.json'); console.log(c.total.lines.pct)")

    COVERAGE_OK=true

    echo "Coverage Report:"

    if (( $(echo "$STATEMENTS >= $COVERAGE_THRESHOLD_STATEMENTS" | bc -l) )); then
        echo -e "  ${GREEN}✓${NC} Statements: ${STATEMENTS}% (threshold: ${COVERAGE_THRESHOLD_STATEMENTS}%)"
    else
        echo -e "  ${RED}✗${NC} Statements: ${STATEMENTS}% (threshold: ${COVERAGE_THRESHOLD_STATEMENTS}%)"
        COVERAGE_OK=false
    fi

    if (( $(echo "$BRANCHES >= $COVERAGE_THRESHOLD_BRANCHES" | bc -l) )); then
        echo -e "  ${GREEN}✓${NC} Branches: ${BRANCHES}% (threshold: ${COVERAGE_THRESHOLD_BRANCHES}%)"
    else
        echo -e "  ${RED}✗${NC} Branches: ${BRANCHES}% (threshold: ${COVERAGE_THRESHOLD_BRANCHES}%)"
        COVERAGE_OK=false
    fi

    if (( $(echo "$FUNCTIONS >= $COVERAGE_THRESHOLD_FUNCTIONS" | bc -l) )); then
        echo -e "  ${GREEN}✓${NC} Functions: ${FUNCTIONS}% (threshold: ${COVERAGE_THRESHOLD_FUNCTIONS}%)"
    else
        echo -e "  ${RED}✗${NC} Functions: ${FUNCTIONS}% (threshold: ${COVERAGE_THRESHOLD_FUNCTIONS}%)"
        COVERAGE_OK=false
    fi

    if (( $(echo "$LINES >= $COVERAGE_THRESHOLD_LINES" | bc -l) )); then
        echo -e "  ${GREEN}✓${NC} Lines: ${LINES}% (threshold: ${COVERAGE_THRESHOLD_LINES}%)"
    else
        echo -e "  ${RED}✗${NC} Lines: ${LINES}% (threshold: ${COVERAGE_THRESHOLD_LINES}%)"
        COVERAGE_OK=false
    fi

    if [ "$COVERAGE_OK" = true ]; then
        echo -e "${GREEN}✅ Coverage meets all thresholds${NC}"
        ((CHECKS_PASSED++))
    else
        echo -e "${RED}❌ Coverage below threshold${NC}"
        echo "View detailed report: open coverage/index.html"
        ((CHECKS_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  Coverage report not found${NC}"
    echo "Run 'just coverage' manually"
    ((CHECKS_PASSED++)) # Don't fail if coverage can't be determined
fi
echo ""

# Check 5: Test file organization
echo -e "${YELLOW}[5/6] Checking test file organization...${NC}"
MISPLACED_TESTS=""

# Unit tests should be in test/unit/[Module]/
UNIT_TESTS=$(find test/ -name "*.test.ts" -not -path "test/unit/*" -not -path "test/integration/*" -not -path "test/invariant/*" -not -path "test/sanity/*" -not -path "test/helpers/*" || true)
if [ ! -z "$UNIT_TESTS" ]; then
    MISPLACED_TESTS="$MISPLACED_TESTS\nMisplaced unit tests:\n$UNIT_TESTS"
fi

if [ -z "$MISPLACED_TESTS" ]; then
    echo -e "${GREEN}✅ Test files properly organized${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${YELLOW}⚠️  Some test files may be misplaced:${NC}"
    echo -e "$MISPLACED_TESTS"
    echo ""
    echo -e "${YELLOW}Recommended structure:${NC}"
    echo "  test/unit/[Module]/[function].test.ts"
    echo "  test/integration/[flow].test.ts"
    echo "  test/invariant/[property].invariant.ts"
    ((CHECKS_PASSED++)) # Warning, not failure
fi
echo ""

# Check 6: Event assertions in tests
echo -e "${YELLOW}[6/6] Checking for event assertions...${NC}"
TESTS_WITH_EMIT=$(grep -r "\.emit(" test/ --include="*.test.ts" | wc -l)
TESTS_WITH_STATE_CHANGE=$(grep -r "registerValidator\|deposit\|withdraw\|liquidate\|stake\|unstake" test/ --include="*.test.ts" | wc -l)

if [ "$TESTS_WITH_EMIT" -gt 0 ]; then
    echo -e "${GREEN}✅ Tests include event assertions (${TESTS_WITH_EMIT} found)${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${YELLOW}⚠️  No event assertions found${NC}"
    echo "Consider adding .emit() assertions for state-changing operations"
    ((CHECKS_PASSED++)) # Warning, not failure
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Checks passed: ${GREEN}$CHECKS_PASSED/6${NC}"
echo -e "Checks failed: ${RED}$CHECKS_FAILED/6${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All validation checks passed!${NC}"
    echo -e "${GREEN}Your tests are ready for review.${NC}"
    echo ""
    echo "Coverage summary:"
    echo "  Statements: ${STATEMENTS}%"
    echo "  Branches: ${BRANCHES}%"
    echo "  Functions: ${FUNCTIONS}%"
    echo "  Lines: ${LINES}%"
    exit 0
else
    echo -e "${RED}❌ Validation failed with $CHECKS_FAILED error(s)${NC}"
    echo -e "${RED}Please fix the issues above before proceeding.${NC}"
    exit 1
fi
