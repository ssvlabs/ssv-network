// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "./ISSVNetworkLogic.sol";
import "./SSVNetwork.sol";
import "./libraries/Types.sol";
import "./libraries/OperatorLib.sol";
import "./libraries/ClusterLib.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract SSVNetworkLogic is UUPSUpgradeable, Ownable2StepUpgradeable, ISSVNetworkLogic {
    using Types256 for uint256;
    using Types64 for uint64;
    using OperatorLib for Operator;
    using ClusterLib for Cluster;

    ISSVNetwork _ssvNetwork;

    // @dev reserve storage space for future new state variables in base contract
    // slither-disable-next-line shadowing-state
    uint256[50] __gap;

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function initialize(ISSVNetwork ssvNetwork_) external initializer onlyProxy {
        __UUPSUpgradeable_init();
        __Ownable_init_unchained();
        _ssvNetwork = ssvNetwork_;
    }

    function removeOperator(
        Operator memory operator,
        address owner
    ) external view override returns (uint64 currentBalance) {
        operator.checkOwner(owner);

        operator.updateSnapshot();
        currentBalance = operator.snapshot.balance;

        operator.snapshot.block = 0;
        operator.snapshot.balance = 0;
        operator.validatorCount = 0;
        operator.fee = 0;
    }

    function declareOperatorFee(
        Operator memory operator,
        address owner,
        uint256 fee,
        uint64 minimalOperatorFee,
        uint64 operatorMaxFeeIncrease,
        uint64 declareOperatorFeePeriod,
        uint64 executeOperatorFeePeriod
    ) external view override returns (OperatorFeeChangeRequest memory feeChangeRequest) {
        operator.checkOwner(owner);

        if (fee != 0 && fee < minimalOperatorFee) revert FeeTooLow();
        uint64 operatorFee = operator.fee;
        uint64 shrunkFee = fee.shrink();

        if (operatorFee == shrunkFee) {
            revert SameFeeChangeNotAllowed();
        } else if (shrunkFee != 0 && operatorFee == 0) {
            revert FeeIncreaseNotAllowed();
        }

        // @dev 100%  =  10000, 10% = 1000 - using 10000 to represent 2 digit precision
        uint64 maxAllowedFee = (operatorFee * (10000 + operatorMaxFeeIncrease)) / 10000;

        if (shrunkFee > maxAllowedFee) revert FeeExceedsIncreaseLimit();

        feeChangeRequest = OperatorFeeChangeRequest(
            shrunkFee,
            uint64(block.timestamp) + declareOperatorFeePeriod,
            uint64(block.timestamp) + declareOperatorFeePeriod + executeOperatorFeePeriod
        );
    }

    function executeOperatorFee(
        Operator memory operator,
        address owner,
        OperatorFeeChangeRequest memory feeChangeRequest
    ) external view override returns (Operator memory) {
        operator.checkOwner(owner);

        if (feeChangeRequest.approvalBeginTime == 0) revert NoFeeDelcared();

        if (
            block.timestamp < feeChangeRequest.approvalBeginTime || block.timestamp > feeChangeRequest.approvalEndTime
        ) {
            revert ApprovalNotWithinTimeframe();
        }

        operator.updateSnapshot();
        operator.fee = feeChangeRequest.fee;

        return operator;
    }

    function reduceOperatorFee(
        Operator memory operator,
        address owner,
        uint256 fee
    ) external view override returns (Operator memory) {
        operator.checkOwner(owner);

        uint64 shrunkAmount = fee.shrink();
        if (shrunkAmount >= operator.fee) revert FeeIncreaseNotAllowed();

        operator.updateSnapshot();
        operator.fee = shrunkAmount;

        return operator;
    }

    function withdrawOperatorEarnings(Operator memory operator, address owner, uint256 amount) external view {
        operator.checkOwner(owner);
        operator.updateSnapshot();

        uint64 shrunkAmount;

        if (amount == 0 && operator.snapshot.balance > 0) {
            shrunkAmount = operator.snapshot.balance;
        } else if (amount > 0 && operator.snapshot.balance >= amount.shrink()) {
            shrunkAmount = amount.shrink();
        } else {
            revert InsufficientBalance();
        }

        operator.snapshot.balance -= shrunkAmount;
    }

    // Validators
    function removeValidator(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        uint64 currentNetworkFeeIndex
    ) external view returns (Operator[] memory, bytes32) {
        uint64 clusterIndex;
        {
            if (cluster.active) {
                for (uint i; i < processedOperators.length; ) {
                    Operator memory operator = processedOperators[i];
                    if (operator.snapshot.block != 0) {
                        operator.updateSnapshot();
                        --operator.validatorCount;
                        //operators[operatorIds[i]] = operator;
                        processedOperators[i] = operator;
                    }

                    clusterIndex += operator.snapshot.index;
                    unchecked {
                        ++i;
                    }
                }

                cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);
            }
        }

        --cluster.validatorCount;
        bytes32 hashedClusterData = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );

        return (processedOperators, hashedClusterData);
    }

    function reactivate(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        uint256 amount,
        uint64 networkFee,
        uint64 currentNetworkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) external view returns (Operator[] memory, bytes32) {
        if (cluster.active) revert ClusterAlreadyEnabled();
        {
            uint64 clusterIndex;
            uint64 burnRate;

            for (uint i; i < processedOperators.length; ) {
                Operator memory operator = processedOperators[i];
                if (operator.snapshot.block != 0) {
                    operator.updateSnapshot();
                    operator.validatorCount += cluster.validatorCount;
                    burnRate += operator.fee;
                    processedOperators[i] = operator;
                }

                clusterIndex += operator.snapshot.index;
                unchecked {
                    ++i;
                }
            }

            cluster.balance += amount;
            cluster.active = true;
            cluster.index = clusterIndex;
            cluster.networkFeeIndex = currentNetworkFeeIndex;

            cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);

            if (
                cluster.isLiquidatable(
                    burnRate,
                    networkFee,
                    minimumBlocksBeforeLiquidation,
                    minimumLiquidationCollateral
                )
            ) {
                revert InsufficientBalance();
            }
        }

        return (
            processedOperators,
            keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.active
                )
            )
        );
    }

    function liquidate(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        address owner,
        address caller,
        uint64 networkFee,
        uint64 currentNetworkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) external view returns (Operator[] memory, bytes32, uint256 balanceLiquidatable) {
        {
            uint64 burnRate;
            uint64 clusterIndex;

            for (uint i; i < processedOperators.length; ) {
                Operator memory operator = processedOperators[i];

                if (operator.snapshot.block != 0) {
                    operator.updateSnapshot();
                    operator.validatorCount -= cluster.validatorCount;
                    burnRate += operator.fee;
                    processedOperators[i] = operator;
                }

                clusterIndex += operator.snapshot.index;
                unchecked {
                    ++i;
                }
            }

            balanceLiquidatable = _liquidateCluster(
                cluster,
                owner,
                caller,
                burnRate,
                clusterIndex,
                networkFee,
                currentNetworkFeeIndex,
                minimumBlocksBeforeLiquidation,
                minimumLiquidationCollateral
            );
        }
        return (
            processedOperators,
            keccak256(
                abi.encodePacked(
                    cluster.validatorCount,
                    cluster.networkFeeIndex,
                    cluster.index,
                    cluster.balance,
                    cluster.active
                )
            ),
            balanceLiquidatable
        );
    }

    function withdraw(
        Operator[] memory processedOperators,
        Cluster memory cluster,
        uint256 amount,
        uint64 networkFee,
        uint64 currentNetworkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) external view returns (bytes32 hashedClusterData) {
        uint64 clusterIndex;
        uint64 burnRate;

        for (uint i; i < processedOperators.length; ) {
            Operator memory operator = processedOperators[i];
            clusterIndex += operator.snapshot.index + (uint64(block.number) - operator.snapshot.block) * operator.fee;
            burnRate += operator.fee;
            unchecked {
                ++i;
            }
        }

        cluster.updateClusterData(clusterIndex, currentNetworkFeeIndex);

        if (cluster.balance < amount) revert InsufficientBalance();

        cluster.balance -= amount;

        if (
            cluster.isLiquidatable(burnRate, networkFee, minimumBlocksBeforeLiquidation, minimumLiquidationCollateral)
        ) {
            revert InsufficientBalance();
        }

        hashedClusterData = keccak256(
            abi.encodePacked(
                cluster.validatorCount,
                cluster.networkFeeIndex,
                cluster.index,
                cluster.balance,
                cluster.active
            )
        );
    }

    function _liquidateCluster(
        Cluster memory cluster,
        address owner,
        address caller,
        uint64 burnRate,
        uint64 clusterIndex,
        uint64 networkFee,
        uint64 networkFeeIndex,
        uint64 minimumBlocksBeforeLiquidation,
        uint64 minimumLiquidationCollateral
    ) internal pure returns (uint256 balanceLiquidatable) {
        cluster.updateBalance(clusterIndex, networkFeeIndex);

        if (
            owner != caller &&
            !cluster.isLiquidatable(burnRate, networkFee, minimumBlocksBeforeLiquidation, minimumLiquidationCollateral)
        ) revert ISSVNetworkCore.ClusterNotLiquidatable();

        if (cluster.balance != 0) {
            balanceLiquidatable = cluster.balance;
            cluster.balance = 0;
        }
        cluster.index = 0;
        cluster.networkFeeIndex = 0;
        cluster.active = false;
    }
}
