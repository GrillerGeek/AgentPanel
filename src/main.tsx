import ReactDOM from "react-dom/client";
import App from "./App";

// NOTE: React.StrictMode is intentionally omitted for the Phase 0 spike — its
// dev-mode double-mount would spawn two PTYs per pane. Reintroduce it once
// terminal lifecycle is idempotent (Phase 1).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
