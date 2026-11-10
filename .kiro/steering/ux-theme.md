---
inclusion: fileMatch
fileMatchPattern: "{apps/web,apps/desktop,apps/watch-zepp,packages/ui-kit}/**"
---

# UX & theme (§14)

The full screen specs are in `docs/architecture.md` §14:
- §14.1 PWA routes and states
- §14.2 approval sheet
- §14.3 desktop tray and menu
- §14.4 watch screens at 390×450
- §14.5 notification copy

Read the relevant subsection before building any screen.

## Theme: Kiroween, tasteful
Theme setting: **System** (default; follows `prefers-color-scheme`), Crypt, or Daylight (DECISION-40).

| Token | Crypt (dark) | Daylight (light) |
|---|---|---|
| `--bg` | `#0e0b16` | `#f7f5fb` |
| `--surface` | `#17122a` | `#ffffff` |
| `--surface-2` | `#211a3a` | `#efeaf7` |
| `--text` | `#ece8f6` | `#1b1430` |
| `--text-muted` | `#9a92b4` | `#5e5679` |
| `--accent` (wisp violet) | `#a658eb` | `#4c21ae` |
| `--accent-2` (ectoplasm) | `#56e0c0` | `#0b7a6a` |
| `--warn` | `#f5b449` | `#8f5600` |
| `--danger` | `#ff6b7a` | `#c62839` |
| `--ok` | `#58d68d` | `#177a42` |
| `--border` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.08)` |
| `--grad-a` (indigo dusk) | `#3d27ad` | `#3d27ad` |
| `--grad-b` (plum night) | `#6b16a5` | `#6b16a5` |
| `--tint` (page ground under cards) | `#1b1530` | `#f4f1fc` |
| `--shadow` | `rgba(0,0,0,.45)` | `rgba(76,33,174,.16)` |

- **State dots:**
  - working = `--accent-2` with a slow 2s pulse
  - blocked = `--warn` with a 1s blink
  - idle = `--text-muted`, avatar at opacity 0.55 (a "dimmed sprite")
  - offline = dashed
  - paused = dashed + ⏸ badge (node announced `node.paused`)
  - terminal = `--warn` outline + terminal glyph (Terminal mode)
  - swap-mode seat: member chip badge "swap" (tooltip "shares one process with @bot's other chats")
  - member chip "in terminal" for a bot in Terminal mode (groups); group messages to it show "queued · after terminal"
  - HandoffCard mode: "asked" (assign) / "handed to" (transfer); the sender's turn ends with "handed this to @x"
  - composer (C68): textarea up to 6 lines (phone) / 10 lines or 40 % (desktop) then scrolls; pill at 1 line, radius 22px from 2 lines; buttons bottom-aligned; desktop Enter sends, Shift+Enter new line, never send while `isComposing`; phone Return = new line; counter from 90 % of 16 000; pastes > 20 lines become a "Pasted N lines" chip above the textarea; Enter never stops a bot; bubbles `pre-wrap`, Show more after 12 lines
  - Settings → Relay: cards Local / Your Cloudflare / Self-hosted; actionable only in Wraith.app on a machine (wizard: Relay URL → Check → "Who holds the owner key?" Create on my phone (default, QR) / Create here, or Join Space → Switch, disabled while work runs; "Go back to Local" sheet); read-only elsewhere with "Change the relay on a machine: Wraith.app or wraith-node"
  - voice engine per device: Automatic (node if ready, else Browser speech) / Wraith node / Browser speech ("may use Apple/Google/Microsoft servers"); Settings lists each machine's voice status
  - voice input (P9.18): 🎙 left of Send, "Listening… 0:07" + level bar while recording, result lands in the composer as editable text (never auto-sent), matched names listed in a strip above the composer ("heard 'แอป' → @app"), never styled inside the box, sent voice messages carry a small mic glyph; no mic on approval, Autopilot or Terminal sheets
  - media (P9.19): media card in the bot bubble (thumbnail, name, size, dimensions or duration, ▶ on video), full-screen viewer with progress ring, "<machine> is offline" and "No longer on <machine>" states; 📎 left of 🎙 opens the picker in bot chats (greyed in groups), up to 4 upload chips above the textarea; oversized video preview → "Preview too large · Open on this Mac"; no push or watch item for media
  - needs_resolve = `--warn` + ! badge (back from terminal, waiting for a choice)
  - failed = `--danger`
- **Motif:** sprites — small glowing wisps (round body + two dot eyes), one set of clean SVGs in 6 variants (colour/face), used for avatars, empty states and the tray. Built from basic shapes so they work from 16px tray icons to the watch. No blood, no jump scares, no spooky sounds. Fog is a static background gradient only.
- **Motion:** UI transitions ≤ 200ms. The state pulse is the only looping animation. With `prefers-reduced-motion`, turn off all pulses and fades.
- **Accessibility:**
  - Contrast ≥ 4.5:1 for every text/surface pair (token test).
  - Touch targets ≥ 44px on touch hosts: a smaller icon (24px header icons) keeps a ≥ 44px hit area. Desktop pointer targets (32px pills, ⊐ Panel) may be 32px.
  - Visible focus rings.
  - State is never shown by colour alone.
- **Style (violet gradient):**
  - Brand gradient `linear-gradient(120deg, var(--grad-a), var(--grad-b))` on headers (curved bottom edge), the desktop sidebar, primary buttons, the send button and the user's own bubble.
  - White cards (`--surface`) on `--tint`, separated by soft `--shadow`, not borders.
  - Pill shapes for buttons, chips, inputs and toggles; cards use a 20–26px radius.
  - Allow = gradient pill; Reject = outlined `--danger` pill. The watch stays AMOLED black with gradient pills.
- **Fonts:** `Poppins` (400–700) for UI, then `IBM Plex Sans Thai` (400–700) for Thai, then `-apple-system` (`--font-ui`: `Poppins, "IBM Plex Sans Thai", -apple-system, system-ui, sans-serif`), both bundled as woff2 in `packages/ui-kit`, never loaded from Google Fonts at runtime; the watch uses its system font; `JetBrains Mono`/`ui-monospace` for code and terminals.
- **Wording:** The Crypt, Resurrect, sprite, haunt ("Your agents, haunting one room."). Say "Stop bot" in the UI, never "kill".

## Layout rules (§14.1)
- **Phone Home** `/`: chat list sorted by latest event, waiting chats first, approvals banner, filters All / Bots / Groups; header icons Search, ✎ New, ⚙ Settings; **no bottom tab bar**; chats, groups and Settings have Back → Home (DECISION-39).
- **Bot chat header** (bot chats only, never groups): path · Files · Changes (n) · Groups (n, phone only) · Autopilot (⚡ / purple pill with time left); phone Freeze sits in the top row, 40px (same as Back); phone second-row buttons are 36px circles; counts are top-right mini pill badges and the Autopilot time is a white pill centred on the bottom edge (weight 600), just before the Chat/Console switch · Freeze (❄ snowflake in `--accent`; never a stop square, which means Stop). Phone: icons open bottom sheets; Chat/Console switch is icon-only. Desktop: Files · Changes · Freeze as 32px icon+label pills before the Chat | Console switch, then the ⊐ Panel button.
- **Desktop side panel**: 420px for every content type, drag-resizable 320–640px, shown/hidden + width remembered per device; group = Members + Pending approvals, bot = About, or Files/Changes while active.
- **`/` picker**: above the composer; sections Wraith / @bot's skills; name + one-line description + kind badge; phone rows ≥ 44px, desktop popover ≤ 360px tall; agent text shown as plain text.
- **Rewind** (bot chats, supported agents only): long-press/hover menu on your own message → Rewind to here; sheet of your prompts newest first with "N files changed after"; only the restore options the agent allows; code restore shows the file list (`bot.rewindPreview`) and says that files the bot edited go back to that point, including later edits by anyone, while files changed only by shell commands or subagents are not restored; later messages greyed, never removed.
- **Autopilot** (bot chats only): purple circle with the time-left pill in the bot chat header, a ⚡ h:mm pill in the Home row; auto-approved cards collapsed ("auto-approved by Autopilot"); the turn-on sheet lists what is allowed and what still asks; after 3 Allow once taps for one bot within 10 min the approval sheet shows a dismissible "Approving a lot? Autopilot for @bot · 1 h" strip (never turns it on by itself).
- **Terminal mode**: amber banner under the bot chat header with a terminal icon ("@bot is in terminal mode on <machine> · approvals happen in the terminal", Open console, Back to Wraith); entry from the Console pane-head button (a small >_ Open in terminal in the head bar of the bot's main-session pane, becomes Back to Wraith during a stay) or from the TUI-only `/` strip/chip, always through the confirmation sheet; no segmented switch; Home row "Terminal" pill; queued messages say "queued · after terminal"; return card "Back from terminal" with imported turns labelled "from terminal · not verified"; TUI-only commands at the end of the `/` picker with a Terminal badge.
- **Respond (groups)**: long-press a member chip → "↩ Respond to the chat"; desktop shows a small ↩ Respond button on hover; the bot card has the same button with "Will read N new messages".
- **Send ⇄ Stop**: while a bot in this chat works and the composer is empty, the send button becomes ■ Stop (`bot.cancel`); typing restores Send; groups with several working bots get "Stop which bot?". Freeze ≠ Stop: Freeze only stops handoffs.
- **Esc to stop** (desktop): "Press Esc again to stop @bot" bar above the composer for 2s; "Stop which bot?" popover in groups; phone uses the ■ Stop send button.
- **Long names**: one line with ellipsis; counts, chips and buttons never shrink.
- **Access levels** (`cap()` gate): Approve only = quick-message picker + Allow once / Reject; View only = no composer, approval sheet without buttons. Hide controls, don't just disable them.

## Approval UX rules (security-relevant)
- Before showing Allow, verify the node signature on `approval.request`. If verification fails, show the request but disable every allow-kind button.
- From a locked-screen notification, an approval takes at most two taps (G2).
- The watch offers only Allow once / Reject once. Hide Allow when the request has a diff or a truncated summary, and show "Open on phone" instead.
