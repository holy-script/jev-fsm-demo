import * as Phaser from "phaser";
import { ArenaScene, type Hooks } from "./ArenaScene";

export function createGame(parent: HTMLElement, hooks: Hooks) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 600,
    backgroundColor: "#161b22",
    scene: [],
  });
  game.scene.add("arena", ArenaScene, true, hooks);
  return () => game.destroy(true);
}
