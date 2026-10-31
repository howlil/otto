import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";
import "./styles/home.css";
import "./styles/settings.css";
import "./styles/agent.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing Otto root element");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
