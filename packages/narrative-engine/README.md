# @origin-gates/narrative-engine — 0.4.2

Engine narrativa TypeScript/ESM com espaço 2D, definições declarativas, composições, comandos, fatos, reações, consultas e diagnósticos. Sem dependências de runtime. Requer Node.js 22.12+ no ambiente verificado.

O único ponto de entrada suportado é `@origin-gates/narrative-engine`. `package.json` publica JavaScript em `dist/index.js` e tipos em `dist/index.d.ts`; deep imports não são suportados. A engine pode ser empacotada localmente, mas não foi publicada no npm.

```ts
import { createEngine } from '@origin-gates/narrative-engine';

const engine = createEngine();
engine.registerDefinitions({ characters: [
  { id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff' },
] });
const world = engine.createWorld({
  map: [['land', 'land']],
  player: { definitionId: 'citizen', position: { x: 0, y: 0 } },
});
world.createCharacter({ definitionId: 'citizen', position: { x: 1, y: 0 } });
const neighbors = world.query.adjacent(world.player.id);
```

Na raiz do repositório:

```sh
npm run build --workspace=@origin-gates/narrative-engine
npm test --workspace=@origin-gates/narrative-engine
npm run test:consumer
```

O build usa somente TypeScript e gera ESM/declarations. As unidades internas podem importar serviços privados dentro deste pacote; provas e exemplos consomem o nome público. Não há configuração Vite ou import de conteúdo/renderer do jogo. Vitest continua sendo a ferramenta de testes existente.

Veja [o contrato técnico](docs/ENGINE_CONTRACT.md#pacotes-consultas-e-consumo-público--042) e os [exemplos](examples/compositions.ts). Distribuição ESM única, sem CJS, persistência ou promessa de compatibilidade universal entre runtimes.
