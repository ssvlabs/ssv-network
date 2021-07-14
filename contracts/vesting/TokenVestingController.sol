pragma solidity ^0.8.0;

import "./TokenVesting.sol";

contract TokenVestingController {
    using SafeERC20 for IERC20;

    IERC20 public token;
    uint256 public minimumAmountPerContract;
    mapping (address => TokenVesting[]) public vestings;
    mapping (TokenVesting => address) public owners;

    bool initialized;

    /**
     * @dev Create a vesting controller for a token.
     * @param _token The token.
     * @param _minimumAmountPerContract Minimum amount per vesting contract.
     */
    function initialize(IERC20 _token, uint256 _minimumAmountPerContract) public {
        require(!initialized, "already initialized");
        require(_minimumAmountPerContract > 0, "minimum amount per contract not set");

        token = _token;
        minimumAmountPerContract = _minimumAmountPerContract;

        initialized = true;
    }

    /**
     * @dev Creates a vesting contract that vests its balance of any ERC20 token to the
     * beneficiary, gradually in a linear fashion until start + duration. By then all
     * of the balance will have vested. msg.sender should approve spending of the token by this contract.
     * @param _beneficiary address of the beneficiary to whom vested tokens are transferred
     * @param _amount number of tokens in the plan
     * @param _cliffDuration duration in seconds of the cliff in which tokens will begin to vest
     * @param _start the time (as Unix time) at which point vesting starts
     * @param _duration duration in seconds of the period in which the tokens will vest
     * @param _revocable whether the vesting is revocable or not
     */
    function createVesting(address _beneficiary, uint256 _amount, uint256 _start, uint256 _cliffDuration, uint256 _duration, bool _revocable) public {
        require(_amount >= minimumAmountPerContract, "amount less than minimum");
        TokenVesting tokenVesting = new TokenVesting(_beneficiary, _start, _cliffDuration, _duration, _revocable);
        vestings[_beneficiary].push(tokenVesting);
        owners[tokenVesting] = msg.sender;
        token.safeTransferFrom(msg.sender, address(tokenVesting), _amount);
    }

    /**
     * @dev Returns the total amount of tokens held in vesting contracts for a beneficairy.
     * @param _beneficiary address of the beneficiary.
     */
    function totalVestingBalanceOf(address _beneficiary) public view returns (uint256 balance) {
        for (uint index = 0; index < vestings[_beneficiary].length; ++index) {
            balance += token.balanceOf(address(vestings[_beneficiary][index]));
        }
    }

    /**
     * @dev Returns the total amount of vested tokens held in vesting contracts for a beneficairy.
     * @param _beneficiary address of the beneficiary.
     */
    function vestedBalanceOf(address _beneficiary) public view returns (uint256 balance) {
        for (uint index = 0; index < vestings[_beneficiary].length; ++index) {
            balance += vestings[_beneficiary][index].releasableAmount(token);
        }
    }

    /**
     * @dev Returns the total amount of unvested tokens held in vesting contracts for a beneficairy.
     * @param _beneficiary address of the beneficiary.
     */
    function unvestedBalanceOf(address _beneficiary) public view returns (uint256 balance) {
        return totalVestingBalanceOf(_beneficiary) - vestedBalanceOf(_beneficiary);
    }

    /**
     * @dev Revokes a TokenVesting contract.
     * @param _tokenVesting TokenVesting contract.
     */
    function revokeContract(TokenVesting _tokenVesting) public {
        require(owners[_tokenVesting] == msg.sender, "Not owner of contract");
        _safeRevoke(_tokenVesting);
    }

    /**
     * @dev Revokes a TokenVesting contract by beneficiary and index.
     * @param _beneficiary address of the beneficiary.
     * @param _index the index of the contract.
     */
    function revoke(address _beneficiary, uint _index) public {
        revokeContract(vestings[_beneficiary][_index]);
    }

    /**
     * @dev Revokes all TokenVesting contracts for a beneficiary which are owned by msg.sender.
     * @param _beneficiary address of the beneficiary.
     */
    function revokeAll(address _beneficiary) public {
        for (uint index = 0; index < vestings[_beneficiary].length; ++index) {
            if (owners[vestings[_beneficiary][index]] == msg.sender &&
                vestings[_beneficiary][index].revocable() &&
                !vestings[_beneficiary][index].revoked(address(token))) {
                _safeRevoke(vestings[_beneficiary][index]);
            }
        }
    }

    /**
     * @dev Withdraw all vested tokens of the a beneficiary.
     * @param _beneficiary address of the beneficiary.
     */
    function withdrawFor(address _beneficiary) public {
        for (uint index = 0; index < vestings[_beneficiary].length; ++index) {
            if (vestings[_beneficiary][index].releasableAmount(token) > 0) {
                vestings[_beneficiary][index].release(token);
            }
        }
    }

    /**
     * @dev withdraw all vested tokens of the msg.sender.
     */
    function withdraw() public {
        withdrawFor(msg.sender);
    }

    /**
     * @dev Revokes a TokenVesting contract. Assumes that the owner was already verified.
     * @param _tokenVesting TokenVesting contract.
     */
    function _safeRevoke(TokenVesting _tokenVesting) private {
        _tokenVesting.revoke(token);
        token.safeTransfer(msg.sender, token.balanceOf(address(this)));
    }
}