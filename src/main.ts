import Phaser from "phaser";
import "./style.css";
import { GameScene } from "./game/scenes/GameScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 360,
  height: 640,
  backgroundColor: "#10151d",
  scene: [GameScene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
