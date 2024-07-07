// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/external/ISSVWhitelistingContract.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @notice Whitelisted contract that passes the validatity check of supporting ISSVWhitelistingContract
/// and tries to re-enter SSVNetwork.registerValidator function.
contract FakeWhitelistingContract is ERC165 {
    struct Cluster {
        uint32 validatorCount;
        uint64 networkFeeIndex;
        uint64 index;
        bool active;
        uint256 balance;
    }

    bytes private publicKey;
    uint64[] private operatorIds;
    bytes private sharesData;
    uint256 private amount;
    Cluster private clusterData;

    address private ssvContract;

    constructor(address _ssvContract) {
        ssvContract = _ssvContract;
    }

    function setRegisterValidatorData(
        bytes calldata _publicKey,
        uint64[] memory _operatorIds,
        bytes calldata _sharesData,
        uint256 _amount,
        Cluster memory _cluserData
    ) external {
        publicKey = _publicKey;
        operatorIds = _operatorIds;
        sharesData = _sharesData;
        amount = _amount;
        clusterData = _cluserData;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ISSVWhitelistingContract).interfaceId || super.supportsInterface(interfaceId);
    }

    fallback() external {
        bytes4 selector = bytes4(msg.data);
        if (selector == ISSVWhitelistingContract.isWhitelisted.selector) {
            // Encoding the registerValidator function selector and arguments
            bytes memory data = abi.encodeWithSignature(
                "registerValidator(bytes,uint64[],bytes,uint256,(uint32,uint64,uint64,bool,uint256))",
                publicKey,
                operatorIds,
                sharesData,
                amount,
                clusterData
            );
            // Making the low-level call
            (bool success, bytes memory returnData) = ssvContract.call(data);

            // Handling the call response
            if (!success) revert("Call failed or was reverted");
        }
    }
}
