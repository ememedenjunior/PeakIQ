import { Component } from 'react';

// Without this, one rendering error blanks the whole site. With it, the person sees a way forward.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center" role="alert">
        <h2>Something went wrong</h2>
        <p className="muted">The page hit an unexpected problem. Reloading usually fixes it.</p>
        <button className="btn" onClick={() => window.location.reload()}>Reload the page</button>
      </div>
    );
  }
}
