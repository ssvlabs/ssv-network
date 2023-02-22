// File: contracts/ISSVNetwork.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.16;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ISSVNetworkCore.sol";
import "./SSVNetwork.sol";

interface ISSVNetworkViews is ISSVNetworkCore {
    /****************/
    /* Initializers */
    /****************/

    /**
     * @dev Initializes the contract.
     * @param ssvNetwork_ The SSVNetwork contract.
     */
    function initialize(SSVNetwork ssvNetwork_) external;

    /************************************/
    /* Operator External View Functions */
    /************************************/

    function getOperatorFee(uint64 operatorId) external view returns (uint256);

    function getOperatorDeclaredFee(
        uint64 operatorId
    ) external view returns (uint256, uint256, uint256);

    function getOperatorById(
        uint64 operatorId
    ) external view returns (address owner, uint256 fee, uint32 validatorCount);

    /*******************************/
    /* Cluster External View Functions */
    /*******************************/

    function isLiquidatable(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external view returns (bool);

    function isLiquidated(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external view returns (bool);

    function getClusterBurnRate(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external view returns (uint256);

    /***********************************/
    /* Balance External View Functions */
    /***********************************/

    function getOperatorEarnings(
        uint64 id
    ) external view returns (uint256);

    function getBalance(
        address owner,
        uint64[] memory operatorIds,
        ISSVNetwork.Cluster memory cluster
    ) external view returns (uint256);

    /*******************************/
    /* DAO External View Functions */
    /*******************************/

    function getNetworkFee() external view returns (uint256);

    function getNetworkEarnings() external view returns (uint256);

    function getOperatorFeeIncreaseLimit() external view returns (uint64);

    function getExecuteOperatorFeePeriod() external view returns (uint64);

    function getDeclaredOperatorFeePeriod() external view returns (uint64);

    function getLiquidationThresholdPeriod() external view returns (uint64);
}
