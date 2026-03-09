import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Apply stored theme or default to light
const storedTheme = localStorage.getItem("he-theme") || "light";
document.documentElement.classList.remove("light", "dark");
document.documentElement.classList.add(storedTheme);
document.documentElement.style.colorScheme = storedTheme;

createRoot(document.getElementById("root")!).render(<App />);
