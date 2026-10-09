# Royal Guard vs Ancient Grove: three-map balance audit

Audit date: 2026-10-09. Deterministic seed `0x5eed1234`, 0.05-second steps. This is analysis only; no gameplay value was changed.

## 1. Executive summary

Royal Guard has the overall advantage on all three solo maps, but it is not healthy on every map. Open Field is the only reference layout where Royal clears the tested Wave 15 and Wave 30 builds. Split Advance makes both factions unreliable in midgame, and Triple Convergence defeats both even after their reference compositions are scaled to the map's 2x enemy count.

Ancient Grove becomes relatively weaker on ground/mixed waves as lanes split: Living Maze and cheap placements can cover multiple fronts, but its melee AoE, exposure, and shared Thorn Rot are harder to concentrate. The effect is not unique to Grove—Royal also deteriorates sharply—but Grove consistently converts comparable gold into less damage and fewer kills.

Thorn Owl balance remains healthy through Wave 35. Grove's flawless AA cost is within 1-4% of Royal on most gates and is 16.7% cheaper on Split Advance Wave 35. Triple Convergence Wave 42 is a shared coverage/capacity failure: neither faction cleared flawlessly within the tested 24 high-value AA cells, including 24 L3 towers.

### Method

- The harness explicitly runs `single-spawn`, `two-spawns`, and `three-spawns`; output is grouped by map.
- Air cells are selected deterministically from actual flying lanes using Royal's shorter five-cell range, and strongest upgrades receive the highest-coverage cells.
- Air searches test all normal mixes through 16 towers, then L3-only overflow mixes through 24 towers when necessary.
- Ground builds use the same composition profiles on each map and distribute placements round-robin across active lanes. Scaled references multiply composition by map enemy-count pressure (1x/1.5x/2x); Wave 1 uses starting-gold ratio.
- These are reproducible reference builds, not exhaustive build optimization. Wave 50 remains an isolated snapshot rather than a persistent campaign.

## 2. 1-Spawn results — Open Field

| Gate | Royal Guard | Ancient Grove | Advantage |
|---|---|---|---|
| Wave 1 | 100g/10; flawless | 98g/14; flawless | Even |
| Wave 10 | 320g/12; flawless | 325g/11; flawless | Even |
| Wave 15 | 540g/10; flawless | 536g/18; 7 leaks, 3 lives | Royal |
| Wave 30 | 1,390g/10; flawless | 1,406g/12; fails after 8 leaks | Royal |
| Wave 50 snapshot | 2,875g/30; fails, 121,506 damage | 2,789g/35; fails, 111,860 damage | Inconclusive; Royal damage lead |

Grove's Wave 15 build is Elder Bear + 4 Owl L1 + 10 Treant L2 + 3 Treant L1. Wave 30 uses 3 Elder Bears + Moon Seer + 8 Treant L3. Bark Titan carries the successful Wave 10 Grove build. This confirms the previous finding: early ground and AA are healthy, but Grove's mixed midgame is weaker.

## 3. 2-Spawn results — Split Advance

| Gate | Royal Guard scaled reference | Ancient Grove scaled reference | Advantage |
|---|---|---|---|
| Wave 1 | 140g/14; 1 leak, 9 lives | 133g/19; 6 leaks, 4 lives | Royal reliability |
| Wave 10 | 500g/18; 1 leak, 7 lives | 585g/17; 3 leaks, 3 lives | Royal |
| Wave 15 | 895g/15; 2 leaks, 8 lives | 919g/27; fails after 10 leaks | Royal |
| Wave 30 | 1,765g/15; fails after 6 leaks | 2,530g/18; fails after 10 leaks | Royal, but neither reliable |
| Wave 50 snapshot | 2,875g/30; fails, 97,622 damage | 2,789g/35; fails, 69,081 damage | Inconclusive; Royal damage lead |

The scaled Grove Wave 15 build uses 2 Elder Bears, 8 Owl L1, 14 Treant L2, and 3 Treant L1. Its two-lane maze reaches 52/49 cells, but divided Bear/AoE coverage and shared-effect setup do not produce a clear. Royal also loses reliability, showing that the map itself meaningfully raises positioning demands.

## 4. 3-Spawn results — Triple Convergence

| Gate | Royal Guard scaled reference | Ancient Grove scaled reference | Advantage |
|---|---|---|---|
| Wave 1 | 150g/15; 7 leaks, 3 lives | 147g/21; 6 leaks, 4 lives | Slight Grove result; both fragile |
| Wave 10 | 640g/24; 7 leaks, 1 life | 650g/22; fails after 8 leaks | Royal narrowly |
| Wave 15 | 1,080g/20; fails after 10 leaks | 1,072g/36; fails after 10 leaks | Neither; Royal kills more |
| Wave 30 | 2,780g/20; fails after 10 leaks | 2,812g/24; fails after 10 leaks | Neither; Royal 115,606 vs 75,464 damage |
| Wave 50 snapshot | 2,875g/30; fails, 111,699 damage | 2,789g/35; fails, 57,049 damage | Inconclusive; large Royal damage lead |

Triple Convergence is disproportionately punishing to both factions. Grove can build long routes (approximately 89/98/88 cells in its scaled Wave 15 layout), so physical build space is not the problem. Power and support are spread across three fronts, reducing local AoE, exposure uptime, and tower overlap.

## 5. Cross-map comparison

| Map | Enemy multiplier | Overall faction advantage | Grove relative trend | Primary concern |
|---|---:|---|---|---|
| Open Field | 1.0x | Royal from Wave 15 onward | Baseline | Grove mixed midgame |
| Split Advance | 1.5x | Royal, though both weaken | Weaker ground conversion | Two-front coverage and reliability |
| Triple Convergence | 2.0x | Royal relative damage; neither reliable | Weakest mixed-wave result | Three-front pressure overwhelms both references |

Royal is the relative winner on every map overall, but not because it clears every scenario. Its individually stronger generalists retain more value when pressure splits. Grove's many-tower identity remains physically practical; its problem is converting those placements into local killing power on every lane.

## 6. Air balance by map

Cheapest flawless builds; `>24` means no flawless result inside the tested 24-cell footprint.

| Map / wave | Royal gold / towers / mix | Grove gold / towers / best mix | Grove gold delta | Result |
|---|---|---|---:|---|
| 1 Spawn W14 | 125g / 1 Dragon | 135g / 4: 1 L1 + 3 L2 | +8.0% | Both flawless |
| 1 Spawn W21 | 375g / 3 Dragons | 325g / 10: 3 L1 + 7 L2 | -13.3% | Both flawless |
| 1 Spawn W35 | 970g / 10 mixed Archers | 925g / 15: 2 L1 + 10 L2 + 3 Elder | -4.6% | Both flawless |
| 1 Spawn W42 | 1,500g / 12 Dragons | 1,515g / 16: 9 L2 + 5 Needle + 2 Elder | +1.0% | Both flawless |
| 2 Spawns W14 | 250g / 2 Dragons | 255g / 12: 9 L1 + 3 L2 | +2.0% | Both flawless |
| 2 Spawns W21 | 625g / 5 Dragons | 615g / 16: 1 L1 + 15 L2 | -1.6% | Both flawless |
| 2 Spawns W35 | 2,125g / 17: 15 Dragons + 2 Rangers | 1,770g / 13: 3 L2 + 3 Needle + 7 Elder | -16.7% | Both flawless |
| 2 Spawns W42 | 3,000g / 24: 23 Dragons + Ranger | 2,970g / 18: 10 Needle + 8 Elder | -1.0% | Both flawless |
| 3 Spawns W14 | 375g / 3 Dragons | 390g / 11: 7 L1 + 3 L2 + Elder | +4.0% | Both flawless |
| 3 Spawns W21 | 1,000g / 8 Dragons | 935g / 14: 11 L2 + 3 Elder | -6.5% | Both flawless |
| 3 Spawns W35 | 3,000g / 24: 23 Dragons + Ranger | 2,970g / 18: 4 Needle + 14 Elder | -1.0% | Both flawless |
| 3 Spawns W42 | >3,000g / >24 | >3,960g / >24 | Not established | Neither clears within footprint |

Owl AA does not pay an excessive multi-spawn gold tax. Its greater range and Elderwing volley become valuable as lanes split. More Grove towers remain acceptable, and the upgrade mix shifts naturally from L1/L2 coverage toward Elderwing on hard multi-lane air.

## 7. Midgame reliability by map

| Map | Wave 15 scaled result | Wave 30 scaled result | Units carrying Grove | Finding |
|---|---|---|---|---|
| 1 Spawn | Royal flawless; Grove 7 leaks | Royal flawless; Grove fails | Bear/Treant, then Bear/Moon/Treant | Known Grove weakness |
| 2 Spawns | Royal 2 leaks; Grove fails | Both fail; Royal survives longer and deals more | Bears and Treants split across lanes | Grove weakness worsens |
| 3 Spawns | Both fail; Royal kills 41 vs Grove 30 | Both fail; Royal deals 53% more damage | 2 Bears + 20 L2 Treants at W15; 6 Bears + 2 Moon + 16 L3 Treants at W30 | Map pressure overwhelms both |

Druid/Seer upgrades retain their numeric value, but divided coverage limits how often their power is applied. Bark Titan is effective in the 1-spawn Wave 10 build; duplicating it across two or three lanes is much more expensive and still does not stabilize the scaled Grove references. No unit is proven viable only on 1-spawn, but Bark Titan and Elder Bear are the most lane-sensitive in these builds.

## 8. Gold efficiency by map

- Open Field: early ground spending is within 2%; Wave 30 Grove spends 1.2% more and fails while Royal clears.
- Split Advance: scaled Wave 15 spending is within 2.7%, but Grove fails; at Wave 30 Grove spends 43.3% more and both fail.
- Triple Convergence: scaled Wave 15/30 spending is within 1%, yet Royal consistently converts it into more kills/damage.
- AA remains close in gold across maps through Wave 35. The large absolute multi-spawn costs apply to both factions and track the 1.5x/2x enemy multipliers plus reduced overlap.
- Upgrade efficiency itself is unchanged by map. Owl L2, Druid L2, and Seer L2 remain better incremental raw-DPS buys than another L1; actual uptime and lane assignment determine realized value.

## 9. Map-space practicality

Physical build capacity is ample: the deterministic scan found 274, 543, and 1,731 buildable cells on the three maps. Ground reference routes reached 38-44 cells on Open Field, 45-52 on Split Advance, and roughly 78-98 on Triple Convergence.

The practical constraint is coverage, not raw cell count. Split Advance Wave 42 needs 24 Royal AA positions or 18 Grove positions. Triple Convergence Wave 35 needs 24 Royal or 18 Grove positions, and Wave 42 exceeds the tested 24-cell high-value footprint for both. Many cheap Grove towers remain placeable, but spreading aura, melee AoE, and exposure sources across three lanes reduces overlap and increases execution burden.

## 10. Faction/map sensitivity

- Royal's stronger individual towers and hybrid targeting scale better when each lane needs an independent core.
- Grove's Living Maze does function on every lane and creates long routes, but exposure value is local: a tower assigned to one front cannot capitalize on time accrued elsewhere.
- Thorn Rot remains shared per enemy, so extra lane coverage is useful; however, additional Treants on different lanes do not create multiplicative per-target stacks.
- Owl is the least problematic Grove unit across maps. Its range and L3 specializations scale well with split air paths.
- Bark Titan, Elder Bear, and short-range Druid builds are most sensitive to lane splitting. This audit does not establish that any is unusable outside Open Field, only that direct duplication is inefficient.

## 11. Biggest mismatches

1. **HIGH — Triple Convergence overall difficulty:** both factions fail realistic scaled Wave 10, 15, and 30 references; Wave 42 air exceeds a 24-tower high-value footprint.
2. **HIGH — Grove multi-lane mixed-wave conversion:** at comparable Wave 15/30 gold, Grove consistently records fewer kills and substantially less damage than Royal.
3. **MEDIUM — Split Advance midgame:** Royal also fails Wave 30, but Grove spends 43% more in the scaled reference and dies earlier.
4. **MEDIUM — multi-spawn melee/AoE coverage:** Bark Titan and Elder Bear lose concentration value when duplicated across fronts.
5. **LOW — Wave 50 evidence:** snapshots omit persistent economy, lives, purchases, and Royal Veteran progression.

## 12. Recommendations

No recommendation is implemented.

- **HIGH:** Add persistent Wave 1-50 build plans per solo map before changing balance. Retain actual map income, lives, towers, Veteran progression, and affixes.
- **HIGH:** Validate Triple Convergence's 2x count and Wave 42 coverage in browser play. The current evidence points to a map-wide pressure/coverage problem, not an Owl-specific problem.
- **HIGH:** Add per-lane combat attribution (damage, leaks, exposure time, and tower coverage) so Grove's failing front can be identified instead of inferred.
- **MEDIUM:** Test deliberately map-specific Grove compositions—more Seer/generalist coverage and one AoE anchor per lane—before considering stat changes to melee units.
- **LOW:** Keep current Thorn Owl stats. Revisit only if persistent campaign builds reproduce a Grove AA premium or failure; the isolated multi-map thresholds currently show healthy gold efficiency.
