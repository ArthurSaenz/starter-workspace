#!/usr/bin/env node
//
// Notification hook — currently a no-op. To enable a macOS desktop notification, uncomment:
//
//   import { readFileSync } from 'node:fs';
//   import { spawnSync } from 'node:child_process';
//   const { message } = JSON.parse(readFileSync(0, 'utf8'));
//   spawnSync('osascript', [
//     '-e',
//     `display notification "${message || 'Claude needs your attention'}" with title "Claude Code"`,
//   ]);

process.exit(0);
