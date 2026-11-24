import ReactDOM from "react-dom/client";
import { html } from "./html.js";
import { App } from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
