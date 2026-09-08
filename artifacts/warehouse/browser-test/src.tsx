import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MyDeliveries from "../src/pages/my-deliveries";
import "./test.css";

const root = document.getElementById("root");
if (!root) throw new Error("Browser test root is missing");

createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <MyDeliveries />
  </QueryClientProvider>,
);