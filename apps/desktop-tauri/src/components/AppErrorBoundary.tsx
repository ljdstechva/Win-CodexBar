import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[codexbar] fatal render failure", error.name, error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="shell">
        <section className="panel error" role="alert">
          <h2>CodexBar could not render</h2>
          <p>The interface failed to load. Reload CodexBar to rebuild this view.</p>
          <button
            type="button"
            className="menu-surface__primary-btn"
            onClick={() => window.location.reload()}
          >
            Reload CodexBar
          </button>
        </section>
      </main>
    );
  }
}
