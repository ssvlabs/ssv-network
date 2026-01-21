# Echidna Security Testing for CSSVToken

Fuzz testing for CSSVToken using [Echidna](https://github.com/crytic/echidna).

## Quick Start (macOS)

```bash
bash test/echidna/run-echidna.sh
```

## Manual Setup

```bash
brew install echidna solc-select
solc-select install 0.8.24 && solc-select use 0.8.24
```

## Running Tests

```bash
echidna test/echidna/CSSVTokenEchidna.sol --contract CSSVTokenEchidna --config test/echidna/echidna.yaml
echidna test/echidna/CSSVTokenAccessControlEchidna.sol --contract CSSVTokenAccessControlEchidna --config test/echidna/echidna.yaml
```

## Files

```
test/echidna/
├── CSSVTokenEchidna.sol              # Core invariants (9 tests)
├── CSSVTokenAccessControlEchidna.sol # Access control (3 tests)
├── echidna.yaml
├── run-echidna.sh
└── README.md
```

## CSSVTokenEchidna (9 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_supply_equals_minted_minus_burned` | Supply integrity |
| `echidna_burned_lte_minted` | No underflow |
| `echidna_individual_balance_lte_supply` | No balance > supply |
| `echidna_staking_is_self` | ssvStaking immutable |
| `echidna_name_immutable` | Name is "cSSV" |
| `echidna_symbol_immutable` | Symbol is "cSSV" |
| `echidna_decimals_is_18` | Standard decimals |
| `echidna_zero_address_has_no_balance` | Zero addr check |
| `echidna_supply_non_negative` | No negative supply |

## CSSVTokenAccessControlEchidna (3 Invariants)

| Property | Description |
|----------|-------------|
| `echidna_attacker_cannot_mint` | Unauthorized mint blocked |
| `echidna_attacker_cannot_burn` | Unauthorized burn blocked |
| `echidna_only_self_is_staking` | Single authorized address |
