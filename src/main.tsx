import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Force light mode: remove any dark class and lock color-scheme
document.documentElement.classList.remove("dark");
document.documentElement.classList.add("light");
document.documentElement.style.colorScheme = "light";

createRoot(document.getElementById("root")!).render(<App />);
