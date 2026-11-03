'use client';

import { Component, type ReactNode } from 'react';

// Catches a glitch inside part of the player's screen (Now Playing, the bar)
// so only that part resets. The music, the queue and the YouTube player live
// outside it and keep going.
export default class SafeBoundary extends Component<{ children: ReactNode; onReset?: () => void; label?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Player screen error:', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="safe-boundary" role="alert">
        <span>{this.props.label ?? 'This part of the player hit a glitch. Your music is still playing.'}</span>
        <button
          type="button"
          className="chip"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onReset?.();
          }}
        >
          OK
        </button>
      </div>
    );
  }
}
