// Auto-mode gating.
//
// `permission_mode` is one of: default | plan | acceptEdits | bypassPermissions.
// A session is "auto" when its last-stashed mode is in the configured accepted set.
// A missing/never-stashed mode is never auto (fail safe: no notification).

export function isAutoMode(stashedMode, autoModes) {
  if (!stashedMode) return false;
  const accepted = Array.isArray(autoModes) ? autoModes : ['bypassPermissions'];
  return accepted.includes(stashedMode);
}
