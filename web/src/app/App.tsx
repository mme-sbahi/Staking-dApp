"use client";

import { StakingDashboard } from "@/components/StakingDashboard";
import { Providers } from "./providers";

export default function App() {
  return (
    <Providers>
      <StakingDashboard />
    </Providers>
  );
}
