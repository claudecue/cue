// Best-effort terminal / multiplexer identity hints.
//
// Recorded in session state at Stop time (when the session's real environment is
// present) so a FUTURE focus / "control tower" feature can target the right
// window without a schema change. v1 deliberately never acts on these — none of
// the click-to-focus delivery paths are reliable enough to ship for everyone, so
// this is descriptive groundwork only. Invent nothing; only record what's set.

export function terminalHints(env = {}) {
  const hints = {};
  if (env.TERM_PROGRAM) hints.termProgram = env.TERM_PROGRAM;
  if (env.TERM_PROGRAM_VERSION) hints.termProgramVersion = env.TERM_PROGRAM_VERSION;
  // tmux only counts when we actually have a pane to target.
  if (env.TMUX && env.TMUX_PANE) {
    hints.multiplexer = 'tmux';
    hints.tmuxPane = env.TMUX_PANE;
  }
  if (env.ITERM_SESSION_ID) hints.itermSessionId = env.ITERM_SESSION_ID;
  if (env.WEZTERM_PANE) hints.weztermPane = env.WEZTERM_PANE;
  if (env.KITTY_WINDOW_ID) hints.kittyWindowId = env.KITTY_WINDOW_ID;
  return hints;
}
