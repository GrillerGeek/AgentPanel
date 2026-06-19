import { TerminalPane } from "./Terminal";
import "./App.css";

function App() {
  return (
    <div className="app">
      <header className="titlebar">
        AgentPanel · terminal spike (Phase 0)
      </header>
      <main className="content">
        <TerminalPane />
      </main>
    </div>
  );
}

export default App;
