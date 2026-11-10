"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { useAccount, useConnect, useReadContracts } from "wagmi";
import { devConnector } from "@/app/providers";
import { chain, deployment, explorerUrl, stakingAbi, tokenAbi } from "@/config/contracts";
import { useTransaction } from "@/lib/useTransaction";

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

function format(value: bigint | undefined, digits = 4) {
  if (value === undefined) return "—";
  return Number(formatUnits(value, 18)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Parse a user-typed amount; undefined when empty or invalid. */
function toWei(input: string): bigint | undefined {
  if (!/^\d*\.?\d*$/.test(input) || input === "" || input === ".") return undefined;
  try {
    return parseUnits(input, 18);
  } catch {
    return undefined;
  }
}

export function StakingDashboard() {
  if (!deployment) {
    return (
      <main className="shell">
        <p className="notice">Contracts are not deployed on {chain.name} yet. Run the deploy script in /contracts first.</p>
      </main>
    );
  }
  return <Dashboard token={deployment.token} staking={deployment.staking} />;
}

function Dashboard({ token, staking }: { token: `0x${string}`; staking: `0x${string}` }) {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const user = address ?? "0x0000000000000000000000000000000000000000";

  const { data, refetch, dataUpdatedAt } = useReadContracts({
    contracts: [
      { address: staking, abi: stakingAbi, functionName: "totalStaked" },
      { address: staking, abi: stakingAbi, functionName: "rewardPool" },
      { address: staking, abi: stakingAbi, functionName: "rewardRate" },
      { address: staking, abi: stakingAbi, functionName: "stakedBalance", args: [user] },
      { address: staking, abi: stakingAbi, functionName: "earned", args: [user] },
      { address: token, abi: tokenAbi, functionName: "balanceOf", args: [user] },
      { address: token, abi: tokenAbi, functionName: "allowance", args: [user, staking] },
    ],
    allowFailure: false,
    query: { refetchInterval: 12_000 },
  });
  const [totalStaked, rewardPool, rewardRate, staked, earned, balance, allowance] = data ?? [];

  // Rewards accrue every second on-chain; tick the displayed value between refetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = BigInt(Math.max(0, Math.floor((now - dataUpdatedAt) / 1000)));
  const pending =
    earned !== undefined && staked !== undefined && rewardRate !== undefined
      ? earned + (staked * rewardRate * elapsed) / 10n ** 18n
      : undefined;
  // Staking and reward token are the same, so the yearly reward per token is the APR.
  const apr = rewardRate !== undefined ? Number(formatUnits(rewardRate * SECONDS_PER_YEAR * 100n, 18)) : undefined;

  const [stakeInput, setStakeInput] = useState("");
  const [unstakeInput, setUnstakeInput] = useState("");

  const refresh = () => void refetch();
  const approveTx = useTransaction(refresh);
  const stakeTx = useTransaction(() => (refresh(), setStakeInput("")));
  const unstakeTx = useTransaction(() => (refresh(), setUnstakeInput("")));
  const claimTx = useTransaction(refresh);
  const faucetTx = useTransaction(refresh);

  const stakeAmount = toWei(stakeInput);
  const unstakeAmount = toWei(unstakeInput);
  const needsApproval = stakeAmount !== undefined && allowance !== undefined && allowance < stakeAmount;
  const stakeTooHigh = stakeAmount !== undefined && balance !== undefined && stakeAmount > balance;
  const unstakeTooHigh = unstakeAmount !== undefined && staked !== undefined && unstakeAmount > staked;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{chain.id === 31337 ? "Local Hardhat network" : `${chain.name} testnet`}</p>
          <h1>Stake STK, earn STK</h1>
        </div>
        <ConnectButton chainStatus="icon" showBalance={false} />
      </header>

      <section className="stats" aria-label="Pool statistics">
        <Stat label="APR" value={apr === undefined ? "—" : `${apr.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`} />
        <Stat label="Total staked" value={`${format(totalStaked, 2)} STK`} />
        <Stat label="Reward pool" value={`${format(rewardPool, 2)} STK`} />
      </section>

      {!isConnected ? (
        <section className="card center">
          <h2>Connect a wallet to start</h2>
          <p className="muted">Use any Ethereum wallet on Sepolia. You can get free test STK from the faucet after connecting.</p>
          <ConnectButton />
          {devConnector && (
            <button className="secondary" onClick={() => connect({ connector: devConnector! })}>
              Use local dev account
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="card position" aria-label="Your position">
            <Stat label="Your stake" value={`${format(staked)} STK`} />
            <Stat label="Pending rewards" value={`${format(pending, 6)} STK`} live />
            <Stat label="Wallet balance" value={`${format(balance)} STK`} />
            <div className="row">
              <button
                onClick={() => claimTx.send({ address: staking, abi: stakingAbi, functionName: "claim" })}
                disabled={!pending || claimTx.isBusy}
              >
                {claimTx.isBusy ? "Claiming…" : "Claim rewards"}
              </button>
              <button
                className="secondary"
                onClick={() => faucetTx.send({ address: token, abi: tokenAbi, functionName: "faucet" })}
                disabled={faucetTx.isBusy}
              >
                {faucetTx.isBusy ? "Minting…" : "Get 1,000 test STK"}
              </button>
            </div>
            <Feedback errors={[claimTx.error, faucetTx.error]} />
          </section>

          <div className="grid">
            <section className="card" aria-label="Stake">
              <h2>Stake</h2>
              <AmountInput value={stakeInput} onChange={setStakeInput} onMax={() => balance !== undefined && setStakeInput(formatUnits(balance, 18))} />
              {needsApproval ? (
                <button
                  onClick={() => approveTx.send({ address: token, abi: tokenAbi, functionName: "approve", args: [staking, maxUint256] })}
                  disabled={approveTx.isBusy || stakeTooHigh}
                >
                  {approveTx.isBusy ? "Approving…" : "Approve STK"}
                </button>
              ) : (
                <button
                  onClick={() => stakeAmount && stakeTx.send({ address: staking, abi: stakingAbi, functionName: "stake", args: [stakeAmount] })}
                  disabled={!stakeAmount || stakeTooHigh || stakeTx.isBusy}
                >
                  {stakeTx.isBusy ? "Staking…" : stakeTooHigh ? "Not enough STK" : "Stake"}
                </button>
              )}
              <Feedback errors={[approveTx.error, stakeTx.error]} />
            </section>

            <section className="card" aria-label="Unstake">
              <h2>Unstake</h2>
              <AmountInput value={unstakeInput} onChange={setUnstakeInput} onMax={() => staked !== undefined && setUnstakeInput(formatUnits(staked, 18))} />
              <button
                onClick={() => unstakeAmount && unstakeTx.send({ address: staking, abi: stakingAbi, functionName: "unstake", args: [unstakeAmount] })}
                disabled={!unstakeAmount || unstakeTooHigh || unstakeTx.isBusy}
              >
                {unstakeTx.isBusy ? "Unstaking…" : unstakeTooHigh ? "More than staked" : "Unstake"}
              </button>
              <p className="muted small">Unstaking keeps your pending rewards. Claim them any time.</p>
              <Feedback errors={[unstakeTx.error]} />
            </section>
          </div>
        </>
      )}

      <footer className="footer">
        {explorerUrl(staking) ? (
          <>
            <a href={explorerUrl(staking)} target="_blank" rel="noreferrer">Staking contract</a>
            <a href={explorerUrl(token)} target="_blank" rel="noreferrer">STK token</a>
          </>
        ) : (
          <span>Local Hardhat network</span>
        )}
        <a href="https://github.com/mme-sbahi/Staking-dApp" target="_blank" rel="noreferrer">Source code</a>
      </footer>
    </main>
  );
}

function Stat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className={live ? "value live" : "value"}>{value}</span>
    </div>
  );
}

function AmountInput({ value, onChange, onMax }: { value: string; onChange: (v: string) => void; onMax: () => void }) {
  return (
    <div className="amount">
      <input
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(",", "."))}
        aria-label="Amount in STK"
      />
      <button type="button" className="max" onClick={onMax}>MAX</button>
      <span className="unit">STK</span>
    </div>
  );
}

function Feedback({ errors }: { errors: (string | undefined)[] }) {
  const message = errors.find(Boolean);
  return message ? <p className="error" role="alert">{message}</p> : null;
}
