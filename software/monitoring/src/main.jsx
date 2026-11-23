import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { savedTheme } from "./lib.js";
import "./styles.css";

document.documentElement.dataset.theme = savedTheme();
createRoot(document.getElementById("root")).render(<App />);
