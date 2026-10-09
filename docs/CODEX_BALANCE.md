# TowerDefence — Balance Rules / Current Intent

Use this only when the task touches balance.

Current config remains authoritative. This file documents important design intent to avoid accidental regressions.

## General
- Prefer targeted balance changes.
- Do not rebalance unrelated units.
- Keep unit identity intact.
- Use playtest feedback as the main reason for changes.
- For small changes, update only the relevant values/tests.

## Current HP scaling direction
Campaign target currently ends at Wave 50.

Known progression:
- 1–10: 1x
- 11–20: 2x
- 21–30: 4x
- 31–40: 8x
- 41–50: 12x

Free Play after Wave 50 increases by +4x per 10-wave tier:
- 51–60: 16x
- 61–70: 20x
- 71–80: 24x
- 81–90: 28x
- 91–100: 32x
- 101–110: 36x

Avoid restoring exponential doubling unless explicitly requested.

## Wave 50
Wave 50 is the current campaign victory point.

After completion:
- pause Auto Run
- show victory
- player may continue to Free Play
- preserve run state

## Ancient Grove identity
- long maze
- sustained exposure
- many cheap foundational units
- Living Maze/DoT synergy
- specialized anti-air through Thorn Owl

Treants should feel strong enough as cheap foundation.

Thorn Owl is air-only and early flying waves should prepare the player for later hard air checks, not act as an early hard wall.

## Skeleton King
Current intent:
- slow boss
- base HP not arbitrarily inflated
- active milestone affixes apply
- numeric affix strength stronger than normal (currently 1.5x)
- Wave 50 capstone

## Balance workflow
1. change only requested stats/mechanics
2. update focused assertions
3. run relevant tests
4. report old/new values briefly
5. do not widen scope unless a clear blocker is found
