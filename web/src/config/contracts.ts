import { parseAbi, type Address } from "viem";
import { hardhat, sepolia } from "wagmi/chains";
import deployments from "./deployments.json";

export const stakingAbi = parseAbi([
  "function stakedBalance(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function rewardPool() view returns (uint256)",
  "function rewardRate() view returns (uint256)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claim()",
  "error ZeroAmount()",
  "error InsufficientStake(uint256 requested, uint256 available)",
  "error NothingToClaim()",
  "error InsufficientRewardPool(uint256 owed, uint256 available)",
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function faucet()",
  "function lastFaucetAt(address) view returns (uint256)",
  "error FaucetCooldown(uint256 availableAt)",
]);

type Deployment = { chainId: number; token: Address; staking: Address; rewardRate: string };

export const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? sepolia.id) === hardhat.id ? hardhat : sepolia;

export const deployment = (deployments as Record<string, Deployment>)[String(chain.id)] as Deployment | undefined;

export const explorerUrl = (address: string) =>
  chain.id === sepolia.id ? `https://sepolia.etherscan.io/address/${address}#code` : undefined;
