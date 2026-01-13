// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../modules/SSVClusters.sol";

contract SSVForked is Test {
    uint256 holeskyFork;

    // The raw transaction calldata
    bytes constant TX =
        hex"8c1d3d03000000000000000000000000bbbd6371b6530ed95986174fa23879260658484800000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000004a000000000000000000000000000000000000000000000000000000000f39dd600000000000000000000000000000000000000000000000000000000002dcbf4800000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000055de6a779bbac00000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000037000000000000000000000000000000000000000000000000000000000000004e0000000000000000000000000000000000000000000000000000000000000051";

    // Addresses
    address constant SSV_NETWORK = 0x5Ec6aBaC8cB238D68d310A2b1656405161988bFC;
    address constant SENDER = 0xbBbd6371b6530eD95986174Fa238792606584848;
    // On-chain SSVClusters module implementation (from trace)
    address constant SSV_CLUSTERS_MODULE = 0xF5f201A21263606352C6436Ee80502111783dB6C;

    // Storage slot for SSVStorageProtocol: keccak256("ssv.network.storage.protocol") - 1
    bytes32 constant PROTOCOL_STORAGE_SLOT = bytes32(uint256(keccak256("ssv.network.storage.protocol")) - 1);

    function setUp() public {
        holeskyFork = vm.createFork("https://hoodi.infura.io/v3/{INFURA_API_KEY}");
        vm.selectFork(holeskyFork);

        // Deploy local SSVClusters with console.log statements
        SSVClusters localClusters = new SSVClusters();

        // Replace on-chain module bytecode with local version
        vm.etch(SSV_CLUSTERS_MODULE, address(localClusters).code);
    }

    /// @notice Get slot 3 which contains ETH fee fields
    /// @dev Layout of slot 3:
    ///      [0-31]   ethDaoIndexBlockNumber (uint32)
    ///      [32-95]  ethNetworkFee (uint64)
    ///      [96-159] ethNetworkFeeIndex (uint64) <-- TARGET
    ///      [160-223] ethDaoBalance (uint64)
    function _getEthSlot() internal view returns (bytes32) {
        bytes32 slot3 = bytes32(uint256(PROTOCOL_STORAGE_SLOT) + 3);
        return vm.load(SSV_NETWORK, slot3);
    }

    /// @notice Set the ethNetworkFeeIndex in protocol storage (slot 3, bits 96-159)
    function _setEthNetworkFeeIndex(uint64 newFeeIndex) internal {
        bytes32 slot3 = bytes32(uint256(PROTOCOL_STORAGE_SLOT) + 3);
        bytes32 currentSlot = vm.load(SSV_NETWORK, slot3);
        
        // Clear bits 96-159 and set new value
        // Keep bits 0-95 and 160-255, clear bits 96-159
        uint256 current = uint256(currentSlot);
        uint256 mask = ~(uint256(0xFFFFFFFFFFFFFFFF) << 96); // Clear bits 96-159
        uint256 newValue = (current & mask) | (uint256(newFeeIndex) << 96);
        
        vm.store(SSV_NETWORK, slot3, bytes32(newValue));
    }

    /// @notice Read the current ethNetworkFeeIndex (slot 3, bits 96-159)
    function _getEthNetworkFeeIndex() internal view returns (uint64) {
        bytes32 slot3 = bytes32(uint256(PROTOCOL_STORAGE_SLOT) + 3);
        bytes32 slot = vm.load(SSV_NETWORK, slot3);
        return uint64(uint256(slot) >> 96);
    }

    function test_fork_raw_call() public {
        // Replay as the original sender
        vm.prank(SENDER);

        (bool ok, bytes memory ret) = SSV_NETWORK.call(TX);

        assertTrue(ok, string.concat("tx failed: ", vm.toString(ret)));
    }

    function test_fork_raw_call_debug() public {
        // Replay with more debug info
        vm.prank(SENDER);

        // Log some state before the call
        console.log("Block number:", block.number);
        console.log("Sender:", SENDER);
        console.log("Target:", SSV_NETWORK);

        (bool ok, bytes memory ret) = SSV_NETWORK.call(TX);

        if (!ok) {
            console.log("Transaction reverted");
            console.logBytes(ret);

            // Try to decode the revert reason
            if (ret.length >= 4) {
                bytes4 selector = bytes4(ret);
                console.log("Revert selector:");
                console.logBytes4(selector);
            }
        }

        assertTrue(ok, string.concat("tx failed: ", vm.toString(ret)));
    }

    /// @notice Test that the fix works - liquidateSSV should now use SSV index, not ETH index
    /// @dev With the fix (using currentNetworkFeeIndexSSV instead of currentNetworkFeeIndex),
    ///      this test should PASS without any manual index manipulation
    function test_fork_liquidateSSV_fixed() public {
        // The cluster's networkFeeIndex (255,450,464) was set when using SSV network fee
        // The bug was: liquidateSSV used ETH currentNetworkFeeIndex (~3.6M) causing underflow
        // The fix: liquidateSSV now uses SSV currentNetworkFeeIndexSSV (should be >= 255M)
        
        vm.prank(SENDER);
        (bool ok, bytes memory ret) = SSV_NETWORK.call(TX);

        // With the fix, this should pass WITHOUT needing to manipulate ethNetworkFeeIndex
        assertTrue(ok, string.concat("tx failed: ", vm.toString(ret)));
    }

    /// @notice Legacy test - manually increases ETH fee index (was workaround before fix)
    function test_fork_with_increased_fee() public {
        uint64 currentFeeIndex = _getEthNetworkFeeIndex();
        console.log("Current ethNetworkFeeIndex:", currentFeeIndex);

        // Set ethNetworkFeeIndex higher than the cluster's value (255450464)
        uint64 newFeeIndex = 300_000_000;
        _setEthNetworkFeeIndex(newFeeIndex);
        
        console.log("New ethNetworkFeeIndex:", _getEthNetworkFeeIndex());

        vm.prank(SENDER);
        (bool ok, bytes memory ret) = SSV_NETWORK.call(TX);

        assertTrue(ok, string.concat("tx failed: ", vm.toString(ret)));
    }

    function test_fork_at_specific_block() public {
        // Create fork at a specific block if needed
        // uint256 specificBlock = 12345678;
        // uint256 forkAtBlock = vm.createFork("https://hoodi.infura.io/v3/fbee2c3c78dc4b3b866a608b72b459c2", specificBlock);
        // vm.selectFork(forkAtBlock);

        vm.prank(SENDER);

        (bool ok, bytes memory ret) = SSV_NETWORK.call(TX);

        assertTrue(ok, string.concat("tx failed: ", vm.toString(ret)));
    }
}
