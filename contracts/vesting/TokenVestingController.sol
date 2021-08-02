// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./TokenVesting.sol";

/**
 * @title Token Vesting Controller
 */
contract TokenVestingController is Initializable {
    using SafeERC20 for IERC20;

    IERC20 private _token;
    uint256 private _minimumAmountPerContract;
    mapping (address => TokenVesting[]) private _vestings;
    mapping (TokenVesting => address) private _owners;

    /**
     * @dev Initializes a vesting controller for a token.
     * @param token The token
     * @param minimumAmountPerContract Minimum amount per vesting contract
     */
    function initialize(IERC20 token, uint256 minimumAmountPerContract) external initializer {
        __TokenVestingController_init(token, minimumAmountPerContract);
    }


    /**
     * @dev Creates a vesting contract that vests its balance of any ERC20 token to the
     * beneficiary, gradually in a linear fashion until start + duration. By then all
     * of the balance will have vested. msg.sender should approve spending of the token by this contract.
     * @param beneficiary address of the beneficiary to whom vested tokens are transferred
     * @param amount number of tokens in the plan
     * @param start the time (as Unix time) at which point vesting starts
     * @param cliffDuration duration in seconds of the cliff in which tokens will begin to vest
     * @param duration duration in seconds of the period in which the tokens will vest
     * @param revocable whether the vesting is revocable or not
     */
    function createVesting(address beneficiary, uint256 amount, uint256 start, uint256 cliffDuration, uint256 duration, bool revocable) external {
        require(amount >= _minimumAmountPerContract, "amount less than minimum");
        TokenVesting tokenVesting = new TokenVesting(beneficiary, start, cliffDuration, duration, revocable);
        _vestings[beneficiary].push(tokenVesting);
        _owners[tokenVesting] = msg.sender;
        _token.safeTransferFrom(msg.sender, address(tokenVesting), amount);
    }


    /**
     * @dev withdraw all vested tokens of the msg.sender.
     */
    function withdraw() external {
        _withdrawFor(msg.sender);
    }

    /**
     * @dev Withdraw all vested tokens of the a beneficiary.
     * @param beneficiary address of the beneficiary.
     */
    function withdrawFor(address beneficiary) external {
        _withdrawFor(beneficiary);
    }

    /**
     * @dev Revokes a TokenVesting contract by beneficiary and index.
     * @param beneficiary address of the beneficiary.
     * @param index the index of the contract.
     */
    function revoke(address beneficiary, uint256 index) external {
        _revokeContract(_vestings[beneficiary][index]);
    }

    /**
     * @dev Revokes a TokenVesting contract.
     * @param tokenVesting TokenVesting contract.
     */
    function revokeContract(TokenVesting tokenVesting) external {
        _revokeContract(tokenVesting);
    }

    /**
     * @dev Revokes all TokenVesting contracts for a beneficiary which are owned by msg.sender.
     * @param beneficiary address of the beneficiary.
     */
    function revokeAll(address beneficiary) external {
        uint256 beneficiaryVestingsCount = _vestings[beneficiary].length;
        for (uint256 index = 0; index < beneficiaryVestingsCount; ++index) {
            if (_owners[_vestings[beneficiary][index]] == msg.sender &&
                _vestings[beneficiary][index].revocable() &&
                !_vestings[beneficiary][index].revoked(address(_token))) {
                _safeRevoke(_vestings[beneficiary][index]);
            }
        }
    }

    /**
     * @dev Returns the total amount of tokens held in vesting contracts for a beneficairy.
     * @param beneficiary address of the beneficiary.
     */
    function totalVestingBalanceOf(address beneficiary) external view returns (uint256 balance) {
        uint256 beneficiaryVestingsCount = _vestings[beneficiary].length;
        for (uint256 index = 0; index < beneficiaryVestingsCount; ++index) {
            balance += _token.balanceOf(address(_vestings[beneficiary][index]));
        }
    }

    /**
     * @dev Returns the total amount of vested tokens held in vesting contracts for a beneficairy.
     * @param beneficiary address of the beneficiary.
     */
    function vestedBalanceOf(address beneficiary) external view returns (uint256 balance) {
        uint256 beneficiaryVestingsCount = _vestings[beneficiary].length;
        for (uint256 index = 0; index < beneficiaryVestingsCount; ++index) {
            balance += _vestings[beneficiary][index].releasableAmount(_token);
        }
    }

    /**
     * @dev Returns the total amount of unvested tokens held in vesting contracts for a beneficairy.
     * @param beneficiary address of the beneficiary.
     */
    function unvestedBalanceOf(address beneficiary) external view returns (uint256 balance) {
        uint256 beneficiaryVestingsCount = _vestings[beneficiary].length;
        for (uint256 index = 0; index < beneficiaryVestingsCount; ++index) {
            balance += _token.balanceOf(address(_vestings[beneficiary][index])) - _vestings[beneficiary][index].releasableAmount(_token);
        }
    }

    /**
     * @return Token address
     */
    function token() external view returns (IERC20) {
        return _token;
    }

    /**
     * @return Minimum amount of tokens for each contract
     */
    function minimumAmountPerContract() external view returns (uint256) {
        return _minimumAmountPerContract;
    }

    /**
     * @dev Returns a TokenVesting by beneficiary and index
     * @param beneficiary The beneficiary
     * @param index The index
     */
    function vestings(address beneficiary, uint256 index) external view returns (TokenVesting) {
        return _vestings[beneficiary][index];
    }

    /**
     * @dev Returns an owner for a TokenVesting
     * @param tokenVesting The TokenVesting
     */
    function owners(TokenVesting tokenVesting) external view returns (address) {
        return _owners[tokenVesting];
    }

    /**
     * @dev Initializes a vesting controller for a token (chained initializer).
     * @param token The token
     * @param minimumAmountPerContract Minimum amount per vesting contract
     */
    function __TokenVestingController_init(IERC20 token, uint256 minimumAmountPerContract) internal initializer {
        __TokenVestingController_init_unchained(token, minimumAmountPerContract);
    }

    /**
     * @dev Initializes a vesting controller for a token (unchained initializer).
     * @param token The token
     * @param minimumAmountPerContract Minimum amount per vesting contract
     */
    function __TokenVestingController_init_unchained(IERC20 token, uint256 minimumAmountPerContract) internal initializer {
        require(minimumAmountPerContract > 0, "minimum amount per contract not set");

        _token = token;
        _minimumAmountPerContract = minimumAmountPerContract;
    }

    /**
     * @dev Withdraw all vested tokens of the a beneficiary.
     * @param beneficiary address of the beneficiary.
     */
    function _withdrawFor(address beneficiary) internal {
        uint256 beneficiaryVestingsCount = _vestings[beneficiary].length;
        for (uint256 index = 0; index < beneficiaryVestingsCount; ++index) {
            if (_vestings[beneficiary][index].releasableAmount(_token) > 0) {
                _vestings[beneficiary][index].release(_token);
            }
        }
    }

    /**
     * @dev Revokes a TokenVesting contract.
     * @param tokenVesting TokenVesting contract.
     */
    function _revokeContract(TokenVesting tokenVesting) internal {
        require(_owners[tokenVesting] == msg.sender, "Not owner of contract");
        _safeRevoke(tokenVesting);
    }

    /**
     * @dev Revokes a TokenVesting contract. Assumes that the owner was already verified.
     * @param tokenVesting TokenVesting contract.
     */
    function _safeRevoke(TokenVesting tokenVesting) private {
        tokenVesting.revoke(_token);
        _token.safeTransfer(msg.sender, _token.balanceOf(address(this)));
    }
}