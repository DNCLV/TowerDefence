import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { EnemyType } from "../config/EnemyConfig";
import type { EnemyAnimationDefinition, EnemyAnimationState } from "./EnemyAnimationConfig";

/** Renderer-only animation state. It never writes to an Enemy or GameState. */
export class EnemyAnimationController {
  private readonly clips = new Map<EnemyAnimationState, AnimationGroup>();
  private readonly groups: AnimationGroup[];
  private activeGroup?: AnimationGroup;
  private state?: EnemyAnimationState;
  private playbackSpeed = 1;
  private effectiveGameplaySpeed = 0;
  private paused = false;
  private deathFinished = false;

  constructor(
    groups: readonly AnimationGroup[],
    private readonly config: EnemyAnimationDefinition,
    private readonly debugContext?: { enemyId: number; enemyType: EnemyType; assetPath: string },
  ) {
    const requiredClips = Object.values(config.clips).filter((clip): clip is string => Boolean(clip));
    this.groups = groups.filter((group) => requiredClips.some((suffix) => group.name === suffix || group.name.endsWith(suffix)));
    groups.filter((group) => !this.groups.includes(group)).forEach((group) => { group.stop(true); group.dispose(); });
    this.removeRootMotionTracks(this.groups, config.ignoreRootMotionTargets);
    for (const [state, suffix] of Object.entries(config.clips) as [EnemyAnimationState, string][]) {
      const group = this.groups.find((candidate) => candidate.name === suffix || candidate.name.endsWith(suffix));
      if (group) this.clips.set(state, group);
    }
    this.setState("idle", 1);
  }

  get currentState(): EnemyAnimationState | undefined { return this.state; }
  get currentClipName(): string | undefined { return this.activeGroup?.name; }
  get currentPlaybackSpeed(): number { return this.playbackSpeed; }
  get effectiveGameplaySpeedCellsPerSecond(): number { return this.effectiveGameplaySpeed; }
  get assetPath(): string | undefined { return this.debugContext?.assetPath; }
  get enemyType(): EnemyType | undefined { return this.debugContext?.enemyType; }
  get currentFrame(): number | undefined { return this.activeGroup?.animatables[0]?.masterFrame; }
  get isPlaying(): boolean { return this.activeGroup?.isPlaying ?? false; }
  get isLooping(): boolean { return this.activeGroup?.loopAnimation ?? false; }
  get activeGroupCount(): number { return this.activeGroup?.isStarted ? 1 : 0; }
  get isFinished(): boolean {
    return this.state === "dying" && (this.deathFinished || !this.activeGroup?.isStarted);
  }

  /** Repeated calls with the same state only adjust rate; they never restart a clip. */
  setState(state: EnemyAnimationState, speedMultiplier = 1, effectiveGameplaySpeed = speedMultiplier): boolean {
    if (this.state === "dying" && state !== "dying") return false;
    const rate = Math.max(this.config.minPlaybackSpeed, Math.min(this.config.maxPlaybackSpeed, speedMultiplier));
    this.effectiveGameplaySpeed = effectiveGameplaySpeed;
    if (this.state === state) {
      this.playbackSpeed = rate;
      if (this.activeGroup) this.activeGroup.speedRatio = rate;
      return false;
    }

    this.activeGroup?.stop(true);
    this.activeGroup = this.clips.get(state)
      ?? (state === "moving" ? this.clips.get("idle") : undefined)
      ?? (state === "attacking" ? this.clips.get("idle") : undefined);
    this.state = state;
    this.playbackSpeed = rate;
    this.deathFinished = false;
    if (!this.activeGroup) {
      this.deathFinished = state === "dying";
      this.recordStateChange(state, undefined, rate);
      return true;
    }

    const group = this.activeGroup;
    group.reset();
    group.speedRatio = rate;
    group.start(state !== "dying", rate);
    if (this.paused) group.pause();
    if (state === "dying") group.onAnimationGroupEndObservable.addOnce(() => { this.deathFinished = true; });
    this.recordStateChange(state, group.name, rate);
    return true;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!this.activeGroup) return;
    if (paused) this.activeGroup.pause();
    else {
      this.activeGroup.speedRatio = this.playbackSpeed;
      this.activeGroup.play(this.state !== "dying");
    }
  }

  dispose(): void {
    for (const group of this.groups) { group.stop(true); group.dispose(); }
    this.clips.clear();
    this.activeGroup = undefined;
    this.state = undefined;
  }

  private removeRootMotionTracks(groups: readonly AnimationGroup[], rootNames: readonly string[]): void {
    const names = new Set(rootNames);
    for (const group of groups) {
      for (const track of [...group.targetedAnimations]) {
        if (!names.has(track.target?.name) || !["position", "position.x", "position.y", "position.z"].includes(track.animation.targetProperty)) continue;
        group.removeTargetedAnimation(track.animation);
      }
    }
  }

  private recordStateChange(state: EnemyAnimationState, clip: string | undefined, speed: number): void {
    if (!this.debugContext || new URLSearchParams(window.location.search).get("enemyAnimationDebug") !== "1") return;
    const debugWindow = window as Window & { __enemyAnimationTransitions?: object[] };
    const transitions = debugWindow.__enemyAnimationTransitions ??= [];
    transitions.push({
      ...this.debugContext,
      state,
      activeAnimationGroup: clip,
      playbackSpeed: speed,
      effectiveGameplaySpeedCellsPerSecond: this.effectiveGameplaySpeed,
    });
    if (transitions.length > 100) transitions.splice(0, transitions.length - 100);
  }
}
