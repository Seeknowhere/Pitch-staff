import ReactDOM from "react-dom/client";
import { App } from "./App.jsx";
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// keep Tono installed and working offline (only on the live site, not while developing)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
