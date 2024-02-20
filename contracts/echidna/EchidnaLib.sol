// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.18;

import "../libraries/Types.sol";
import "../libraries/SSVStorage.sol";

library EchidnaLib {
    function generatePublicKey(uint256 sault) internal view returns (bytes memory) {
        bytes memory randomBytes = new bytes(48);
        for (uint i = 0; i < 48; i++) {
            randomBytes[i] = bytes1(
                uint8(uint(keccak256(abi.encodePacked(sault, block.timestamp, msg.sender, i))) % 256)
            );
        }
        return randomBytes;
    }

    function generateRandom(uint256 salt, uint256 min, uint256 max) internal view returns (uint256) {
        require(max > min, "max must be greater than min");
        uint256 random = uint256(keccak256(abi.encodePacked(salt, block.timestamp, msg.sender))) % (max - min + 1);
        return min + random;
    }

    function generateRandomShrinkable(uint256 sault, uint256 min, uint256 max) internal returns (uint256) {
        require(max > min, "Max must be greater than min");
        require(
            min % DEDUCTED_DIGITS == 0 && max % DEDUCTED_DIGITS == 0,
            "Min and Max must be multiples of 10,000,000"
        );

        uint256 randomHash = uint256(keccak256(abi.encodePacked(sault, block.timestamp)));
        sault++;
        uint64 reducedHash = uint64(randomHash);

        // Calculate a fee within the range, ensuring it ends in a multiple of 10,000,000
        uint256 range = (max - min) / DEDUCTED_DIGITS + 1;
        uint256 feeMultiplier = (reducedHash % range) * DEDUCTED_DIGITS;
        uint256 fee = min + feeMultiplier;
        fee = fee - (fee % DEDUCTED_DIGITS);

        return fee;
    }

    function getBurnRate(uint64[] memory operatorIds, StorageData storage s) internal view returns (uint64 burnRate) {
        uint256 operatorsLength = operatorIds.length;

        for (uint256 i; i < operatorsLength; ) {
            uint64 operatorId = operatorIds[i];

            ISSVNetworkCore.Operator memory operator = s.operators[operatorId];
            if (operator.snapshot.block != 0) {
                burnRate += operator.fee;
            }

            unchecked {
                ++i;
            }
        }
    }
}
