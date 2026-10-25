import React from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

/* The only thing in the app that survives a render that throws.
   Before this existed, one object with an unexpected shape took the whole HQ to
   a white screen with no way back — not even the header. Each place wraps its
   own content in one of these so a crash in the Film Room leaves the nav, the
   Add menu and every other section still usable, and the root wraps the lot so
   a crash in the shell itself still says something. */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // There is no error service behind this app; the console is the only record.
    console.error(`Agent4 HQ crashed in ${this.props.label || "the shell"}.`, error, info?.componentStack || "");
  }

  componentDidUpdate(previous) {
    // Navigating away is itself a recovery: the next place gets a clean slate
    // rather than inheriting the crash that the last one left behind.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  retry() {
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const label = this.props.label || "this section";
    return (
      <div className="crash-state" role="alert">
        <div className="errorstate">
          <strong><TriangleAlert size={16} aria-hidden="true" /> {label} stopped working</strong>
          <p>Nothing you had saved is lost — the rest of the HQ is still running. Try this section again, and if it keeps failing, reload the page.</p>
          <p className="crash-state__detail">{String(this.state.error?.message || this.state.error)}</p>
          <div className="crash-state__actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={this.retry}>
              <RotateCcw size={15} aria-hidden="true" /> Reload this section
            </button>
            <button type="button" className="btn btn--lg" onClick={() => window.location.reload()}>Reload the page</button>
          </div>
        </div>
      </div>
    );
  }
}
