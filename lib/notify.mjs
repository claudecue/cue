// Cross-platform desktop notification delivery.
//
// `buildCommand` is pure: it returns { cmd, args[] } (an argv array, never a
// shell string) so identity/branch text can't inject shell commands. `send`
// detects notifier availability, builds the argv, and spawns it detached,
// swallowing every error so a notifier failure never nags the user.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';

// AppleScript string literal escaping: backslash and double-quote.
function asString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// PowerShell single-quoted string escaping: double the single quotes.
function psSingle(s) {
  return String(s).replace(/'/g, "''");
}

function buildDarwin({ title, body, subtitle, sessionId, sound, hasTerminalNotifier }) {
  if (hasTerminalNotifier) {
    const args = [
      '-title', title,
      '-message', body,
      '-group', `cue-${sessionId}`,
    ];
    if (subtitle) args.push('-subtitle', subtitle);
    if (sound) args.push('-sound', 'default');
    return { cmd: 'terminal-notifier', args };
  }
  // osascript fallback: a single -e script string, passed as one argv element
  // (no shell), with AppleScript-level string escaping.
  let script = `display notification ${asString(body)} with title ${asString(title)}`;
  if (subtitle) script += ` subtitle ${asString(subtitle)}`;
  if (sound) script += ' sound name "default"';
  return { cmd: 'osascript', args: ['-e', script] };
}

function buildLinux({ title, body, sessionId }) {
  const args = [
    '--app-name=Cue',
    '--urgency=normal',
    '--category=im.received',
    `--hint=string:x-canonical-private-synchronous:cue-${sessionId}`,
    title,
    body,
  ];
  return { cmd: 'notify-send', args };
}

function buildWin32({ title, body, sessionId, sound, hasBurntToast }) {
  const t = psSingle(title);
  const b = psSingle(body);
  const tag = psSingle(`cue-${sessionId}`.slice(0, 64));
  let script;
  if (hasBurntToast) {
    const silent = sound ? '' : ' -Silent';
    script =
      `Import-Module BurntToast; ` +
      `New-BurntToastNotification -Text '${t}', '${b}' ` +
      `-Group 'Cue' -UniqueIdentifier '${tag}'${silent}`;
  } else {
    // Raw WinRT toast via PowerShell.
    const xml =
      `<toast><visual><binding template='ToastGeneric'>` +
      `<text>${t}</text><text>${b}</text>` +
      `</binding></visual></toast>`;
    script =
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; ` +
      `$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; ` +
      `$xml.LoadXml('${psSingle(xml)}'); ` +
      `$toast = New-Object Windows.UI.Notifications.ToastNotification $xml; ` +
      `$toast.Tag = '${tag}'; $toast.Group = 'Cue'; ` +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Cue').Show($toast)`;
  }
  return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
}

export function buildCommand(opts) {
  switch (opts.platform) {
    case 'darwin':
      return buildDarwin(opts);
    case 'linux':
      return buildLinux(opts);
    case 'win32':
      return buildWin32(opts);
    default:
      return null;
  }
}

// --- availability detection (best-effort, never throws) ---

// Resolve a binary to an absolute path by scanning PATH plus extra directories.
// Hooks run in non-interactive shells whose PATH often omits Homebrew/nvm dirs,
// so relying on PATH alone (or `which`) would miss a notifier the user installed.
export function findBinary(name, { env = process.env, extraDirs = [], exists = existsSync } = {}) {
  const fromPath = (env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of [...fromPath, ...extraDirs]) {
    const candidate = join(dir, name);
    try {
      if (exists(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Common install locations not always on a non-interactive PATH.
const MAC_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

function hasBurntToastModule() {
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', 'if (Get-Module -ListAvailable BurntToast) { exit 0 } else { exit 1 }'],
      { stdio: 'ignore', timeout: 4000 },
    );
    return true;
  } catch {
    return false;
  }
}

export function send(opts) {
  try {
    const platform = opts.platform || process.platform;
    const detected = {};
    let notifierPath = null;
    if (platform === 'darwin') {
      notifierPath = findBinary('terminal-notifier', { extraDirs: MAC_BIN_DIRS });
      detected.hasTerminalNotifier = !!notifierPath;
    }
    if (platform === 'win32') detected.hasBurntToast = hasBurntToastModule();

    const command = buildCommand({ ...opts, platform, ...detected });
    if (!command) return false;
    // Run terminal-notifier by absolute path so it works even when PATH wouldn't find it.
    if (notifierPath) command.cmd = notifierPath;

    const child = spawn(command.cmd, command.args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
