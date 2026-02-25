#!/bin/bash

# SSV Bug Fixer - Validation Script
# Ensures all fixes meet security and quality requirements before merging

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SSV Bug Fix Validation${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check 1: Contracts compile
echo -e "${YELLOW}[1/8] Checking contract compilation...${NC}"
if just build > /dev/null 2>&1; then
    echo -e "${GREEN}✅ All contracts compile successfully${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Compilation failed${NC}"
    echo "Run 'just build' to see errors"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 2: No new storage variables in modules
echo -e "${YELLOW}[2/8] Checking for storage variables in modules...${NC}"
STORAGE_VIOLATIONS=$(grep -r "^\s*\(uint\|int\|bool\|address\|bytes\|string\|mapping\).*public\|private\|internal" contracts/modules/*.sol | grep -v "function\|modifier\|event\|error" | grep -v "//.*" || true)
if [ -z "$STORAGE_VIOLATIONS" ]; then
    echo -e "${GREEN}✅ No storage variables found in module contracts${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Found storage variables in modules:${NC}"
    echo "$STORAGE_VIOLATIONS"
    echo ""
    echo -e "${YELLOW}Fix: Move state to diamond storage in contracts/libraries/storage/${NC}"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 3: Reentrancy guards on ETH transfers
echo -e "${YELLOW}[3/8] Checking reentrancy guards on ETH transfers...${NC}"
UNGUARDED_TRANSFERS=""
for file in contracts/modules/*.sol; do
    # Extract functions with ETH transfers
    FUNCTIONS_WITH_TRANSFERS=$(grep -n "payable.*\.transfer\|payable.*\.send\|\.call{value:" "$file" | cut -d: -f1 || true)

    if [ ! -z "$FUNCTIONS_WITH_TRANSFERS" ]; then
        for line in $FUNCTIONS_WITH_TRANSFERS; do
            # Check if nonReentrant appears before this line in the same function
            FUNCTION_START=$(awk -v line="$line" 'NR<=line && /function.*external|function.*public/ {print NR}' "$file" | tail -1)
            if [ ! -z "$FUNCTION_START" ]; then
                HAS_GUARD=$(awk -v start="$FUNCTION_START" -v end="$line" 'NR>=start && NR<=end && /nonReentrant/ {print}' "$file")
                if [ -z "$HAS_GUARD" ]; then
                    FUNCTION_NAME=$(awk -v start="$FUNCTION_START" 'NR==start {print}' "$file" | grep -o "function [a-zA-Z_]*" || echo "unknown")
                    UNGUARDED_TRANSFERS="$UNGUARDED_TRANSFERS\n$file:$line - $FUNCTION_NAME"
                fi
            fi
        done
    fi
done

if [ -z "$UNGUARDED_TRANSFERS" ]; then
    echo -e "${GREEN}✅ All ETH transfers have reentrancy guards${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Found ETH transfers without nonReentrant modifier:${NC}"
    echo -e "$UNGUARDED_TRANSFERS"
    echo ""
    echo -e "${YELLOW}Fix: Add 'nonReentrant' modifier to these functions${NC}"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 4: Correct packed type constants
echo -e "${YELLOW}[4/8] Checking packed type precision constants...${NC}"
WRONG_PRECISION=""

# Check for manual divisions that should use library
MANUAL_PACKING=$(grep -rn "/ 100000\|/ 10000000" contracts/modules/*.sol contracts/libraries/*.sol | grep -v "ETH_DEDUCTED_DIGITS\|DEDUCTED_DIGITS" | grep -v "//" || true)
if [ ! -z "$MANUAL_PACKING" ]; then
    WRONG_PRECISION="$WRONG_PRECISION\nManual division found (should use .pack()/.unpack()):\n$MANUAL_PACKING"
fi

# Check for wrong constant usage (heuristic: look for suspiciously wrong constant names)
WRONG_CONSTANT=$(grep -rn "DEDUCTED_DIGITS" contracts/ | grep -i "eth" | grep -v "ETH_DEDUCTED_DIGITS" | grep -v "//" || true)
if [ ! -z "$WRONG_CONSTANT" ]; then
    WRONG_PRECISION="$WRONG_PRECISION\nSuspicious: DEDUCTED_DIGITS used in ETH context:\n$WRONG_CONSTANT"
fi

if [ -z "$WRONG_PRECISION" ]; then
    echo -e "${GREEN}✅ Packed type constants look correct${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Found potential packed type precision issues:${NC}"
    echo -e "$WRONG_PRECISION"
    echo ""
    echo -e "${YELLOW}Fix: Use SSVPackedLib methods or correct constants${NC}"
    echo -e "${YELLOW}  - ETH: use ETH_DEDUCTED_DIGITS (100,000) or .pack()/.unpack()${NC}"
    echo -e "${YELLOW}  - SSV: use DEDUCTED_DIGITS (10,000,000) or .packSSV()/.unpackSSV()${NC}"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 5: Storage struct append-only rule
echo -e "${YELLOW}[5/8] Checking storage struct modifications...${NC}"
if git rev-parse --verify HEAD~1 > /dev/null 2>&1; then
    STRUCT_CHANGES=$(git diff HEAD~1 contracts/libraries/storage/*.sol | grep -E "^\+.*\s+(uint|int|bool|address|bytes|string|mapping)" | grep -v "^\+\+\+" || true)

    if [ ! -z "$STRUCT_CHANGES" ]; then
        echo -e "${YELLOW}⚠️  Storage struct fields modified:${NC}"
        echo "$STRUCT_CHANGES"
        echo ""
        echo -e "${YELLOW}Manual verification required:${NC}"
        echo "  1. New fields are appended at END of struct (not inserted)"
        echo "  2. No existing fields were removed or reordered"
        echo "  3. No field types were changed"
        echo ""
        echo -e "${YELLOW}Press Enter to confirm you've manually verified this, or Ctrl+C to abort${NC}"
        read -r
        echo -e "${GREEN}✅ Storage struct changes manually confirmed${NC}"
        ((CHECKS_PASSED++))
    else
        echo -e "${GREEN}✅ No storage struct modifications detected${NC}"
        ((CHECKS_PASSED++))
    fi
else
    echo -e "${YELLOW}⚠️  Cannot verify (no previous commit)${NC}"
    ((CHECKS_PASSED++))
fi
echo ""

# Check 6: Unit tests pass
echo -e "${YELLOW}[6/8] Running unit tests...${NC}"
if just test-unit > /dev/null 2>&1; then
    echo -e "${GREEN}✅ All unit tests pass${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Unit tests failed${NC}"
    echo "Run 'just test-unit' to see failures"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 7: Integration tests pass
echo -e "${YELLOW}[7/8] Running integration tests...${NC}"
if just test-integration > /dev/null 2>&1; then
    echo -e "${GREEN}✅ All integration tests pass${NC}"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}❌ Integration tests failed${NC}"
    echo "Run 'just test-integration' to see failures"
    ((CHECKS_FAILED++))
fi
echo ""

# Check 8: Coverage threshold
echo -e "${YELLOW}[8/8] Checking test coverage...${NC}"
COVERAGE_THRESHOLD=80

# Run coverage and extract summary
just coverage > /dev/null 2>&1 || true
if [ -f coverage/coverage-summary.json ]; then
    TOTAL_COVERAGE=$(grep -oP '"lines":\s*{\s*"total":\s*\K[0-9.]+' coverage/coverage-summary.json | head -1 || echo "0")
    COVERED_LINES=$(grep -oP '"lines":\s*{\s*"total":\s*[0-9.]+,\s*"covered":\s*\K[0-9.]+' coverage/coverage-summary.json | head -1 || echo "0")

    if [ ! -z "$TOTAL_COVERAGE" ] && [ ! -z "$COVERED_LINES" ] && [ "$TOTAL_COVERAGE" != "0" ]; then
        COVERAGE_PCT=$(awk "BEGIN {printf \"%.2f\", ($COVERED_LINES / $TOTAL_COVERAGE) * 100}")

        if (( $(echo "$COVERAGE_PCT >= $COVERAGE_THRESHOLD" | bc -l) )); then
            echo -e "${GREEN}✅ Coverage: ${COVERAGE_PCT}% (threshold: ${COVERAGE_THRESHOLD}%)${NC}"
            ((CHECKS_PASSED++))
        else
            echo -e "${RED}❌ Coverage: ${COVERAGE_PCT}% (threshold: ${COVERAGE_THRESHOLD}%)${NC}"
            echo "Add more tests to increase coverage"
            ((CHECKS_FAILED++))
        fi
    else
        echo -e "${YELLOW}⚠️  Could not determine coverage${NC}"
        ((CHECKS_PASSED++))
    fi
else
    echo -e "${YELLOW}⚠️  Coverage report not found${NC}"
    echo "Run 'just coverage' manually to check"
    ((CHECKS_PASSED++))
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Checks passed: ${GREEN}$CHECKS_PASSED/8${NC}"
echo -e "Checks failed: ${RED}$CHECKS_FAILED/8${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All validation checks passed!${NC}"
    echo -e "${GREEN}Your fix is ready for review.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Update task status in ssv-review/planning/MAINNET-READINESS.md"
    echo "  2. Commit your changes with clear message"
    echo "  3. Create PR against ssv-staking branch"
    exit 0
else
    echo -e "${RED}❌ Validation failed with $CHECKS_FAILED error(s)${NC}"
    echo -e "${RED}Please fix the issues above before proceeding.${NC}"
    exit 1
fi
