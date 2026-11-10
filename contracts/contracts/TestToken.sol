// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestToken
/// @notice Testnet-only ERC-20 with a rate-limited public faucet, so anyone can try the dApp.
contract TestToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor(uint256 initialSupply) ERC20("Stake Test Token", "STK") {
        _mint(msg.sender, initialSupply);
    }

    function faucet() external {
        uint256 availableAt = lastFaucetAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetAt[msg.sender] != 0 && block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
