"use client";

import dynamic from "next/dynamic";

// Wallet libraries only run in the browser, so the dApp is rendered client-side only.
const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => <main className="shell"><p className="muted">Loading…</p></main>,
});

export function ClientApp() {
  return <App />;
}
