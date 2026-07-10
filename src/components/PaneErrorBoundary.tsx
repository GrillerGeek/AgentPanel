import { Component, type ReactNode } from "react";

/**
 * Per-pane error boundary (issue #18). Without one, a render/effect crash in a
 * single TerminalPane (xterm edge cases, addon failures, bad PTY data) unmounts
 * the entire React tree and every session with it. The fallback keeps the crash
 * contained to its pane; "Reload pane" remounts the children from scratch, which
 * spawns a fresh terminal.
 */
export class PaneErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="pane-error" role="alert">
          <div className="pane-error-title">Terminal crashed</div>
          <div className="pane-error-detail">{error.message}</div>
          <button className="pane-error-reload" onClick={() => this.setState({ error: null })}>
            Reload pane
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
