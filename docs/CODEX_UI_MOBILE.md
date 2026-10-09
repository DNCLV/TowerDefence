# TowerDefence — UI & Mobile Rules

Use this when changing HUD, carousel, faction select, minimap, touch controls, or GitHub Pages mobile behavior.

## Mobile-first principles
- Touch-friendly targets.
- Respect safe areas.
- Avoid fragile fixed-pixel layouts.
- Prefer flex/grid/clamp/minmax and responsive sizing.
- Avoid overlap between HUD elements.
- Do not make selected carousel cards resize the layout unpredictably.
- Preserve desktop mouse/keyboard behavior.

## Tower carousel
Desired behavior:
- selected unit centered/highlighted
- adjacent options visible
- arrows have dedicated slots
- no overlap with cards
- no overlap with Start Wave/Auto controls
- touch/drag/click/keyboard supported
- snap-to-center
- stable responsive card sizing

## Selected tower HUD
Keep compact.

Preferred direction:
- portrait on left
- compact `BUFFS` row with icons
- stats in center
- info/upgrade/sell on right
- Veteran progression may use compact text
- avoid verbose buff paragraphs in primary HUD

## Minimap
OPEN:
- minimap visible on left
- narrow vertical tab attached to right side
- left-pointing arrow

CLOSED:
- minimap retracts fully
- only narrow tab remains flush left
- right-pointing arrow

No empty dead space when closed.

## Touch input
- camera pan must not accidentally place/select towers
- pinch zoom must not place towers
- UI taps must not pan camera
- touch ownership/pointer capture must be explicit
- audit `touch-action` and passive listeners where relevant

## GitHub Pages
When debugging mobile Pages behavior:
- test subpath/base-path assumptions
- do not assume root `/`
- keep runtime asset URLs compatible with Vite/GitHub Pages deployment
