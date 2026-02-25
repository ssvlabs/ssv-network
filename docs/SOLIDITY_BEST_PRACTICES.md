# Solidity & Smart Contract Security — Best Practices

Consolidated reference for secure Solidity development, derived from Trail of Bits' [Building Secure Contracts](https://github.com/crytic/building-secure-contracts). Use this document when implementing fixes, reviewing code, or writing new features.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Implementation Guidelines](#2-implementation-guidelines)
3. [Upgradeability & Proxy Patterns](#3-upgradeability--proxy-patterns)
4. [Arithmetic Safety](#4-arithmetic-safety)
5. [Access Control](#5-access-control)
6. [Reentrancy & External Interactions](#6-reentrancy--external-interactions)
7. [Event Logging & Monitoring](#7-event-logging--monitoring)
8. [Token Integration](#8-token-integration)
9. [Testing Strategy](#9-testing-strategy)
10. [Static Analysis](#10-static-analysis)
11. [Fuzzing with Echidna](#11-fuzzing-with-echidna)
12. [Security Properties & Invariants](#12-security-properties--invariants)
13. [Code Maturity Checklist](#13-code-maturity-checklist)
14. [Deployment & Incident Response](#14-deployment--incident-response)
15. [Pre-Audit Checklist](#15-pre-audit-checklist)
16. [EVM Internals Quick Reference](#16-evm-internals-quick-reference)

---

## 1. Design Principles

### Keep it simple
Use the simplest solution that meets requirements. Every team member should understand the design.

### Minimize on-chain logic
Keep as much computation off-chain as possible. Pre-process data off-chain, verify on-chain. Example: sort a list off-chain, verify order on-chain.

### Document before coding
Write documentation at three levels before implementation:
1. **Plain English** — system purpose, assumptions, threat model
2. **Architecture diagrams** — contract interactions, state machine, data flow
3. **Code-level** — NatSpec for every public/external function, inline comments for non-obvious logic

### Specification alignment
- Every arithmetic formula should map 1:1 to a specification
- Document precision loss expectations for every formula
- Specify parameter ranges (min/max) and propagate through docs
- System and function-level invariants should be explicitly stated

---

## 2. Implementation Guidelines

### Function design
- **Small functions with clear purpose** — one function, one job
- **Divide logic** across contracts or into grouped functions (auth, arithmetic, state)
- **Minimal cyclomatic complexity** — avoid deep nesting of if/else/ternary

### Inheritance
- Keep inheritance trees shallow and narrow
- Be aware of C3 linearization — `contract A is B, C` and `contract A is C, B` have different storage layouts
- Watch for function shadowing across the inheritance chain
- Use Slither's inheritance-graph printer to visualize hierarchy

### Dependencies
- Use well-tested libraries (OpenZeppelin) — don't copy-paste
- Pin dependency versions, keep them updated
- Audit third-party code before integrating

### Solidity-specific
- **Use a stable compiler release** for deployment, but check for warnings with the latest
- **Avoid inline assembly** unless absolutely necessary — requires EVM mastery
- If assembly is used: justify it, document every operation, provide a high-level reference implementation, and test with differential fuzzing
- **Solidity 0.8+** provides built-in overflow/underflow checks — do not disable (`unchecked`) without explicit justification and documentation
- **Favor explicit over implicit** — be explicit about visibility, mutability, return types

### Code hygiene
- No dead code — remove anything replaced
- No redundant logic — if similar code exists, extend it
- Clear naming conventions, consistent throughout
- Use custom errors instead of `require` strings (gas efficient, more informative)
- Types should enforce correctness where possible (e.g., custom types for packed values)

---

## 3. Upgradeability & Proxy Patterns

### General guidance
- **Prefer contract migration over upgradeability** — migration offers the same benefits without delegatecall complexity
- **If using delegatecall proxies, use data separation patterns** when possible
- **Document the upgrade procedure before deployment** — include: initialization calls, key locations, post-deployment verification scripts

### Delegatecall proxy safety checklist

| Risk | Mitigation |
|------|------------|
| **Storage layout mismatch** | Proxy and implementation must inherit from the same shared base. Never define state variables independently. |
| **Inheritance order** | `contract A is B, C` vs `contract A is C, B` produce different layouts. Lock inheritance order. |
| **Uninitialized implementation** | Initialize immediately on deployment. Use a factory pattern. Disable direct implementation usage with a constructor flag. |
| **Function shadowing** | If proxy and implementation define the same function, the proxy's version wins. Audit admin functions (`setOwner`, etc.). |
| **Immutable/constant drift** | Immutables are embedded in bytecode — they can diverge between proxy and implementation. |
| **Contract existence checks** | `delegatecall` to an address with no code returns `true`. Verify target contract exists. Most proxy libraries do NOT check this automatically. |
| **Storage struct ordering** | Append-only for storage structs — NEVER reorder or remove existing fields. |

### Tools
- [`slither-check-upgradeability`](https://github.com/crytic/slither/wiki/Upgradeability-Checks) — automated safety checks for proxy patterns

---

## 4. Arithmetic Safety

### Overflow/underflow
- Solidity 0.8+ provides automatic checks for `+`, `-`, `*`
- `unchecked` blocks disable these checks — only use when overflow is mathematically impossible and document why
- When using assembly arithmetic, implement checks manually (see below)

### Precision and rounding
- **Explicitly choose rounding direction** for every operation with precision loss
- Use ceiling division for conservative estimates (e.g., ETH to vUnits)
- Use floor division for safe payouts (e.g., vUnits to ETH)
- **Document precision loss** against a ground-truth (infinite-precision reference)
- Bound and document all trapping operations (divide-by-zero, etc.)

### Packed types
- When packing values into smaller types (uint64, uint32), verify that overflow cannot occur before packing
- Document the precision lost by packing (e.g., `value / 100_000` loses last 5 digits)

### Assembly arithmetic patterns
For `uint256` addition overflow check:
```solidity
unchecked {
    c = a + b;
    if (a > c) revert Overflow(); // Solidity 0.8.16+
}
```

For `uint256` multiplication overflow check:
```solidity
unchecked {
    c = a * b;
    if (a != 0 && b != c / a) revert Overflow(); // Solidity 0.8.17+
}
```

For sub-32-byte types (e.g., `int64`), clean upper bits with `signextend` or cast to `int256` first, then bounds-check.

### Balance underflow protection
Always use `max(0, balance - fees)` pattern:
```solidity
uint256 usage = computeFees();
cluster.balance = (usage >= cluster.balance) ? 0 : cluster.balance - usage;
```

---

## 5. Access Control

### Principles
- **Least privilege** — each role should only access what it needs
- **Separation of concerns** — don't combine roles (fee-setter shouldn't have upgrade power)
- **No single EOA as sole admin** — use multisig/MPC for privileged operations
- **Two-step processes** for critical operations (e.g., `Ownable2Step`)
- Roles should be revocable

### Implementation patterns
- Document all actors and their privileges in a matrix
- Test every actor-specific privilege explicitly
- Verify no privilege escalation paths exist
- Protect against leaked/lost keys — loss of one signer should not compromise the system

### Checklist
- [ ] All privileged functions have access control
- [ ] Different roles have non-overlapping privileges
- [ ] Owner/admin functions use `onlyOwner` or equivalent
- [ ] Operator functions verify `operator.checkOwner()`
- [ ] No function can be called by an unauthorized party to modify state

---

## 6. Reentrancy & External Interactions

### Patterns
- **Checks-Effects-Interactions (CEI)** — validate, update state, then make external calls
- **Use `nonReentrant`** on any function that makes external calls or transfers ETH/tokens
- Never trust return values from external contracts without validation

### External call risks
- External calls in transfer functions can lead to reentrancy (especially ERC777 hooks, `onERC721Received`)
- `delegatecall` returns `true` for addresses with no code
- Low-level calls (`call`, `delegatecall`, `staticcall`) return `true` for empty addresses — always check contract existence

### Token transfers
- Use `SafeERC20` for token interactions (handles non-standard return values)
- Verify ETH transfers succeeded — check return value of `.call{value: amount}("")`
- Be aware of fee-on-transfer tokens, rebasing tokens, and tokens with hooks

---

## 7. Event Logging & Monitoring

### Design
- **Log ALL critical operations** — state changes, parameter updates, admin actions, transfers
- Use consistent event naming and parameter ordering
- Events facilitate debugging during development and monitoring after deployment
- Don't reuse the same event for different purposes

### Monitoring
- Set up off-chain monitoring infrastructure that logs and alerts on events
- Document how to interpret each event and how to audit failures from logs
- Consider automated responses to suspicious patterns (pause, safe mode)
- Implement an incident response plan (see Section 14)

### Event documentation should include
- Purpose of the event
- How it should be used by third parties (oracle, SDK, indexer)
- Assumptions about event ordering and completeness

---

## 8. Token Integration

When integrating with external tokens, verify:

### ERC20 checklist
- [ ] Token has been security reviewed
- [ ] `transfer` and `transferFrom` return a boolean (some don't — use `SafeERC20`)
- [ ] Token mitigates ERC20 race condition on `approve`
- [ ] No fee-on-transfer behavior (deflationary tokens)
- [ ] No external calls in transfer functions (ERC777 hooks → reentrancy)
- [ ] No interest accrual that could get trapped
- [ ] Token is not upgradeable (or upgradeability is understood and acceptable)
- [ ] Owner cannot pause, blacklist, or perform unlimited minting
- [ ] Supply is distributed (not concentrated in few addresses)
- [ ] No flash minting capability

### Known non-standard tokens
Be aware of specific tokens with non-standard behavior:
- **Missing revert**: BAT, HT, cUSDC, ZRX
- **Transfer hooks**: AMP, imBTC (reentrancy risk)
- **Missing return data**: BNB, OMG, USDT
- **Permit no-op**: WETH

---

## 9. Testing Strategy

### Unit tests
- Cover all happy paths, revert cases, edge conditions, and boundary values
- Test event emissions with exact parameter verification
- Test balance invariants (before/after checks)
- Test state consistency via view functions after operations
- Achieve 100% reachable branch and statement coverage

### Test quality
- Tests should be isolated — no dependency on execution order
- Use descriptive test names that explain the scenario
- Follow Arrange-Act-Assert pattern
- Don't test the same thing twice — each test should verify one behavior
- Test code should compile without warnings

### Integration tests
- Test cross-module interactions
- Test upgrade paths end-to-end
- Test with realistic parameter values (not just toy examples)

### Advanced techniques
- **Fuzzing** (Echidna) — find edge cases through random transaction sequences
- **Symbolic execution** (Manticore) — prove properties mathematically
- **Mutation testing** — verify that tests catch intentional bugs
- **Differential testing** — compare assembly/optimized code against reference implementation

---

## 10. Static Analysis

### Slither
Run on every check-in. Triage and resolve all findings.

**Key detectors:**
- Reentrancy vulnerabilities
- Uninitialized state variables
- Unused return values
- Incorrect visibility
- Shadowed state variables
- Unchecked low-level calls

**Key printers:**
- `inheritance-graph` — check for shadowing and C3 linearization issues
- `function-summary` — review visibility and access controls
- `vars-and-auth` — review which functions write to which state variables
- `human-summary` — get a high-level overview of contract complexity

**Specialized tools:**
- `slither-check-upgradeability` — proxy safety checks
- `slither-check-erc` — ERC conformance verification
- `slither-prop` — auto-generate security properties for ERC20

---

## 11. Fuzzing with Echidna

### When to use
- State machine validation — verify no invalid states are reachable
- Access control — verify only authorized users can perform actions
- Arithmetic properties — verify invariants hold across random inputs
- Complex multi-transaction scenarios that are hard to unit test

### Property types
1. **Boolean properties** — functions that return `true` if invariant holds
2. **Assertions** — `assert()` statements that must never fail
3. **Optimization** — find inputs that maximize/minimize a value

### Writing effective properties
```solidity
// Good: specific, testable invariant
function echidna_total_supply_invariant() public view returns (bool) {
    return token.totalSupply() == initialSupply + totalMinted - totalBurned;
}

// Good: access control check
function echidna_only_owner_can_pause() public view returns (bool) {
    if (msg.sender != owner) {
        return !paused; // non-owners should never be able to pause
    }
    return true;
}
```

### Best practices
- Start with simple properties, iterate toward complexity
- Use filtering (modulo operator) to constrain inputs
- Collect corpus for coverage analysis
- Run periodically in CI, not just once
- Handle ETH: use `maxValue` config for payable functions

---

## 12. Security Properties & Invariants

### Categories of properties to verify

| Category | What to check | Recommended tool |
|----------|---------------|------------------|
| **State machine** | No invalid state reachable; all valid states reachable; no trapped states | Echidna, Manticore |
| **Access control** | Only authorized users can perform actions; no privilege escalation | Slither, Echidna |
| **Arithmetic** | No overflow/underflow; rounding is correct; precision loss bounded | Manticore, Echidna |
| **Inheritance** | No shadowing; correct C3 linearization; `super` calls not missed | Slither |
| **External interactions** | Resilient to malicious external contracts; oracle manipulation handled | Echidna, Manticore |
| **Standard conformance** | ERC20/ERC721 behavior matches specification | Slither, Echidna |

### What automated tools CANNOT easily find
- Privacy violations (all transactions are public in the mempool)
- Front-running / sandwich attacks / MEV
- Cryptographic implementation flaws
- Risky interactions with external DeFi protocols
- Social engineering or off-chain vulnerabilities

### Transaction ordering risks (MEV)
- Identify and document all front-running opportunities
- Use time delays and slippage checks where applicable
- Use tamper-resistant oracles
- Test privileged operations for ordering risks
- Document known MEV opportunities visibly for users

---

## 13. Code Maturity Checklist

Self-evaluation framework (rate each area: Missing / Weak / Moderate / Satisfactory / Strong):

### Arithmetic
- [ ] Explicit overflow protection (Solidity 0.8+ or equivalent)
- [ ] All `unchecked` blocks justified and documented
- [ ] Specification matches code for all formulas
- [ ] Rounding direction explicit for all precision-losing operations
- [ ] Parameter ranges bounded and documented
- [ ] Automated testing (fuzzing/formal methods) covers arithmetic

### Access Controls
- [ ] All privileged functions have access control
- [ ] Principle of least privilege followed
- [ ] Different roles with non-overlapping privileges
- [ ] Two-step processes for privileged EOA operations
- [ ] Key loss/leakage does not compromise the system

### Complexity Management
- [ ] Functions have low cyclomatic complexity (< 11)
- [ ] No unnecessary code duplication
- [ ] Clear naming conventions applied consistently
- [ ] Types enforce correctness where possible
- [ ] Each function has a specific, documented purpose

### Testing & Verification
- [ ] All normal use cases tested
- [ ] All tests pass
- [ ] Code coverage measured and reported
- [ ] Automated testing (fuzzing) used for critical components
- [ ] Tests run in CI/CD pipeline
- [ ] Integration tests implemented
- [ ] Test cases are isolated (no order dependency)

### Documentation
- [ ] System architecture documented with diagrams
- [ ] All critical functions documented (NatSpec)
- [ ] Known risks and limitations documented
- [ ] Glossary of terms exists
- [ ] User stories cover all operations
- [ ] Invariants clearly defined in documentation

### Low-level Code
- [ ] Assembly usage is limited and justified
- [ ] Inline comments present for every assembly operation
- [ ] High-level reference implementation exists for complex assembly
- [ ] Differential fuzzing validates assembly against reference
- [ ] No re-implementation of well-established library functionality

---

## 14. Deployment & Incident Response

### Pre-deployment
- Document the full deployment process (including upgrade/migration steps)
- Write and test post-deployment verification scripts
- Use fork testing to validate deployment on a mainnet fork
- Freeze a stable commit before deployment

### Post-deployment
- Monitor contracts — observe logs, set up alerts
- Publish security contact information
- Secure privileged wallets (hardware wallets, multisig)
- Have an incident response plan ready

### Incident response plan
**Application design considerations:**
- Identify which components should be pausable, migratable, upgradeable
- Assess impact of pausing on dependent contracts
- Define system invariants to monitor

**Documentation to prepare:**
- Runbook of common emergency actions (pause, key rotation, upgrade)
- How to interpret event emissions
- How to access wallets with special roles
- Deployment/upgrade verification procedures
- Stakeholder contact procedures

**Process:**
- Designate incident roles: technical lead, communication lead, legal lead
- Conduct periodic training and incident response exercises
- Set up monitoring tools (third-party + in-house)
- Consider automated responses (auto-pause on suspicious activity)

**Threat intelligence:**
- Monitor similar protocols for vulnerabilities
- Follow dependency communication channels
- Maintain contact with dependency maintainers

---

## 15. Pre-Audit Checklist

Before submitting code for security review:

### Resolve easy issues
- [ ] Run Slither — triage all findings
- [ ] Achieve high test coverage
- [ ] Remove dead code, unused libraries, stale features
- [ ] If upgradeable, run `slither-check-upgradeability`
- [ ] If ERC20/721, run `slither-check-erc`

### Make code accessible
- [ ] Provide a detailed list of in-scope files
- [ ] Clear build instructions (verified on fresh environment)
- [ ] Frozen commit hash / branch / release
- [ ] Identify boilerplate, dependencies, and forked code differences

### Documentation
- [ ] Flowcharts and sequence diagrams for primary workflows
- [ ] User stories
- [ ] On-chain / off-chain assumptions (oracles, bridges, data validation)
- [ ] Actor list with roles and privileges
- [ ] Function documentation with inline comments for complex areas
- [ ] System and function invariants documented
- [ ] Parameter ranges (min/max) documented
- [ ] Arithmetic formulas mapped to specification with precision loss expectations
- [ ] Glossary of terms

---

## 16. EVM Internals Quick Reference

### Key concepts
- **Two's complement** — negative numbers represented by flipping bits + 1: `-a = ~a + 1`
- **Signed vs unsigned opcodes** — use `slt`/`sgt` for signed comparisons, `lt`/`gt` for unsigned
- **Sub-32-byte types** — require `signextend` or explicit bounds checking; Solidity may optimize away cleanup
- **Division by zero** — EVM returns 0 (no revert); Solidity adds a check automatically outside assembly

### Critical opcodes for security
| Opcode | Note |
|--------|------|
| `DELEGATECALL` | Executes in caller's storage context — proxy pattern foundation |
| `SELFDESTRUCT` | Deprecated post-Dencun but still exists — can force-send ETH |
| `CREATE2` | Deterministic address — can be used for metamorphic contracts |
| `CALL` | Returns true for addresses with no code — always verify |
| `SSTORE`/`SLOAD` | Expensive — batch storage operations; use transient storage (EIP-1153) where appropriate |

### Gas awareness
- Storage writes (`SSTORE`) are the most expensive operation (~20K gas for cold, 5K for warm)
- Avoid unbounded loops that could exceed block gas limit
- Pack storage variables into 32-byte slots when possible
- Use `calldata` instead of `memory` for read-only function parameters

---

## References

- [Trail of Bits — Building Secure Contracts](https://github.com/crytic/building-secure-contracts)
- [Slither — Static Analysis](https://github.com/crytic/slither)
- [Echidna — Fuzzing](https://github.com/crytic/echidna)
- [Manticore — Symbolic Execution](https://github.com/trailofbits/manticore)
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [EVM Codes Reference](https://evm.codes)
- [Solidity Documentation](https://docs.soliditylang.org)
