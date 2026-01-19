// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/SSVNetwork.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "../../contracts/libraries/Types.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/// @dev Simple mock token
contract MockSSVToken is ERC20 {
    constructor() ERC20("SSV", "SSV") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Minimal Echidna test contract for SSVOperators properties.
/// @dev Uses composition - deploys only the operators module and minimal deps.
///      Does NOT deploy full SSVNetwork to reduce constructor gas.
contract SSVOperatorsEchidna {
    using Counters for Counters.Counter;
    using Types64 for uint64;

    // The operators module we're testing
    SSVOperators public immutable operatorsModule;
    MockSSVToken public immutable token;

    // Ghost variables for properties
    bool public invariantFailed;
    mapping(uint64 => address) public operatorOwners;
    mapping(uint64 => uint64) public operatorFees;
    uint64 public lastRegisteredId;

    // Protocol parameters
    uint64 constant OPERATOR_MAX_FEE = 76528650000000;
    uint64 constant OPERATOR_MAX_FEE_INCREASE = 1000; // 10%
    uint64 constant DECLARE_OPERATOR_FEE_PERIOD = 604800; // 7 days
    uint64 constant EXECUTE_OPERATOR_FEE_PERIOD = 604800; // 7 days
    uint32 constant VALIDATORS_PER_OPERATOR_LIMIT = 2000;
    uint64 constant MINIMAL_OPERATOR_FEE = 100000000; // from OperatorLib

    constructor() {
        // Deploy only the operators module
        operatorsModule = new SSVOperators();
        token = new MockSSVToken();

        // Initialize protocol storage directly (since we're testing the module in isolation)
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.operatorMaxFee = OPERATOR_MAX_FEE;
        sp.operatorMaxFeeSSV = OPERATOR_MAX_FEE;
        sp.operatorMaxFeeIncrease = OPERATOR_MAX_FEE_INCREASE;
        sp.declareOperatorFeePeriod = DECLARE_OPERATOR_FEE_PERIOD;
        sp.executeOperatorFeePeriod = EXECUTE_OPERATOR_FEE_PERIOD;
        sp.validatorsPerOperatorLimit = VALIDATORS_PER_OPERATOR_LIMIT;

        // Initialize main storage
        StorageData storage s = SSVStorage.load();
        s.token = IERC20(address(token));
    }

    // --- Test Functions (stateful) ---

    /// @notice Register an operator and track its state
    function test_registerOperator(bytes calldata publicKey, uint256 fee) public {
        // Bound fee to valid range
        uint64 feeShrunk = uint64(fee % (OPERATOR_MAX_FEE + 1));
        if (feeShrunk < MINIMAL_OPERATOR_FEE) {
            feeShrunk = MINIMAL_OPERATOR_FEE;
        }
        uint256 feeExpanded = uint256(feeShrunk) * 10_000_000;

        // Get current operator count before registration
        uint64 prevCount = uint64(SSVStorage.load().lastOperatorId.current());

        // Call registerOperator via delegatecall to share storage context
        (bool success, bytes memory returnData) = address(operatorsModule).delegatecall(
            abi.encodeWithSelector(
                SSVOperators.registerOperator.selector,
                publicKey,
                feeExpanded,
                false // setPrivate
            )
        );

        if (success) {
            uint64 operatorId = abi.decode(returnData, (uint64));
            
            // Track ghost state
            operatorOwners[operatorId] = msg.sender;
            operatorFees[operatorId] = feeShrunk;
            lastRegisteredId = operatorId;

            // Property: ID should be previous count + 1
            uint64 newCount = uint64(SSVStorage.load().lastOperatorId.current());
            if (operatorId != prevCount + 1 || newCount != prevCount + 1) {
                invariantFailed = true;
            }
        }
    }

    /// @notice Remove an operator
    function test_removeOperator(uint64 operatorId) public {
        if (operatorId == 0 || operatorOwners[operatorId] == address(0)) return;
        if (operatorOwners[operatorId] != msg.sender) return;

        (bool success, ) = address(operatorsModule).delegatecall(
            abi.encodeWithSelector(SSVOperators.removeOperator.selector, operatorId)
        );

        if (success) {
            // Clear ghost state
            operatorOwners[operatorId] = address(0);
            operatorFees[operatorId] = 0;

            // Property: operator should be removed from storage
            ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[operatorId];
            if (op.owner != address(0)) {
                invariantFailed = true;
            }
        }
    }

    // --- Properties ---

    /// @notice Property: No invariant violations detected
    function echidna_no_invariant_failed() public view returns (bool) {
        return !invariantFailed;
    }

    /// @notice Property: Registered operator has correct owner
    function echidna_operator_ownership_integrity() public view returns (bool) {
        if (lastRegisteredId == 0) return true;
        
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastRegisteredId];
        address expectedOwner = operatorOwners[lastRegisteredId];
        
        // If we tracked an owner, it should match storage (unless removed)
        if (expectedOwner != address(0) && op.owner != expectedOwner) {
            return false;
        }
        return true;
    }

    /// @notice Property: Operator fee is within bounds
    function echidna_operator_fee_within_bounds() public view returns (bool) {
        if (lastRegisteredId == 0) return true;
        
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastRegisteredId];
        if (op.owner == address(0)) return true; // Removed operator
        
        uint64 fee = op.fee;
        return fee >= MINIMAL_OPERATOR_FEE && fee <= OPERATOR_MAX_FEE;
    }

    /// @notice Property: Operator IDs are sequential
    function echidna_operator_ids_sequential() public view returns (bool) {
        uint64 count = uint64(SSVStorage.load().lastOperatorId.current());
        return lastRegisteredId <= count;
    }
}
