# Origin Gates — consumidor da engine

Este workspace contém somente conteúdo, adaptação e apresentação do jogo. Sua dependência `@origin-gates/narrative-engine: 0.4.2` é resolvida pelo npm workspace e consumida pelo export público compilado.

Na raiz, `npm run dev` mantém a compilação da engine e o Vite ativos. `npm run build --workspace=@origin-gates/game` e `npm test --workspace=@origin-gates/game` também constroem a dependência primeiro.

## Jogar

WASD ou setas movem um tile por pressionamento. Espaço interage com um personagem adjacente. Se houver mais de um, a direção aponta o alvo desejado; sem escolha, vale a ordem de criação. R reinicia. Clique na área do jogo caso o foco esteja em outro controle.

- **01 — Campo de treinamento:** aproxime-se do Guardião. Há 50% de acerto e 50% de esquiva; acertos causam 10 HP. Vermelho/branco são feedback temporário. Mortos desaparecem e deixam de bloquear o tile.
- **02 — Lealdades rivais:** aceite uma missão de um representante, elimine o alvo e volte ao contratante para entregar. Há uma missão pendente por representante, missões simultâneas e repetição com novos alvos. Reputações começam em 50; entregar soma 20 ao contratante e subtrai 15 ao adversário, entre 0–100. Abaixo de 20, novas missões são recusadas. Bônus de dano usa a reputação posterior à entrega e acumula até 50.
- **03 — Reatividade social:** ataque a vítima. Acerto e esquiva admitidos produzem `attackAttempted`. A fica hostil ao agressor; B–E permanecem neutros conforme intensidade, ausência, distância ou direção do vínculo. Limiar 70 e alcance Manhattan 3, inclusivos, continuam nos dados. Não há perseguição ou contra-ataque.

## Editar o conteúdo

`src/data/scenarios.json` configura o jogador e as composições instanciadas. `src/data/compositions.json` declara os membros, referências locais, relações iniciais e ofertas. As posições das composições são locais e somadas à origem do cenário. O jogador é um binding externo nas reputações do cenário 02.

Os JSONs de objetos, eventos, missões, relações, facções e reações conservam as regras anteriores. O mapa fixo continua em `src/content/map.ts`. `src/content/originGates.ts` não monta tabelas simbólicas; essa resolução é responsabilidade da engine.

## Diagnósticos

Em desenvolvimento, **Abrir inspetor** mantém lista/árvore causal, filtros, seleção, JSON de instâncias, retenção, exportação e limpeza. Trocar cenário ou reiniciar troca o mundo e desmonta a assinatura anterior. Exportar solicita download do histórico completo retido e snapshots, sem filtros. Em produção, painel e coleta permanecem desativados por padrão.

O renderer usa `world.query`, `move`, `interact` e `react`; o painel usa `audit`, `inspect` e `diagnostics`. Não há acesso ao estado interno da engine. A sobreposição visual conhecida de legendas no JSON não foi reformulada nesta versão.
