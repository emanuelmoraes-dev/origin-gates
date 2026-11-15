import Phaser from 'phaser';
import playerDefinition from '../data/objects/player.json';
import enemyDefinition from '../data/objects/enemy.json';
import attackData from '../data/events/attack.json';
import { executeEvent, type EventDefinition } from '../game/events';
import { createEntity, isAdjacent, movePlayer, worldMap, type EntityState, type WorldMap } from '../game/state';

const TILE = 48;
const MAP_X = 24;
const MAP_Y = 128;
const color = (value: string) => Phaser.Display.Color.HexStringToColor(value).color;
const attack = attackData as EventDefinition;

// Rendering consumes a map; it does not know how the map was produced.
function drawMap(graphics: Phaser.GameObjects.Graphics, map: WorldMap) {
  map.forEach((row, y) => row.forEach((tile, x) => {
    graphics.fillStyle(tile === 'land' ? 0x54865b : 0x326c91);
    graphics.fillRect(MAP_X + x * TILE, MAP_Y + y * TILE, TILE - 1, TILE - 1);
    if (tile === 'water') {
      graphics.lineStyle(2, 0x86b9ce, 0.3);
      graphics.lineBetween(MAP_X + x * TILE + 13, MAP_Y + y * TILE + 24, MAP_X + x * TILE + 34, MAP_Y + y * TILE + 24);
    }
  }));
}

export class OriginScene extends Phaser.Scene {
  private player!: EntityState;
  private enemy!: EntityState;
  private playerCircle!: Phaser.GameObjects.Arc;
  private enemyCircle!: Phaser.GameObjects.Arc;
  private hud!: Phaser.GameObjects.Graphics;
  private playerLabel!: Phaser.GameObjects.Text;
  private enemyLabel!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private flash?: Phaser.Time.TimerEvent;

  constructor() { super('origin'); }

  create() {
    this.player = createEntity(playerDefinition, { x: 2, y: 5 });
    this.enemy = createEntity(enemyDefinition, { x: 5, y: 5 });
    drawMap(this.add.graphics(), worldMap);
    const circle = (entity: EntityState) => this.add.circle(0, 0, 15, color(entity.definition.color)).setStrokeStyle(3, 0x182329, 0.5);
    this.playerCircle = circle(this.player);
    this.enemyCircle = circle(this.enemy);
    this.hud = this.add.graphics();
    const style = { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#f0f2ef', lineSpacing: 21 };
    this.playerLabel = this.add.text(90, 27, '', style);
    this.enemyLabel = this.add.text(348, 27, '', style);
    this.message = this.add.text(24, 625, 'Aproxime-se do guardião para atacar.', { ...style, fontSize: '13px', wordWrap: { width: 480 } });
    this.refresh();

    const keyboard = this.input.keyboard!;
    keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const directions: Record<string, [number, number]> = {
        ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
        ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
      };
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === 'r') { this.scene.restart(); return; }
      const direction = directions[key];
      if (direction) {
        movePlayer(this.player, ...direction, worldMap, [this.enemy]);
        this.refresh();
      }
      if (event.code === 'Space') this.runEvent();
    };
    keyboard.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown', onKey);
      this.flash?.remove();
      this.flash = undefined;
    });
  }

  private runEvent() {
    const result = executeEvent(attack, this.player, this.enemy);
    if (!result.executed) {
      this.message.setText(this.enemy.hp <= 0 ? 'O guardião já foi derrotado. R para reiniciar.' : 'Chegue a um tile ao lado do guardião.');
      return;
    }
    this.flash?.remove();
    this.enemyCircle.setFillStyle(color(result.feedback.color));
    this.message.setText(result.killed ? 'Guardião derrotado! R para uma nova partida.' : result.feedback.message);
    this.flash = this.time.delayedCall(result.feedback.durationMs, () => {
      this.enemyCircle.setFillStyle(color(this.enemy.definition.color));
    });
    this.refresh();
  }

  private refresh() {
    for (const [entity, circle] of [[this.player, this.playerCircle], [this.enemy, this.enemyCircle]] as const) {
      circle.setPosition(MAP_X + entity.position.x * TILE + TILE / 2, MAP_Y + entity.position.y * TILE + TILE / 2);
      circle.setVisible(entity.hp > 0);
    }
    this.hud.clear().fillStyle(0x454c50).fillRoundedRect(12, 12, 504, 100, 6);
    this.hud.lineStyle(1, 0x697176).lineBetween(264, 24, 264, 100);
    const panel = (entity: EntityState, x: number, label: Phaser.GameObjects.Text, visible: boolean) => {
      label.setVisible(visible);
      if (!visible) return;
      this.hud.fillStyle(0x293439).fillRoundedRect(x, 30, 48, 48, 4);
      this.hud.fillStyle(color(entity.definition.color)).fillCircle(x + 24, 54, 14);
      this.hud.fillStyle(0x232d30).fillRect(x + 62, 54, 154, 8);
      this.hud.fillStyle(0x77cf75).fillRect(x + 62, 54, 154 * entity.hp / entity.definition.maxHp, 8);
      label.setText(`${entity.definition.name}\n${entity.hp} / ${entity.definition.maxHp} HP`);
    };
    panel(this.player, 28, this.playerLabel, true);
    panel(this.enemy, 286, this.enemyLabel, this.enemy.hp > 0 && isAdjacent(this.player, this.enemy));
  }
}
