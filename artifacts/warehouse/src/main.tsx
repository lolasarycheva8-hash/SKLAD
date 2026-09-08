import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

setBaseUrl(import.meta.env.BASE_URL.replace(/\/$/, ""));

createRoot(document.getElementById("root")!).render(<App />);
