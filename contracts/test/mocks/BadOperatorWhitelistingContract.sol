// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "../../interfaces/external/ISSVWhitelistingContract.sol";
import "../../interfaces/ISSVClusters.sol";
import "./BeneficiaryContract.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @notice Whitelisted contract that passes the validatity check of supporting ISSVWhitelistingContract
/// and tries to re-enter SSVNetwork.registerValidator function.
contract BadOperatorWhitelistingContract is ERC165 {
    BeneficiaryContract private beneficiaryContract;

    constructor(BeneficiaryContract _beneficiaryContract) {
        beneficiaryContract = _beneficiaryContract;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ISSVWhitelistingContract).interfaceId || super.supportsInterface(interfaceId);
    }

    fallback() external {
        bytes4 selector = bytes4(msg.data);
        // only proceed if the function being called is isWhitelisted
        if (selector == ISSVWhitelistingContract.isWhitelisted.selector) {
            // decode the operator Id
            // we can save the target operatorId and try the withdrawal only if it matches
            // (uint256 operatorId) = abi.decode(msg.data[36:], (uint256));
            // call BeneficiaryContract to withdraw operator earnings
            beneficiaryContract.withdrawOperatorEarnings(10000000);
        }
    }
}
