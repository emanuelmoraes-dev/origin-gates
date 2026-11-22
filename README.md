# Origin Gates — 0.4.2

Monorepositório npm com dois workspaces. Requer Node.js 22.12+ e npm compatível com workspaces.

```text
packages/
  narrative-engine/    @origin-gates/narrative-engine
    src/               engine, espaço 2D, composições e consultas
    tests/             unidades internas e provas da API pública
    examples/          consumidores do pacote
    docs/ENGINE_CONTRACT.md
  origin-gates/        @origin-gates/game
    src/data/          JSONs do jogo e composições de produção
    src/content/       carregamento pela API pública
    src/render/        Phaser
    src/dev/           painel e consultas diagnósticas de apresentação
    tests/             regressão dos cenários reais, equivalência e diagnósticos
tests/                 proteção da fronteira entre pacotes
scripts/               desenvolvimento e prova de consumo do tarball
```

A dependência é `Origin Gates → @origin-gates/narrative-engine`. O pacote de engine exporta somente `.`, com JavaScript ESM e declarações TypeScript de `dist`. O jogo não importa seus internos, nem por tipos ou aliases. A engine não depende de Phaser, DOM ou conteúdo do jogo.

## Executar na raiz

```sh
npm install
npm run dev
```

O comando compila a engine, inicia seu `tsc --watch` e o Vite do jogo. Alterações na engine recompilam seus artefatos públicos; o Vite observa o pacote compilado sem alias para `src`. Use o endereço exibido pelo Vite, normalmente http://localhost:5173/; se a porta estiver ocupada, será escolhida outra. Ctrl+C encerra os dois processos.

WASD/setas movem e selecionam um personagem adjacente; Espaço interage; R reinicia. O seletor mantém os três cenários. [Controles e regras do jogo](packages/origin-gates/README.md).

## Verificações

```sh
npm test
npm run typecheck
npm run build
npm run test:consumer
```

O build respeita a ordem engine → jogo. `test:consumer` cria um tarball local com `npm pack`, instala-o offline em um diretório temporário fora do workspace, compila um consumidor TypeScript contra suas declarações e executa o JavaScript em Node. Não publica nada no npm e remove somente seu diretório temporário.

Comandos independentes por workspace:

```sh
npm run build --workspace=@origin-gates/narrative-engine
npm test --workspace=@origin-gates/narrative-engine
npm run build --workspace=@origin-gates/game
npm test --workspace=@origin-gates/game
```

Os comandos do jogo constroem primeiro a dependência pública. Para conferir os tipos isoladamente, execute `npm run build:engine` e então `npm run typecheck --workspace=<nome>`.

## Conteúdo, API e diagnósticos

- [Contrato técnico da engine](packages/narrative-engine/docs/ENGINE_CONTRACT.md#pacotes-consultas-e-consumo-público--042).
- [Exemplo completo de consumidor](scripts/consumer/index.ts), compilado e executado pela prova do tarball.
- [Exemplo de composições](packages/narrative-engine/examples/compositions.ts).
- [Cenários](packages/origin-gates/src/data/scenarios.json): jogador, missões habilitadas e instanciações das composições.
- [Composições de produção](packages/origin-gates/src/data/compositions.json): personagens, facções, relações e ofertas locais.
- [Adaptador](packages/origin-gates/src/content/originGates.ts): organiza os JSONs, registra definições, cria o mundo e chama `instantiateComposition`.
- [Renderer](packages/origin-gates/src/render/OriginScene.ts): usa consultas narrativas destacadas e IDs para os elementos visuais.
- [Painel](packages/origin-gates/src/dev/AuditPanel.ts): usa somente auditoria, inspeção e exportação públicas. Continua exclusivo de desenvolvimento; a coleta permanece desligada em produção.

Consultas narrativas não dependem da auditoria. O painel preserva filtros, árvore causal, retenção, exportação, limpeza e troca de mundo. A sobreposição visual conhecida de legendas na região JSON permanece fora do escopo.

## Cobertura e limites

A reorganização preserva os 302 testes anteriores. As unidades que antes usavam o adaptador interno agora usam as fixtures literais TypeScript já existentes, sem carregar JSONs de produção; elas continuam dentro do pacote da engine e mantêm suas asserções. Os testes de produção e de apresentação ficam no jogo e usam exclusivamente a API pública.

| Local | Testes atuais |
|---|---:|
| Engine: 282 anteriores + 10 de consultas | 292 |
| Jogo: 20 anteriores adaptados + 5 de produção | 25 |
| Fronteira arquitetural na raiz | 10 |
| Total | 327 |

A equivalência compara identidades correspondentes, vínculos e propriedades, sem exigir IDs ou históricos de auditoria idênticos após a introdução das composições. Não há novas mecânicas, migração do polling de missões, persistência ou rollback universal. A validação visual final dos cenários e do painel continua responsabilidade de uma execução no navegador; testes de lógica/build não a substituem.
