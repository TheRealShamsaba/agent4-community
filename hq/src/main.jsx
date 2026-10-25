import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { TelegramHomeCourt } from "./components/TelegramHomeCourt.jsx";
import { readSnapshot } from "./data.js";
import { installSessionFetch } from "./api.js";
import "./styles.css";
installSessionFetch();

const { snapshot, isLive } = readSnapshot();
if (['/telegram','/telegram/'].includes(window.location.pathname)) {
  const bridge = document.createElement('script'); bridge.src = 'https://telegram.org/js/telegram-web-app.js'; document.head.append(bridge);
}
const isTelegramHomeCourt = ["/telegram", "/telegram/"].includes(window.location.pathname);
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* The last line of defence. Each place wraps its own content, but a throw
        in the shell itself has to land somewhere other than a white screen. */}
    <ErrorBoundary label="Agent4 HQ">
      {isTelegramHomeCourt ? <TelegramHomeCourt snapshot={snapshot} /> : <App snapshot={snapshot} isLive={isLive} />}
    </ErrorBoundary>
  </React.StrictMode>
);
