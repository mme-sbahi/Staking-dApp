"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http, WagmiProvider } from "wagmi";
import { hardhat } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { chain } from "@/config/contracts";

// WalletConnect needs a project id for mobile wallets; browser extensions work with the placeholder.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "staking-dapp-local";

const config = getDefaultConfig({
  appName: "Stake STK",
  projectId,
  chains: [chain],
  transports: {
    [chain.id]: http(chain.id === hardhat.id ? "http://127.0.0.1:8545" : process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
  },
  ssr: true,
});

// Local development only: a pre-funded Hardhat account, so the UI can be exercised without a browser wallet.
export const devConnector =
  chain.id === hardhat.id
    ? mock({ accounts: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"], features: { reconnect: true } })
    : undefined;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#7c5cff", borderRadius: "medium" })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
