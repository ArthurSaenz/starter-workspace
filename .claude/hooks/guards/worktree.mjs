// BLOCK raw `git worktree add|remove`; ADVISE on `git worktree list`. Path-independent, because
// what matters is the setup infra-kit does — and `git worktree add ../my-branch` skips it precisely
// BY landing outside the managed dir. A throwaway worktree just goes through the human instead.

export const name = 'worktree';

// Checked per shell segment, so `cd /repo && git worktree add ...` is still seen despite the ^.
export const scope = 'segment';

// Allows leading `VAR=val` and `-C <path>` / `--git-dir=<path>`; anchored so it won't fire on
// `git commit -m "...worktree add..."`.
const GIT_PREFIX = String.raw`^([A-Za-z_][A-Za-z0-9_]*=[^ ]+ +)*git +(-C +[^ ]+ +|--git-dir=[^ ]+ +)*worktree +`;

const RE_MANAGED = new RegExp(`${GIT_PREFIX}(add|remove)\\b`);
const RE_LIST = new RegExp(`${GIT_PREFIX}list\\b`);

const BLOCK_MSG =
  "Use infra-kit's MCP worktree tools instead of raw 'git worktree add/remove': 'worktrees-add' / 'worktrees-remove'. Raw git skips infra-kit's setup (pnpm install, IDE open, release description), which is why the branch works but the worktree is half-configured. If you are inside a linked worktree, cd to the main checkout first — both raw git and the MCP tool refuse worktree management from within a linked worktree. If you truly want an unmanaged throwaway worktree, ask the user to run the git command themselves.";

const ADVISE_MSG =
  "There is also an infra-kit 'worktrees-list' MCP tool that returns a structured release-worktree summary (version, release type, Jira description). Prefer it for release-worktree info; keep using 'git worktree list' when you need the full inventory (feature/ad-hoc worktrees, the main checkout, paths or HEADs), which the MCP tool does not cover.";

export function check(command) {
  if (RE_MANAGED.test(command)) return { action: 'block', message: BLOCK_MSG };
  if (RE_LIST.test(command)) return { action: 'advise', context: ADVISE_MSG };
  return null;
}
