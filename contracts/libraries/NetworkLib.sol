// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../interfaces/ISSVNetworkCore.sol";
import "../SSVNetwork.sol";
import "./SSVStorage.sol";
import "./DAOLib.sol";

library NetworkLib {
    using Types256 for uint256;

    function currentNetworkFeeIndex(ISSVNetworkCore.Network storage network) internal view returns (uint64) {
        return network.networkFeeIndex + uint64(block.number - network.networkFeeIndexBlockNumber) * network.networkFee;
    }

    function updateNetworkFee(ISSVNetworkCore.Network storage network, uint256 fee) internal {
        DAOLib.updateDAOEarnings(SSVStorage.load().dao, network.networkFee);

        network.networkFeeIndex = currentNetworkFeeIndex(network);
        network.networkFeeIndexBlockNumber = uint32(block.number);
        network.networkFee = fee.shrink();
    }

}
