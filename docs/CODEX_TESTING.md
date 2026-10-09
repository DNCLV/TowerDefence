# TowerDefence — Testing Guide for Codex

Use the smallest relevant test set for the task. Do not run the entire suite for every tiny change.

## Always useful
- `npx tsc --noEmit`
- `git diff --check`

## Balance/config change
Usually run:
- `npx tsc --noEmit`
- relevant focused unit/gameplay test
- `npm run test:gameplay-depth` if affected
- `git diff --check`

Only run `test:enemy-waves` when wave/enemy behavior is touched.

## Asset/model change
Usually run:
- `npx tsc --noEmit`
- `npm run test:content-assets`
- `npm run build`
- `git diff --check`

Run browser/model smoke test only when useful and available.

## Map/pathfinding change
Usually run:
- `npx tsc --noEmit`
- `npm run test:map-adjustments`
- `npm run test:shortest-routes`
- `git diff --check`
- `npm run build` when renderer/runtime assets are affected

## Faction/specialization change
Usually run:
- `npx tsc --noEmit`
- relevant faction/unit test
- `npm run test:faction-bonuses`
- specialization test if relevant
- `git diff --check`

## Performance/build pass
Run:
- `npx tsc --noEmit`
- `npm run test:content-assets`
- `npm run test:performance-build`
- `npm run build`
- `git diff --check`

## Full validation
Reserve broad/full suites for:
- large cross-cutting changes
- release/checkpoint validation
- multiplayer architecture changes
- major pathfinding/map changes
- major renderer refactors

## Environment failures
If a test is blocked by browser/CDP/sandbox tooling:
- report it separately
- do not treat it as a code failure
- do not rewrite unrelated code just to bypass the environment problem

## Test discipline
- Never delete/bypass tests merely to make CI green.
- Update stale assertions only when requested behavior intentionally changed.
- Prefer deterministic tests over timing-sensitive browser checks for gameplay logic.
