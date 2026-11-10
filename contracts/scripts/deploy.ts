import { readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

// 50% APR: reward wei per staked token (1e18) per second = 0.5e18 / seconds in a year.
const REWARD_RATE = 5n * 10n ** 17n / (365n * 24n * 60n * 60n);
const INITIAL_SUPPLY = 10_000_000n * 10n ** 18n;
const REWARD_POOL = 1_000_000n * 10n ** 18n;

const { ethers, networkName } = await network.create();
const [deployer] = await ethers.getSigners();
const { chainId } = await ethers.provider.getNetwork();
console.log(`Deploying to ${networkName} (chain ${chainId}) from ${deployer.address}`);

const token = await ethers.deployContract("TestToken", [INITIAL_SUPPLY]);
await token.waitForDeployment();
const tokenAddress = await token.getAddress();
console.log("TestToken:", tokenAddress);

const staking = await ethers.deployContract("StakingRewards", [tokenAddress, tokenAddress, REWARD_RATE, deployer.address]);
await staking.waitForDeployment();
const stakingAddress = await staking.getAddress();
console.log("StakingRewards:", stakingAddress);

await (await token.approve(stakingAddress, REWARD_POOL)).wait();
await (await staking.fundRewardPool(REWARD_POOL)).wait();
console.log("Reward pool funded with", ethers.formatEther(REWARD_POOL), "STK");

// The web app reads its contract addresses from here, keyed by chain id.
const deploymentsFile = new URL("../../web/src/config/deployments.json", import.meta.url);
const deployments = JSON.parse(await readFile(deploymentsFile, "utf8"));
deployments[String(chainId)] = {
  chainId: Number(chainId),
  token: tokenAddress,
  staking: stakingAddress,
  rewardRate: REWARD_RATE.toString(),
  deployedAt: new Date().toISOString(),
};
await writeFile(deploymentsFile, JSON.stringify(deployments, null, 2) + "\n");
console.log("Saved addresses to web/src/config/deployments.json");

console.log("\nVerify on Etherscan with:");
console.log(`npx hardhat verify --network ${networkName} ${tokenAddress} ${INITIAL_SUPPLY}`);
console.log(`npx hardhat verify --network ${networkName} ${stakingAddress} ${tokenAddress} ${tokenAddress} ${REWARD_RATE} ${deployer.address}`);
