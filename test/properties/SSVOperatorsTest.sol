// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "../../contracts/libraries/Types.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/// @dev Mock token - minimal implementation
contract MockSSV is ERC20 {
    constructor() ERC20("SSV", "SSV") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @notice Echidna test for SSVOperators using pre-deployed module
/// @dev Modules are deployed at fixed addresses via Echidna deployContracts config
contract SSVOperatorsTest {
    using Counters for Counters.Counter;
    using Types64 for uint64;

    // Pre-deployed addresses (set in echidna-operators.yaml deployContracts)
    address constant OPERATORS_MODULE = 0x1000000000000000000000000000000000000001;
    address constant TOKEN_ADDR = 0x1000000000000000000000000000000000000002;

    // Protocol parameters
    uint64 constant OPERATOR_MAX_FEE = 76528650000000;
    uint64 constant OPERATOR_MAX_FEE_INCREASE = 1000;
    uint64 constant DECLARE_OPERATOR_FEE_PERIOD = 604800;
    uint64 constant EXECUTE_OPERATOR_FEE_PERIOD = 604800;
    uint32 constant VALIDATORS_PER_OPERATOR_LIMIT = 2000;
    uint64 constant MINIMAL_OPERATOR_FEE = 100000000;

    // Ghost state for properties
    bool public invariantFailed;
    mapping(uint64 => address) public trackedOwners;
    mapping(uint64 => uint64) public trackedFees;
    uint64 public lastOpId;

    constructor() {
        // Initialize protocol storage (no contract deployments)
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.operatorMaxFee = OPERATOR_MAX_FEE;
        sp.operatorMaxFeeSSV = OPERATOR_MAX_FEE;
        sp.operatorMaxFeeIncrease = OPERATOR_MAX_FEE_INCREASE;
        sp.declareOperatorFeePeriod = DECLARE_OPERATOR_FEE_PERIOD;
        sp.executeOperatorFeePeriod = EXECUTE_OPERATOR_FEE_PERIOD;
        sp.validatorsPerOperatorLimit = VALIDATORS_PER_OPERATOR_LIMIT;

        // Set token in storage (pre-deployed at TOKEN_ADDR)
        StorageData storage s = SSVStorage.load();
        s.token = IERC20(TOKEN_ADDR);
    }

    // --- Test Functions ---

    function test_registerOperator(bytes calldata pubKey, uint256 rawFee) public {
        // Bound fee to valid range
        uint64 fee = uint64(rawFee % (OPERATOR_MAX_FEE + 1));
        if (fee < MINIMAL_OPERATOR_FEE) fee = MINIMAL_OPERATOR_FEE;
        uint256 feeExpanded = uint256(fee) * 10_000_000;

        uint64 prevCount = uint64(SSVStorage.load().lastOperatorId.current());

        // Delegatecall to operators module
        (bool ok, bytes memory ret) = OPERATORS_MODULE.delegatecall(
            abi.encodeWithSelector(
                ISSVOperators.registerOperator.selector,
                pubKey,
                feeExpanded,
                false
            )
        );

        if (ok) {
            uint64 opId = abi.decode(ret, (uint64));
            trackedOwners[opId] = msg.sender;
            trackedFees[opId] = fee;
            lastOpId = opId;

            // Verify ID is sequential
            if (opId != prevCount + 1) {
                invariantFailed = true;
            }
        }
    }

    function test_removeOperator(uint64 opId) public {
        if (opId == 0 || trackedOwners[opId] == address(0)) return;
        if (trackedOwners[opId] != msg.sender) return;

        (bool ok, ) = OPERATORS_MODULE.delegatecall(
            abi.encodeWithSelector(ISSVOperators.removeOperator.selector, opId)
        );

        if (ok) {
            trackedOwners[opId] = address(0);
            trackedFees[opId] = 0;

            // Verify removal
            ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[opId];
            if (op.owner != address(0)) {
                invariantFailed = true;
            }
        }
    }

    // --- Properties ---

    function echidna_no_invariant_failed() public view returns (bool) {
        return !invariantFailed;
    }

    function echidna_operator_fee_bounds() public view returns (bool) {
        if (lastOpId == 0) return true;
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastOpId];
        if (op.owner == address(0)) return true;
        return op.fee >= MINIMAL_OPERATOR_FEE && op.fee <= OPERATOR_MAX_FEE;
    }

    function echidna_ids_sequential() public view returns (bool) {
        uint64 count = uint64(SSVStorage.load().lastOperatorId.current());
        return lastOpId <= count;
    }

    function echidna_ownership_integrity() public view returns (bool) {
        if (lastOpId == 0) return true;
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastOpId];
        address expected = trackedOwners[lastOpId];
        if (expected == address(0)) return true; // removed
        return op.owner == expected;
    }
}
