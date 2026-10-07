# Skeletal Commander phase readiness

The Commander is currently a normal single-life `Enemy` using the shared defeat path in `GameState.applyTowerDamage`. When HP reaches zero, that method marks the enemy dead, grants its reward, and increments the kill counter. There is no Commander-specific death handling or phase state today.

For a future mounted-to-ground transition, keep the transition at that shared defeat boundary, before terminal reward/kill bookkeeping. A small generic result such as `transitionToSuccessor` (or an `onDeathTransition` on enemy archetype data) can replace the defeated phase with a successor enemy at the same position. The successor should receive a ground route from its current cell to the goal, while the encounter remains active and terminal reward/kill accounting happens only when the ground phase is defeated.

That follow-up will need explicit phase/successor data and a separate ground Commander configuration (HP, movement type, speed, reward policy), plus a suitable ground visual/animation. None of those fields, assets, rewards, or transitions are implemented in this milestone.
