# Staking dApp

Stake an ERC-20 token and earn rewards that accrue every second. This repo contains a Solidity staking contract with a full test suite, and a Next.js frontend that uses wagmi and RainbowKit. Both run on Ethereum Sepolia.

| | |
|---|---|
| **Contracts** | Solidity 0.8.28 · OpenZeppelin 5 · Hardhat 3 · 23 tests |
| **Frontend** | Next.js 16 · React 19 · wagmi 2 · viem · RainbowKit |
| **Network** | Ethereum Sepolia testnet |

## What it does

- **Stake** a chosen ERC-20 token and **unstake** any amount, including partial amounts.
- **Linear, time-based rewards.** Each staked token earns a fixed amount per second. Rewards are not compounded.
- **Claim** accrued rewards whenever you like.
- **The owner funds the reward pool** and can change the reward rate. A new rate applies only from the moment it is set.
- **Frontend:**
  - RainbowKit wallet connection;
  - live staked balance, plus pending rewards that tick every second;
  - an approve-then-stake flow, with loading states on each button;
  - Claim is disabled while rewards are zero;
  - contract errors shown as plain English;
  - a test-token faucet, so anyone can try the dApp.

## Contract design

`contracts/contracts/StakingRewards.sol`

- **Global reward accumulator** (`rewardPerTokenStored`): this is the standard Synthetix-style pattern. Each action does a fixed amount of work no matter how many stakers there are, and rate changes are never applied retroactively.
- **Staked funds and the reward pool are tracked separately** (`totalStaked` and `rewardPool`). The staking and reward token can be the same token, and user deposits can never be paid out as someone else's rewards.
- **Unstaking never depends on the reward pool.** If the pool runs dry, `claim` reverts with `InsufficientRewardPool` and the owed rewards stay on record. Users can still withdraw their principal.
- **Safety:**
  - `ReentrancyGuard` on every function that moves funds;
  - `SafeERC20` for all token transfers;
  - `Ownable` for the admin functions;
  - custom errors instead of revert strings.
- **Not supported:** fee-on-transfer and rebasing tokens. The contract assumes the amount transferred is the amount received.

### Test coverage

`contracts/test/StakingRewards.ts`. Run it with `npm test`.

| Area | Cases |
|---|---|
| Stake | balances and events, zero amount, missing allowance |
| Accrual | linear over time, no compounding, independent users, adding to a position, rate change applies only going forward |
| Claim | payout and reset, double claim in the same block, nothing to claim, empty reward pool keeps rewards owed |
| Unstake | full and partial, rewards kept after unstaking, zero amount, more than staked, principal never paid out as rewards |
| Owner | fund pool, zero funding, non-owner blocked |
| Faucet | cooldown |

## Project structure

```
contracts/   Hardhat 3 project: StakingRewards.sol, TestToken.sol, tests, deploy script
web/         Next.js app (wagmi + RainbowKit)
```

## Run it locally

```bash
# 1. Contracts: install, test, start a local chain, deploy
cd contracts
npm install
npm test
npx hardhat node                                   # keep this running
npx hardhat run scripts/deploy.ts --network localhost

# 2. Frontend against the local chain
cd ../web
npm install
NEXT_PUBLIC_CHAIN_ID=31337 npm run dev
```

On the local chain, a **Use local dev account** button connects a pre-funded Hardhat account, so you can try every flow without a browser wallet.

## Deploy to Sepolia

The deploy script deploys the token and the staking contract and funds the reward pool. It then writes the addresses to `web/src/config/deployments.json`.

```bash
cd contracts
npx hardhat keystore set SEPOLIA_RPC_URL       # e.g. an Alchemy or Infura Sepolia URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY   # deployer wallet with some Sepolia ETH
npx hardhat keystore set ETHERSCAN_API_KEY
npm run deploy:sepolia
# then run the two "npx hardhat verify ..." commands the script prints
```

Secrets are stored in Hardhat's encrypted keystore, never in the repo.

The frontend deploys to Vercel with `web/` as the root directory. Optionally, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free at [cloud.reown.com](https://cloud.reown.com)) to enable mobile wallets.
