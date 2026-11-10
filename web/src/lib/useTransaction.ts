"use client";

import { useEffect, useState } from "react";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

/** Turn a wallet or contract error into one short sentence for the UI. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      const messages: Record<string, string> = {
        ZeroAmount: "Enter an amount greater than zero.",
        InsufficientStake: "You can't unstake more than you have staked.",
        NothingToClaim: "There are no rewards to claim yet.",
        InsufficientRewardPool: "The reward pool is empty. Your rewards are safe and can be claimed once it is refilled.",
        FaucetCooldown: "Faucet already used. You can request more test tokens once an hour.",
      };
      return messages[revert.data.errorName] ?? revert.data.errorName;
    }
    if (error.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError")) return "Transaction rejected in the wallet.";
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Wraps a contract write and its confirmation. `onConfirmed` runs once the transaction is mined,
 * so callers can refetch balances.
 */
export function useTransaction(onConfirmed: () => void) {
  const { writeContractAsync, isPending: isSigning } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}`>();
  const [error, setError] = useState<string>();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) {
      onConfirmed();
      setHash(undefined);
    }
    if (receipt.isError) {
      setError(describeError(receipt.error));
      setHash(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess, receipt.isError]);

  async function send(request: Parameters<typeof writeContractAsync>[0]) {
    setError(undefined);
    try {
      setHash(await writeContractAsync(request));
    } catch (err) {
      setError(describeError(err));
    }
  }

  return { send, error, hash, isBusy: isSigning || (!!hash && receipt.isLoading) };
}
