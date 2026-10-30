import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme/tokens.css";
// Core editor geometry must also be available when Notes opens before Code.
import "monaco-editor/min/vs/editor/editor.main.css";
import "./styles.css";
import "./theme/redesign.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
