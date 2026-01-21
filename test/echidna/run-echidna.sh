#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "  CSSVToken Echidna Fuzz Testing"
echo "=========================================="
echo ""

if [[ ! -f "test/echidna/CSSVTokenEchidna.sol" ]]; then
    echo -e "${RED}Error: Run this script from the project root directory${NC}"
    echo "Usage: bash test/echidna/run-echidna.sh"
    exit 1
fi

echo "Checking dependencies..."
if ! command -v brew &> /dev/null; then
    echo -e "${RED}Homebrew not found. Install from https://brew.sh${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Homebrew"

if ! command -v echidna &> /dev/null; then
    echo -e "${YELLOW}Echidna not found. Installing...${NC}"
    brew install echidna
fi
echo -e "  ${GREEN}✓${NC} Echidna $(echidna --version 2>/dev/null | head -1 || echo 'installed')"

if ! command -v solc-select &> /dev/null; then
    echo -e "${YELLOW}solc-select not found. Installing...${NC}"
    brew install solc-select
fi
echo -e "  ${GREEN}✓${NC} solc-select"

REQUIRED_SOLC="0.8.24"
if ! solc-select versions 2>/dev/null | grep -q "$REQUIRED_SOLC"; then
    echo -e "${YELLOW}solc $REQUIRED_SOLC not found. Installing...${NC}"
    solc-select install $REQUIRED_SOLC
fi

CURRENT_SOLC=$(solc --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "none")
if [[ "$CURRENT_SOLC" != "$REQUIRED_SOLC" ]]; then
    echo -e "${YELLOW}Switching to solc $REQUIRED_SOLC...${NC}"
    solc-select use $REQUIRED_SOLC
fi
echo -e "  ${GREEN}✓${NC} solc $REQUIRED_SOLC"

echo ""
echo "=========================================="
echo "  [1/6] CSSVTokenEchidna (Core Tests)"
echo "=========================================="
echo ""

echidna test/echidna/CSSVTokenEchidna.sol \
    --contract CSSVTokenEchidna \
    --config test/echidna/echidna.yaml

echo ""
echo "=========================================="
echo "  [2/6] CSSVTokenAccessControlEchidna"
echo "=========================================="
echo ""

echidna test/echidna/CSSVTokenAccessControlEchidna.sol \
    --contract CSSVTokenAccessControlEchidna \
    --config test/echidna/echidna.yaml

echo ""
echo "=========================================="
echo "  [3/6] SSVOperatorsEchidna"
echo "=========================================="
echo ""

echidna test/echidna/SSVOperatorsEchidna.sol \
    --contract SSVOperatorsEchidna \
    --config test/echidna/echidna.yaml

echo ""
echo "=========================================="
echo "  [4/6] SSVClustersEchidna"
echo "=========================================="
echo ""

echidna test/echidna/SSVClustersEchidna.sol \
    --contract SSVClustersEchidna \
    --config test/echidna/echidna.yaml

echo ""
echo "=========================================="
echo "  [5/6] SSVValidatorsEchidna"
echo "=========================================="
echo ""

echidna test/echidna/SSVValidatorsEchidna.sol \
    --contract SSVValidatorsEchidna \
    --config test/echidna/echidna.yaml

echo ""
echo "=========================================="
echo "  [6/6] SSVDAOEchidna"
echo "=========================================="
echo ""

echidna test/echidna/SSVDAOEchidna.sol \
    --contract SSVDAOEchidna \
    --config test/echidna/echidna.yaml

echo ""
echo -e "${GREEN}All tests completed!${NC}"
