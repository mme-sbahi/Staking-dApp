// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title StakingRewards
/// @notice Stake an ERC-20 token and earn rewards that accrue linearly over time (no compounding).
/// @dev Every staked token earns `rewardRate` reward wei per second (scaled by 1e18).
///      A global accumulator (`rewardPerTokenStored`) makes rate changes apply only from the
///      moment they are made, never retroactively. Staked principal and the reward pool are
///      tracked separately, so the staking token and the reward token can be the same token
///      without user deposits ever being paid out as rewards.
contract StakingRewards is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e18;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    /// @notice Reward wei earned per staked token per second, scaled by 1e18.
    uint256 public rewardRate;
    /// @notice Reward tokens available to pay out.
    uint256 public rewardPool;
    /// @notice Sum of all staked balances.
    uint256 public totalStaked;

    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardPoolFunded(uint256 amount);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientStake(uint256 requested, uint256 available);
    error NothingToClaim();
    error InsufficientRewardPool(uint256 owed, uint256 available);

    constructor(address stakingToken_, address rewardToken_, uint256 rewardRate_, address owner_)
        Ownable(owner_)
    {
        if (stakingToken_ == address(0) || rewardToken_ == address(0)) revert ZeroAddress();
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        rewardRate = rewardRate_;
        lastUpdateTime = block.timestamp;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /// @notice Reward accumulated by one staked token since deployment, scaled by 1e18.
    function rewardPerToken() public view returns (uint256) {
        return rewardPerTokenStored + rewardRate * (block.timestamp - lastUpdateTime);
    }

    /// @notice Rewards `account` can claim right now (accrued, not yet paid).
    function earned(address account) public view returns (uint256) {
        return rewards[account]
            + (stakedBalance[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / PRECISION;
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw staked tokens. Accrued rewards stay claimable, and unstaking never
    ///         depends on the reward pool, so principal can always be withdrawn.
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = stakedBalance[msg.sender];
        if (amount > balance) revert InsufficientStake(amount, balance);
        stakedBalance[msg.sender] = balance - amount;
        totalStaked -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claim() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) revert NothingToClaim();
        if (reward > rewardPool) revert InsufficientRewardPool(reward, rewardPool);
        rewards[msg.sender] = 0;
        rewardPool -= reward;
        rewardToken.safeTransfer(msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice Owner adds reward tokens to the pool (requires prior approval).
    function fundRewardPool(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        rewardPool += amount;
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardPoolFunded(amount);
    }

    /// @notice Change the reward rate. Rewards earned so far are locked in at the old rate.
    function setRewardRate(uint256 newRate) external onlyOwner updateReward(address(0)) {
        emit RewardRateUpdated(rewardRate, newRate);
        rewardRate = newRate;
    }
}
