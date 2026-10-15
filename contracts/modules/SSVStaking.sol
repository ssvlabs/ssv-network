// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.23;

import {SSVStorageProtocol, SSVStorageStaking} from "../libraries/SSVStorage.sol";
import {PackedETH, PackedETHLib} from "../libraries/PackedETH.sol";
import {ICSSVToken} from "../interfaces/ICSSVToken.sol";
import {ISSVStaking} from "../interfaces/ISSVStaking.sol";

contract SSVStaking is ISSVStaking {
    uint256 private constant PRECISION = 1e18;
    address private constant CSSV_ADDRESS = 0x7d65c7595b7f22b7b4d5a9a1d3d8b7c9e0a1b2c3d;

    function _syncFees() internal {
        SSVStorageProtocol storage sp = SSVStorageProtocol.load();
        SSVStorageStaking storage s = SSVStorageStaking.load();

        PackedETH current = sp.networkTotalEarnings();
        sp.ethDaoBalance = current;
        sp.ethDaoIndexBlockNumber = uint32(block.number);

        PackedETH previous = s.stakingEthPoolBalance;
        if (current.lte(previous)) {
            s.stakingEthPoolBalance = current;
            return;
        }

        PackedETH packedNewFees = current.sub(previous);
        uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();

        // FIX: Don't advance watermark when totalStaked == 0
        // Otherwise fees accrued while supply=0 are frozen forever
        if (totalStaked != 0) {
            uint256 newFeesWei = PackedETHLib.unpack(packedNewFees);
            s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
            s.stakingEthPoolBalance = current;
        }
    }

    function syncFees() external {
        _syncFees();
    }

    function stake(uint256 amount) external {
        _syncFees();
        // original stake logic
    }

    function requestUnstake(uint256 amount) external {
        _syncFees();
        // original requestUnstake logic
    }

    function withdrawUnlocked() external {
        // original withdrawUnlocked logic
    }

    function claimEthRewards() external {
        _syncFees();
        // original claimEthRewards logic
    }

    function onCSSVTransfer(address from, address to, uint256 amount) external {
        _syncFees();
        // original onCSSVTransfer logic
    }

    function rescueERC20(address token, address to, uint256 amount) external {
        // original rescueERC20 logic
    }
}
