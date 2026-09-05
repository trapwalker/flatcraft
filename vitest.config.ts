import { defineConfig } from 'vitest/config';

// INFRA-1 follow-up: with no config at all, vitest's default include glob
// (`**/*.test.ts`) scans the whole project root — including `.claude/worktrees/`,
// where isolated subagents (see the `Agent` tool's `isolation: "worktree"`) check
// out their own copy of this repo, `src/*.test.ts` and all. Without an explicit
// exclude here, running `make test-client` while such a worktree exists silently
// double-runs every test (discovered running EVT-1's own tests, right after the
// subagent that wrote them finished in its worktree) — harmless to correctness
// (both copies pass or fail identically) but doubles runtime and clutters output
// enough to obscure a real new failure among the duplicates.
export default defineConfig({
  test: {
    // Explicitly setting `exclude` replaces vitest's own default list rather than adding to it,
    // so this repeats vitest's defaults (node_modules/dist/.git/etc. — see its docs) alongside
    // the one addition that actually motivated this file: `.claude`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.claude/**'
    ]
  }
});
