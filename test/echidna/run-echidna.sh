#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "  SSV Network Echidna Fuzz Testing"
echo "=========================================="
echo ""

if [[ ! -f "test/echidna/echidna.yaml" ]]; then
    echo -e "${RED}Error: Run this script from the project root directory${NC}"
    echo "Usage: bash test/echidna/run-echidna.sh"
    exit 1
fi

HARNESS_FILES=()
while IFS= read -r file; do
    HARNESS_FILES+=("$file")
done < <(find test/echidna -maxdepth 1 -type f -name '*Echidna.sol' | sort)

if [[ ${#HARNESS_FILES[@]} -eq 0 ]]; then
    echo -e "${RED}Error: No Echidna harnesses found in test/echidna${NC}"
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

TOTAL_HARNESSES=${#HARNESS_FILES[@]}
for index in "${!HARNESS_FILES[@]}"; do
    file="${HARNESS_FILES[$index]}"
    contract="$(basename "$file" .sol)"

    echo ""
    echo "=========================================="
    printf "  [%d/%d] %s\n" "$((index + 1))" "$TOTAL_HARNESSES" "$contract"
    echo "=========================================="
    echo ""

    echidna "$file" \
        --contract "$contract" \
        --config test/echidna/echidna.yaml
done

echo ""
echo -e "${GREEN}All tests completed!${NC}"
