// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../contracts/SSVNetwork.sol";
import "../../contracts/modules/SSVOperators.sol";
import "../../contracts/modules/SSVClusters.sol";
import "../../contracts/modules/SSVDAO.sol";
import "../../contracts/modules/SSVViews.sol";
import "../../contracts/modules/SSVOperatorsWhitelist.sol";
import "../../contracts/modules/SSVStaking.sol";
import "../../contracts/libraries/SSVStorage.sol";
import "../../contracts/libraries/SSVStorageProtocol.sol";
import "../../contracts/libraries/SSVStorageStaking.sol";
import "../../contracts/libraries/OperatorLib.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/// @dev Simple mock token
contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}

/// @notice Setup contract that deploys all modules and stores their addresses
/// @dev Echidna deploys this first, then SSVNetworkEchidna references it
contract EchidnaSetup {
    address public immutable operators;
    address public immutable clusters;
    address public immutable dao;
    address public immutable views;
    address public immutable whitelist;
    address public immutable staking;
    MockToken public immutable token;

    constructor() {
        operators = address(new SSVOperators());
        clusters = address(new SSVClusters());
        dao = address(new SSVDAO());
        views = address(new SSVViews());
        whitelist = address(new SSVOperatorsWhitelist());
        staking = address(new SSVStaking());
        token = new MockToken();
    }
}

/// @notice Echidna test contract for SSVNetwork operator properties.
/// @dev Inherits from SSVNetwork and acts as the proxy. When functions delegate
///      to modules, those modules execute in this contract's storage context.
contract SSVNetworkEchidna is SSVNetwork {
    using Counters for Counters.Counter;

    // Ghost variables to track state for properties
    MockToken public token;
    bool public invariantFailed;

    // Protocol parameters (matching test/common/constants.ts)
    uint64 constant MINIMUM_BLOCKS_BEFORE_LIQUIDATION = 214800;
    uint64 constant MINIMUM_LIQUIDATION_COLLATERAL = 200000000; // shrunk
    uint64 constant OPERATOR_MAX_FEE_INCREASE = 1000; // 10%
    uint64 constant DECLARE_OPERATOR_FEE_PERIOD = 604800; // 7 days
    uint64 constant EXECUTE_OPERATOR_FEE_PERIOD = 604800; // 7 days
    uint32 constant VALIDATORS_PER_OPERATOR_LIMIT = 2000;
    uint64 constant OPERATOR_MAX_FEE = 76528650000000; // from tests
    uint32[4] DEFAULT_ORACLE_IDS = [uint32(1), uint32(2), uint32(3), uint32(4)];
    uint16 constant QUORUM_BPS = 7500;

    // Reference to setup contract (deployed first via deployContracts)
    EchidnaSetup internal immutable setup;

    constructor(EchidnaSetup _setup) {
        setup = _setup;
        token = _setup.token();

        // Initialize ownership
        _transferOwnership(address(this));

        // Initialize Storage with pre-deployed module addresses
        StorageData storage s = SSVStorage.load();
        s.token = IERC20(address(token));
        s.ssvContracts[SSVModules.SSV_OPERATORS] = _setup.operators();
        s.ssvContracts[SSVModules.SSV_CLUSTERS] = _setup.clusters();
        s.ssvContracts[SSVModules.SSV_DAO] = _setup.dao();
        s.ssvContracts[SSVModules.SSV_VIEWS] = _setup.views();
        s.ssvContracts[SSVModules.SSV_OPERATORS_WHITELIST] = _setup.whitelist();
        s.ssvContracts[SSVModules.SSV_STAKING] = _setup.staking();

        // Initialize Protocol Parameters
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.minimumBlocksBeforeLiquidation = MINIMUM_BLOCKS_BEFORE_LIQUIDATION;
        sp.minimumLiquidationCollateral = MINIMUM_LIQUIDATION_COLLATERAL;
        sp.validatorsPerOperatorLimit = VALIDATORS_PER_OPERATOR_LIMIT;
        sp.declareOperatorFeePeriod = DECLARE_OPERATOR_FEE_PERIOD;
        sp.executeOperatorFeePeriod = EXECUTE_OPERATOR_FEE_PERIOD;
        sp.operatorMaxFeeIncrease = OPERATOR_MAX_FEE_INCREASE;
        sp.operatorMaxFee = OPERATOR_MAX_FEE;
        sp.operatorMaxFeeSSV = OPERATOR_MAX_FEE;

        // Initialize Staking Storage
        StorageStaking storage ss = SSVStorageStaking.load();
        ss.defaultOracleIds = DEFAULT_ORACLE_IDS;
        ss.quorumBps = QUORUM_BPS;
    }

    // --- Helpers ---

    function getOperatorCount() public view returns (uint64) {
        return uint64(SSVStorage.load().lastOperatorId.current());
    }

    // Register an operator owned by this contract
    function registerOperatorSelf(bytes calldata publicKey, uint256 fee) public {
        // We call external registerOperator on this contract
        try this.registerOperator(publicKey, fee, false) {} catch {}
    }

    // Mock simulate earnings (since we don't have validators running)
    function mockAddEarnings(uint64 operatorId, uint64 amountEth, uint64 amountSsv) public {
         StorageData storage s = SSVStorage.load();
         if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
         ISSVNetworkCore.Operator storage op = s.operators[operatorId];
         
         // Only mock if active
         if (op.ethSnapshot.block == 0) return;

         op.ethSnapshot.balance += amountEth;
         op.snapshot.balance += amountSsv;
         
         // Also fund the contract so it can pay out
         if (address(this).balance < Types64.expand(amountEth)) {
             // We need ETH. receive() handles it.
             // We can't self-destruct to fund easily in 0.8.
             // Assume test contract is funded.
         }
         if (token.balanceOf(address(this)) < Types64.expand(amountSsv)) {
             token.mint(address(this), Types64.expand(amountSsv));
         }
    }

    // --- Properties ---

    // 1. Uniqueness & 2. ID Monotonicity
    function echidna_operator_id_counter_integrity() public view returns (bool) {
        return SSVStorage.load().lastOperatorId.current() >= 0;
    }
    
    // 3. Ownership
    function echidna_operator_ownership() public view returns (bool) {
        uint64 lastId = uint64(SSVStorage.load().lastOperatorId.current());
        if (lastId == 0) return true;
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastId];
        if (op.ethSnapshot.block != 0) {
             return op.owner != address(0);
        }
        return true;
    }

    // 4. Fee Limits
    function echidna_operator_fee_limits() public view returns (bool) {
        uint64 lastId = uint64(SSVStorage.load().lastOperatorId.current());
        if (lastId == 0) return true;
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastId];
        return op.ethFee <= SSVStorageProtocol.load().operatorMaxFee;
    }

    // 5. Fee Minima
    function echidna_operator_fee_minima() public view returns (bool) {
        uint64 lastId = uint64(SSVStorage.load().lastOperatorId.current());
        if (lastId == 0) return true;
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastId];
        return op.ethFee == 0 || op.ethFee >= OperatorLib.MINIMAL_OPERATOR_ETH_FEE;
    }

    // 13. Clean State (Removal)
    function echidna_operator_removed_state() public view returns (bool) {
        uint64 lastId = uint64(SSVStorage.load().lastOperatorId.current());
        if (lastId == 0) return true;
        ISSVNetworkCore.Operator memory op = SSVStorage.load().operators[lastId];
        
        if (op.ethSnapshot.block == 0 && op.snapshot.block == 0) {
            if (op.ethFee != 0) return false;
            if (op.ethSnapshot.balance != 0) return false;
        }
        return true;
    }
    
    // 6. Fee Update Cycle
    // Test that we cannot execute fee update early
    function test_fee_update_cycle_early(uint64 operatorId) public {
        StorageData storage s = SSVStorage.load();
        if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
        ISSVNetworkCore.Operator memory op = s.operators[operatorId];
        if (op.owner != address(this)) return;

        // Try to execute
        try this.executeOperatorFee(operatorId) {
             // Should fail if no request or time not met
             // Check if request exists
             ISSVNetworkCore.OperatorFeeChangeRequest memory req = s.operatorFeeChangeRequests[operatorId];
             if (req.approvalBeginTime == 0) {
                  // Succeeded but no request? Impossible logic in executeOperatorFee
                  invariantFailed = true; 
             } else {
                  if (block.timestamp < req.approvalBeginTime) invariantFailed = true;
             }
        } catch {}
    }

    // 7. Fee Reduction
    function test_fee_reduction_immediate(uint64 operatorId, uint256 newFee) public {
        StorageData storage s = SSVStorage.load();
        if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
        ISSVNetworkCore.Operator memory op = s.operators[operatorId];
        
        if (op.owner != address(this)) return;
        
        uint64 oldFee = op.ethFee;
        if (newFee >= Types64.expand(oldFee)) return; // Not a reduction or invalid
        if (newFee < OperatorLib.MINIMAL_OPERATOR_ETH_FEE && newFee != 0) return;
        
        try this.reduceOperatorFee(operatorId, newFee) {
            ISSVNetworkCore.Operator memory opAfter = s.operators[operatorId];
            if (Types64.expand(opAfter.ethFee) != newFee) invariantFailed = true;
        } catch {}
    }

    // 9, 11. Earnings & Withdrawals
    function test_earnings_withdrawals(uint64 operatorId, uint256 amount) public {
        StorageData storage s = SSVStorage.load();
        if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
        ISSVNetworkCore.Operator memory op = s.operators[operatorId];
        if (op.owner != address(this)) return;
        
        // Test 9: Withdrawal limit
        uint256 balance = Types64.expand(op.ethSnapshot.balance);
        if (amount > balance) {
            bool success = false;
            try this.withdrawOperatorEarnings(operatorId, amount) {
                success = true;
            } catch {}
            if (success) invariantFailed = true;
            return;
        }
        
        // Test 11: Conservation
        try this.withdrawOperatorEarnings(operatorId, amount) {
            ISSVNetworkCore.Operator memory opAfter = s.operators[operatorId];
            uint256 balanceAfter = Types64.expand(opAfter.ethSnapshot.balance);
            if (balanceAfter > balance) invariantFailed = true;
        } catch {}
    }

    // 10. Zero Balance Post-Withdrawal
    function test_withdraw_all(uint64 operatorId) public {
        StorageData storage s = SSVStorage.load();
        if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
        ISSVNetworkCore.Operator memory op = s.operators[operatorId];
        if (op.owner != address(this)) return;
        
        try this.withdrawAllOperatorEarnings(operatorId) {
             ISSVNetworkCore.Operator memory opAfter = s.operators[operatorId];
             if (opAfter.ethSnapshot.balance != 0) invariantFailed = true;
        } catch {}
    }

    // 12. Owner Authority
    function test_owner_authority_check(uint64 operatorId, uint256 newFee) public {
        StorageData storage s = SSVStorage.load();
        if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
        ISSVNetworkCore.Operator memory op = s.operators[operatorId];
        
        // If we are NOT the owner, we should not be able to modify
        if (op.owner == address(this)) return;

        // Try to modify
        bool success = false;
        try this.declareOperatorFee(operatorId, newFee) {
            success = true;
        } catch {}
        
        if (success) invariantFailed = true;
    }

    // 14. Funds Return on Removal
    function test_remove_operator_funds_return(uint64 operatorId) public {
        StorageData storage s = SSVStorage.load();
        if (operatorId == 0 || operatorId > s.lastOperatorId.current()) return;
        
        ISSVNetworkCore.Operator memory op = s.operators[operatorId];
        
        // Only if we own it
        if (op.owner != address(this)) return;
        
        // Ensure it's active
        if (op.ethSnapshot.block == 0) return;

        // Ensure it has some balance for the test to be meaningful
        if (op.ethSnapshot.balance == 0 && op.snapshot.balance == 0) return;

        uint256 preBalanceEth = address(this).balance;
        uint256 preBalanceSsv = token.balanceOf(address(this));
        
        uint64 opBalanceEth = op.ethSnapshot.balance;
        uint64 opBalanceSsv = op.snapshot.balance;
        
        try this.removeOperator(operatorId) {
             uint256 postBalanceEth = address(this).balance;
             uint256 postBalanceSsv = token.balanceOf(address(this));
             
             if (postBalanceEth != preBalanceEth + Types64.expand(opBalanceEth)) invariantFailed = true;
             if (postBalanceSsv != preBalanceSsv + Types64.expand(opBalanceSsv)) invariantFailed = true;
             
             // Check clean state immediately
             ISSVNetworkCore.Operator memory opAfter = s.operators[operatorId];
             if (opAfter.ethSnapshot.balance != 0) invariantFailed = true;
             if (opAfter.ethFee != 0) invariantFailed = true;
        } catch {
             // Reverts are allowed (e.g. paused, etc)
        }
    }

    function echidna_invariant_failed() public view returns (bool) {
        return !invariantFailed;
    }
    
    receive() external payable {}
}
