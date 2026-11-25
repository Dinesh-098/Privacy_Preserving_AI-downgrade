import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles.css";
import { App } from "./app";

const query = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 3000, refetchOnWindowFocus: false } } });
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <QueryClientProvider client={query}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>
</React.StrictMode>);
