// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import {ISSVNetworkCore} from "./ISSVNetworkCore.sol";

interface ISSVProtocolOperators is ISSVNetworkCore {
    /**
     * @dev Emitted when a new operator has been added.
     * @param operatorId operator's ID.
     * @param owner Operator's ethereum address that can collect fees.
     * @param publicKey Operator's public key. Will be used to encrypt secret shares of validators keys.
     * @param protocolType Protocol type (0 = LIDO).
     * @param bond Amount of protocol's tokens deposited by the owner.
     * @param rewardAddress Address where rewards will be distributed.
     */
    event ProtocolOperatorAdded(
        uint64 indexed operatorId,
        address owner,
        bytes publicKey,
        ProtocolType protocolType,
        uint256 bond,
        address rewardAddress
    );

    event ProtocolOperatorRemoved(uint64 indexed operatorId, ProtocolType protocolType);

    event ProtocolOperatorWithdrawn(
        uint64 indexed operatorId,
        address indexed owner,
        ProtocolType protocolType,
        uint256 amount
    );

    event ProtocolBondDeposited(
        uint64 indexed operatorId,
        address indexed owner,
        ProtocolType protocolType,
        uint256 amount
    );
    event ProtocolOperatorSlashed(uint64 indexed operatorId, ProtocolType protocolType, uint256 amount);

    /// @notice Registers a new operator
    /// @param publicKey The public key of the operator
    /// @param protocolType Protocol type (0 = LIDO)
    /// @param bond Amount of protocol's tokens deposited by the owner
    /// @param rewardAddress Address where rewards will be distributed
    function registerOperator(
        bytes calldata publicKey,
        ProtocolType protocolType,
        uint256 bond,
        address rewardAddress
    ) external returns (uint64 id);

    /// @notice Removes an existing operator
    /// @param operatorId The ID of the operator to be removed
    /// @param protocolType Protocol type (0 = LIDO)
    function removeOperator(uint64 operatorId, ProtocolType protocolType) external;

    function slashBond(uint64 operatorId, ProtocolType protocolType) external;
}
