import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/globals.css";
import { I18nProvider } from "./lib/i18n/use-i18n";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("缺少 #root 挂载节点");

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
