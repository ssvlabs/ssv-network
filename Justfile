# Compile all contracts from scratch (force recompile)
build:
    npx hardhat compile --force

# Remove Hardhat build artifacts and cache
clean:
    npx hardhat clean

# Run test suite without gas enforcement (allows larger txs)
test:
    NO_GAS_ENFORCE=true npx hardhat test

# Run tests with coverage report, then generate HTML report
coverage:
    COVERAGE=true npx hardhat test --coverage
    genhtml coverage/lcov.info -o coverage/html

# Compile contracts and display contract bytecode sizes
sizes:
    npx hardhat compile --force
    npx tsx ./scripts/contract-sizes.ts

# Deploy a specific module contract (e.g., SSVOperators, SSVClusters)
# Args: module=<name> network=<name> [args=constructor_args]
deploy-module module network *args:
    npx hardhat compile --force
    npx tsx scripts/deploy-module.ts --network {{network}} --module {{module}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

# Deploy an implementation contract (for proxy upgrades)
# Args: contract=<name> network=<name>
deploy-implementation contract network:
    npx hardhat compile --force
    npx tsx scripts/deploy-implementation.ts --network {{network}} --contract {{contract}}

# Deploy all contracts for a fresh deployment
# Args: network=<name>
deploy-all network:
    npx hardhat compile --force
    npx tsx scripts/deploy-all.ts --network {{network}}

# Update/replace a module in the proxy (hot-swap module)
# Args: module=<name> proxy=<address> network=<name> [args=init_args]
update-module module proxy network *args:
    npx hardhat compile --force
    npx tsx scripts/update-module.ts --network {{network}} --module {{module}} --proxy-address {{proxy}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

# Upgrade a contract via UUPS proxy pattern
# Args: contract=<name> proxy=<address> network=<name>
upgrade-contract contract proxy network:
    npx hardhat compile --force
    npx tsx scripts/upgrade-contract.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}}

# Upgrade proxy to a specific implementation address
# Args: contract=<name> proxy=<address> implementation=<address> network=<name>
upgrade-implementation contract proxy implementation network:
    npx tsx scripts/upgrade-with-impl.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}} --impl-address {{implementation}}

# Attach an existing deployed module to the proxy
# Args: module=<name> module-address=<address> proxy-address=<address> network=<name>
attach-module module module-address proxy-address network:
    npx hardhat compile --force
    npx tsx scripts/attach-module.ts --network {{network}} --module {{module}} --module-address {{module-address}} --proxy-address {{proxy-address}}

# Special upgrade task for SSVStaking module (handles CSSVToken integration)
# Args: proxy=<address> network=<name>
upgrade-ssv-staking proxy network:
    npx hardhat compile --force
    npx tsx scripts/staking-upgrade.ts --network {{network}} --proxy-address {{proxy}}

# Verify contract source code on Etherscan/block explorer
# Args: address=<contract_address> network=<name>
verify address network:
    npx hardhat verify --network "{{network}}" "{{address}}"

# Export contract ABIs to JSON files for external use
abis:
  npx hardhat compile --force
  npx tsx scripts/common/export-abis.ts

# === Canonical Fork/Deploy Workflow ===
# Local fork defaults to anvil at http://127.0.0.1:8545.
# Override profile files with FORK_CONFIG_PATH / FORK_RESULT_PATH.

# Upgrade and configure on local fork (writes result to JSON)
# Uses FORK_NETWORK, FORK_CONFIG_PATH, FORK_RESULT_PATH env vars
upgrade-fork:
    npx hardhat compile --force
    npx tsx scripts/upgrade-fork.ts --network ${FORK_NETWORK:-local} --config ${FORK_CONFIG_PATH:-deployments/hoodi-upgrade.config.json} --output-config ${FORK_RESULT_PATH:-deployments/hoodi-upgrade.result.json}

# Run strict tests against deployed instances from fork result JSON (no fallback)
# Uses FORK_TEST_NETWORK, FORK_RESULT_PATH env vars
test-fork:
    npx hardhat compile --force
    npx tsx scripts/run-forked-local-tests.ts --fork-network ${FORK_TEST_NETWORK:-hardhat_forked} --config ${FORK_RESULT_PATH:-deployments/hoodi-upgrade.result.json} --use-deployed-state true --strict-deployed-state true --allow-deployed-fallback false --no-gas-enforce true

# End-to-end fork workflow: upgrade then run strict tests
upgrade-test-fork:
    just upgrade-fork
    just test-fork

# Execute live upgrade on Hoodi testnet (non-impersonating owner flow)
# Uses HOODI_CONFIG_PATH, HOODI_RESULT_PATH env vars
upgrade-hoodi:
    npx hardhat compile --force
    npx tsx scripts/upgrade-hoodi.ts --network hoodi --config ${HOODI_CONFIG_PATH:-deployments/hoodi-upgrade.config.json} --output-config ${HOODI_RESULT_PATH:-deployments/hoodi-upgrade.result.json}

# Mainnet deploy-only flow (modules + CSSVToken, no proxy upgrade)
# Uses MAINNET_DEPLOY_CONFIG_PATH, MAINNET_DEPLOY_RESULT_PATH env vars
deploy-mainnet:
    npx hardhat compile --force
    npx tsx scripts/deploy-mainnet.ts --network mainnet --config ${MAINNET_DEPLOY_CONFIG_PATH:-deployments/mainnet-upgrade.config.json} --output-config ${MAINNET_DEPLOY_RESULT_PATH:-deployments/mainnet-upgrade.result.json}

# Prepare upgrade deployment bundle (staking/views implementations + modules + CSSVToken)
# Args: rpc-url=<url>
# Uses PREPARE_UPGRADE_CONFIG_PATH, PREPARE_UPGRADE_RESULT_PATH env vars
prepare-upgrade rpc-url:
    npx hardhat compile --force
    npx tsx scripts/prepare-upgrade.ts --network mainnet --rpc-url "{{rpc-url}}" --config ${PREPARE_UPGRADE_CONFIG_PATH:-deployments/prepare-upgrade.config.json} --output-config ${PREPARE_UPGRADE_RESULT_PATH:-deployments/prepare-upgrade.result.json}

# Prepare testnet upgrade bundle (staking/views implementations + modules, no CSSVToken deploy)
# Args: rpc-url=<url>
# Uses PREPARE_UPGRADE_TESTNET_CONFIG_PATH, PREPARE_UPGRADE_TESTNET_RESULT_PATH env vars
prepare-upgrade-testnet rpc-url:
    npx hardhat compile --force
    npx tsx scripts/prepare-upgrade-testnet.ts --network hoodi --rpc-url "{{rpc-url}}" --config ${PREPARE_UPGRADE_TESTNET_CONFIG_PATH:-deployments/prepare-upgrade-testnet.config.json} --output-config ${PREPARE_UPGRADE_TESTNET_RESULT_PATH:-deployments/prepare-upgrade-testnet.result.json}
