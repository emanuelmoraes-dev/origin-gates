import Phaser from 'phaser';
import { OriginScene } from './render/OriginScene';
import './style.css';
import { scenarios } from './game/world';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 528,
  height: 790,
  backgroundColor: '#182329',
  scene: OriginScene,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  render: { antialias: true },
});

const selector = document.querySelector<HTMLSelectElement>('#scenario')!;
for (const scenario of scenarios) selector.add(new Option(scenario.name, scenario.id));
selector.addEventListener('change', () => {
  game.scene.start('origin', { scenario: selector.value });
  selector.blur();
});
