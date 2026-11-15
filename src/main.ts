import Phaser from 'phaser';
import { OriginScene } from './render/OriginScene';
import './style.css';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 528,
  height: 680,
  backgroundColor: '#182329',
  scene: OriginScene,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  render: { antialias: true },
});
