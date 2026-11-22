import Phaser from 'phaser';
import { createWorld } from '../content/originGates';
import type { CharacterView, NarrativeWorld, WorldMap } from '@origin-gates/narrative-engine';

const TILE = 48;
const MAP_X = 24;
const MAP_Y = 128;
const color = (value: string) => Phaser.Display.Color.HexStringToColor(value).color;
const entityColor = (entity: CharacterView) => entity.references.hostileTo ? 0xef5350 : color(entity.color);

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
  private world!: NarrativeWorld;
  private characters = new Map<string, CharacterView>();
  private scenarioId = 'training';
  private circles = new Map<string, Phaser.GameObjects.Arc>();
  private flashes = new Map<string, Phaser.Time.TimerEvent>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private hud!: Phaser.GameObjects.Graphics;
  private playerLabel!: Phaser.GameObjects.Text;
  private enemyLabel!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private socialLabel!: Phaser.GameObjects.Text;

  constructor() { super('origin'); }

  init(data: { scenario?: string }) { this.scenarioId = data.scenario ?? this.scenarioId; }

  create() {
    this.world = createWorld(this.scenarioId, { enabled: import.meta.env.DEV });
    if (import.meta.env.DEV) {
      let active = true;
      let dispose: (() => void) | undefined;
      const world = this.world;
      void import('../dev/AuditPanel').then(({ mountAuditPanel }) => { if (active) dispose = mountAuditPanel(world); }).catch(error => console.error('Audit panel failed to load', error));
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { active = false; dispose?.(); });
    }
    this.focused = undefined;
    this.circles.clear();
    this.labels.clear();
    drawMap(this.add.graphics(), this.world.map);
    this.hud = this.add.graphics();
    const style = { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#f0f2ef', lineSpacing: 21 };
    this.playerLabel = this.add.text(90, 27, '', style);
    this.enemyLabel = this.add.text(348, 27, '', style);
    this.message = this.add.text(24, 625, 'Aproxime-se do guardião para atacar.', { ...style, fontSize: '13px', wordWrap: { width: 480 } });
    this.message.setText(this.scenarioId === 'training' ? 'Aproxime-se do guardião para atacar.' : 'Azul: governo · Roxo: resistência. Espaço para interagir.');
    if (this.scenarioId === 'social') this.message.setText('Espaço: atacar a vítima. Observe A–E. R reinicia.');
    this.socialLabel = this.add.text(24, 685, '', { ...style, fontSize: '13px', lineSpacing: 7, wordWrap: { width: 480 } });
    if (this.scenarioId === 'social') this.socialLabel.setStyle({ fontSize: '11px', lineSpacing: 2 });
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
        const player = this.characters.get(this.world.player.id)!;
        this.focused = this.world.query.adjacent(player.id).find(entity => entity.position.x === player.position.x + direction[0] && entity.position.y === player.position.y + direction[1])?.id;
        this.world.move(player.id, ...direction);
        this.refresh();
      }
      if (event.code === 'Space') this.runEvent();
    };
    keyboard.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown', onKey);
      for (const timer of this.flashes.values()) timer.remove();
      this.flashes.clear();
    });
  }

  private runEvent() {
    const targets = this.world.query.adjacent(this.world.player.id);
    if (!targets.length) {
      this.world.interact({ actorId: this.world.player.id });
      this.message.setText('Aproxime-se de um personagem para interagir. R reinicia.');
      return;
    }
    // When several NPCs are adjacent, arrows/WASD choose the intended one.
    const target = targets.find(entity => entity.id === this.focused) ?? targets[0];
    const result = this.world.interact({ actorId: this.world.player.id, targetId: target.id });
    if (!result.executed) {
      this.message.setText(result.message ?? 'Não é possível atacar este personagem.');
      return;
    }
    const circle = this.circles.get(target.id)!;
    if (result.feedback.durationMs > 0) {
      this.flashes.get(target.id)?.remove();
      circle.setFillStyle(color(result.feedback.color));
      this.flashes.set(target.id, this.time.delayedCall(result.feedback.durationMs, () => {
        circle.setFillStyle(entityColor(this.characters.get(target.id)!));
        this.flashes.delete(target.id);
      }));
    }
    this.message.setText(result.killed ? 'Guardião derrotado! R para uma nova partida.' : result.feedback.message + (result.damage ? ` −${result.damage} HP` : ''));
    if (result.killed && this.scenarioId === 'social') this.message.setText('Vítima derrotada. As hostilidades permanecem. R reinicia.');
    for (const reaction of this.world.react({ cause: result })) if (reaction.executed) this.message.setText(reaction.feedback.message);
    this.refresh();
  }

  private focused?: string;

  private refresh() {
    const entities = this.world.query.characters();
    this.characters = new Map(entities.map(entity => [entity.id, entity]));
    const player = this.characters.get(this.world.player.id)!;
    const npcs = entities.filter(entity => entity.id !== player.id);
    for (const [entity, circle] of this.circles) {
      if (!this.characters.has(entity)) { circle.destroy(); this.circles.delete(entity); }
    }
    for (const entity of entities) {
      let circle = this.circles.get(entity.id);
      if (!circle) {
        circle = this.add.circle(0, 0, 15, color(entity.color)).setStrokeStyle(3, 0x182329, 0.5);
        this.circles.set(entity.id, circle);
      }
      circle.setPosition(MAP_X + entity.position.x * TILE + TILE / 2, MAP_Y + entity.position.y * TILE + TILE / 2);
      circle.setVisible(entity.hp > 0);
      if (!this.flashes.has(entity.id)) circle.setFillStyle(entityColor(entity));
      if (this.scenarioId === 'social') {
        let label = this.labels.get(entity.id);
        if (!label) {
          label = this.add.text(0, 0, entity.label ?? entity.name, { fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: '#ffffff', backgroundColor: '#182329' }).setOrigin(0.5, 1);
          this.labels.set(entity.id, label);
        }
        label.setPosition(circle.x, circle.y - 17).setVisible(entity.hp > 0);
      }
    }
    this.hud.clear().fillStyle(0x454c50).fillRoundedRect(12, 12, 504, 100, 6);
    this.hud.lineStyle(1, 0x697176).lineBetween(264, 24, 264, 100);
    const panel = (entity: CharacterView, x: number, label: Phaser.GameObjects.Text, visible: boolean) => {
      label.setVisible(visible);
      if (!visible) return;
      this.hud.fillStyle(0x293439).fillRoundedRect(x, 30, 48, 48, 4);
      this.hud.fillStyle(color(entity.color)).fillCircle(x + 24, 54, 14);
      this.hud.fillStyle(0x232d30).fillRect(x + 62, 54, 154, 8);
      this.hud.fillStyle(0x77cf75).fillRect(x + 62, 54, 154 * entity.hp / entity.maxHp, 8);
      label.setText(`${entity.label ?? entity.name}\n${entity.hp} / ${entity.maxHp} HP`);
    };
    panel(player, 28, this.playerLabel, true);
    const nearby = this.world.query.adjacent(this.world.player.id);
    const target = nearby.find(entity => entity.id === this.focused) ?? nearby[0];
    this.enemyLabel.setVisible(false);
    if (target) panel(target, 286, this.enemyLabel, true);
    this.socialLabel.setVisible(this.scenarioId !== 'training');
    const missions = this.world.query.missions({ executorId: player.id, pending: true });
    const factions = this.world.query.factions();
    const relations = this.world.query.relations();
    this.socialLabel.setText([
      `Dano: ${player.attributes.damage} | ${factions.map(f => `${f.name}: ${relations.find(r => r.definitionId === 'reputation' && r.sourceId === f.id && r.targetId === player.id)!.intensity}`).join(' | ')}`,
      ...missions.map(mission => {
        const target = this.characters.get(mission.targetId)!;
        return `${mission.name} — ${mission.status === 'ready' ? 'pronta (ready)' : `ativa (${target.position.x + 1}, ${target.position.y + 1})`}`;
      }),
      ...(missions.length ? [] : ['Missão: nenhuma ativa']),
    ]);
    if (this.scenarioId === 'social') {
      const name = (id: string) => {
        const entity = this.characters.get(id)!;
        return entity.label ?? entity.name;
      };
      this.socialLabel.setText(npcs.map(entity => {
        const connected = relations.filter(r => r.sourceId === entity.id || r.targetId === entity.id);
        const description = connected.map(r => `${name(r.sourceId)} → ${name(r.targetId)}: ${r.name} ${r.intensity}`).join('; ');
        const status = entity.references.hostileTo ? `hostil a ${name(entity.references.hostileTo)}` : 'neutro';
        return entity.id === npcs[0].id ? `Vítima: ${entity.hp} HP · Relações direcionais e reações abaixo` : `${entity.label}: ${description || 'sem relação'} · ${status}`;
      }));
    }
  }
}
