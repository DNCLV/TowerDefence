export type GameSpeedMultiplier = 1 | 2;

/** One clock controls all gameplay time; presentation input/camera continue on real time. */
export class SimulationClock {
  private multiplier: GameSpeedMultiplier = 1;
  private paused = false;

  get speedMultiplier(): GameSpeedMultiplier { return this.multiplier; }
  get isPaused(): boolean { return this.paused; }

  toggleSpeed(): GameSpeedMultiplier {
    this.multiplier = this.multiplier === 1 ? 2 : 1;
    return this.multiplier;
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  setPaused(paused: boolean): void { this.paused = paused; }

  toSimulationDelta(realDeltaSeconds: number): number {
    if (this.paused || !Number.isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return 0;
    return realDeltaSeconds * this.multiplier;
  }

  reset(): void {
    this.multiplier = 1;
    this.paused = false;
  }
}
