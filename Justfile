build:
    npx hardhat compile --force

clean:
    npx hardhat clean

test:
    NO_GAS_ENFORCE=true npx hardhat test

coverage:
    COVERAGE=true npx hardhat test --coverage
    genhtml coverage/lcov.info -o coverage/html

sizes:
    npx hardhat compile --force
    npx tsx ./scripts/contract-sizes.ts

deploy-module module network *args:
    npx hardhat compile --force
    npx tsx scripts/deploy-module.ts --network {{network}} --module {{module}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

deploy-implementation contract network:
    npx hardhat compile --force
    npx tsx scripts/deploy-implementation.ts --network {{network}} --contract {{contract}}

deploy-all network:
    npx hardhat compile --force
    npx tsx scripts/deploy-all.ts --network {{network}}

update-module module proxy network *args:
    npx hardhat compile --force
    npx tsx scripts/update-module.ts --network {{network}} --module {{module}} --proxy-address {{proxy}} {{ if args == "" { "" } else { "--args '[\"" + replace(args, " ", "\",\"") + "\"]'" } }}

upgrade-contract contract proxy network:
    npx hardhat compile --force
    npx tsx scripts/upgrade-contract.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}}

upgrade-implementation contract proxy implementation network:
    npx tsx scripts/upgrade-with-impl.ts --network {{network}} --contract {{contract}} --proxy-address {{proxy}} --impl-address {{implementation}}

attach-module module module-address proxy-address network:
    npx hardhat compile --force
    npx tsx scripts/attach-module.ts --network {{network}} --module {{module}} --module-address {{module-address}} --proxy-address {{proxy-address}}

upgrade-ssv-staking proxy network:
    npx hardhat compile --force
    npx tsx scripts/staking-upgrade.ts --network {{network}} --proxy-address {{proxy}}

verify address network:
    npx hardhat verify --network "{{network}}" "{{address}}"

abis:
  npx hardhat compile --force
  npx tsx scripts/common/export-abis.ts

# === Canonical Fork/Deploy Workflow ===
# Local fork defaults to anvil at http://127.0.0.1:8545.
# Override profile files with FORK_CONFIG_PATH / FORK_RESULT_PATH.

# Upgrade + configure on local fork (writes result JSON)
upgrade-fork:
    npx hardhat compile --force
    npx tsx scripts/upgrade-fork.ts --network ${FORK_NETWORK:-local} --config ${FORK_CONFIG_PATH:-deployments/hoodi-upgrade.config.json} --output-config ${FORK_RESULT_PATH:-deployments/hoodi-upgrade.result.json}

# Strict tests against deployed instances from result JSON (no fallback)
test-fork:
    npx hardhat compile --force
    npx tsx scripts/run-forked-local-tests.ts --fork-network ${FORK_TEST_NETWORK:-hardhat_forked} --config ${FORK_RESULT_PATH:-deployments/hoodi-upgrade.result.json} --use-deployed-state true --strict-deployed-state true --allow-deployed-fallback false --no-gas-enforce true

# End-to-end local fork validation: upgrade first, then strict tests
upgrade-test-fork:
    just upgrade-fork
    just test-fork

# Live Hoodi upgrade (non-impersonating owner flow)
upgrade-hoodi:
    npx hardhat compile --force
    npx tsx scripts/upgrade-hoodi.ts --network hoodi --config ${HOODI_CONFIG_PATH:-deployments/hoodi-upgrade.config.json} --output-config ${HOODI_RESULT_PATH:-deployments/hoodi-upgrade.result.json}

# Mainnet deploy-only flow (modules + CSSVToken, no upgrade)
deploy-mainnet:
    npx hardhat compile --force
    npx tsx scripts/deploy-mainnet.ts --network mainnet --config ${MAINNET_DEPLOY_CONFIG_PATH:-deployments/mainnet-upgrade.config.json} --output-config ${MAINNET_DEPLOY_RESULT_PATH:-deployments/mainnet-upgrade.result.json}
