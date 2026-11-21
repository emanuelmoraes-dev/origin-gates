# Origin Gates — MVP 0.3.1: Exploração e exportação de diagnósticos

Protótipo em TypeScript, Vite e Phaser 3. Requer Node.js 22.12+.

```sh
npm install
npm run dev
```

Abra o endereço indicado pelo Vite. Use WASD ou setas para mover um tile por pressionamento; Espaço para atacar; R para reiniciar. Clique na área do jogo caso o teclado esteja focado em outra janela. Adjacência significa um tile na horizontal ou vertical, sem diagonais. O jogador começa três tiles à esquerda do NPC.

No seletor acima do mapa, escolha **01 — Campo de treinamento** (combate original) ou **02 — Lealdades rivais**. Trocar de cenário ou pressionar R cria uma partida nova, sem persistência. No cenário 02, o jogador começa em (3, 6), o oficial azul em (4, 3) e o representante roxo em (6, 3); coordenadas em coluna/linha, começando em 1.

Chegue ao lado de um representante e pressione Espaço para aceitar sua missão. O alvo só aparece após a aceitação, e o painel informa suas coordenadas. Elimine-o, volte ao mesmo representante e pressione Espaço para entregar. Pressione novamente para repetir com novas instâncias da missão e do alvo. Há somente uma missão pendente por representante, incluindo as prontas para entrega; governo e resistência podem ter missões simultâneas. Se houver dois personagens adjacentes, pressione uma direção em direção ao personagem desejado para selecioná-lo antes de usar Espaço.

As relações começam em 50/50. Cada entrega soma 20 à facção contratante e subtrai 15 da adversária, limitadas a 0–100. Uma relação abaixo de 20 bloqueia novas missões dessa facção até reiniciar. O bônus de dano considera a relação **após** essa alteração: 0–29 dá +1, 30–59 dá +3, 60–79 dá +5, 80–100 dá +10. O dano começa em 10 e acumula até 50. Os representantes não podem ser atacados.

No **03 — Reatividade social**, o jogador começa ao lado da vítima. Pressione Espaço: tanto acerto quanto esquiva geram uma tentativa admitida. A fica vermelho e hostil ao agressor; B (amizade fraca), C (sem relação), D (distante) e E (relação na direção inversa) permanecem neutros. O mapa rotula os personagens, e o painel mostra relações direcionais, intensidades e hostilidade. O limiar é 70 e o alcance Manhattan é 3, ambos inclusivos e configuráveis em `src/data/reactions.json`. Não há perseguição ou contra-ataque. R ou a troca de cenário cria uma partida isolada.

```sh
npm test
npm run typecheck
npm run build
```

Em desenvolvimento, use **Abrir inspetor**, no canto superior direito. Alterne **Cronológico** / **Árvore causal**, expanda/recolha os registros e selecione seus detalhes. A busca por ID de instância inclui a cadeia relacionada por padrão; o modo de participação direta e o filtro exato de `traceId` permitem restringir a investigação. Na árvore, ancestrais são preservados como contexto. **Ver cadeia selecionada** mostra a cadeia inteira de uma ocorrência.

**Exportar diagnóstico JSON** baixa todos os registros retidos (sem filtros), estatísticas/descartes e fotografias das instâncias, no schema 1. O nome identifica cenário, mundo e instante. Limpar o histórico não altera a partida. O histórico retém até 1000 registros por padrão, informa descartes e identifica pais ausentes. Ao trocar de cenário, o painel se conecta ao mundo novo. Em produção, a cena não carrega o painel e desativa a coleta; consumidores TypeScript ainda podem ativá-la explicitamente.

O núcleo oferece `world.audit.records()`, `subscribe()`, `clear()` e `stats()`, além de `createInspector(world).list(kind?)` / `find(id)`. O [contrato técnico](docs/ENGINE_CONTRACT.md#auditoria-e-inspeção--030) documenta os contextos causais, erros parciais e a matriz de cobertura. Escritas diretas externas permanecem sem auditoria; os snapshots do inspetor não permitem alterar o mundo.

## Onde editar

- `src/data/objects/player.json` e `enemy.json`: nomes, vida máxima e cores das definições originais.
- `src/data/events/attack.json`: condições, pesos dos resultados, operações de dano e feedback visual. Pesos iguais dão 50% para cada resultado. Cores usam hexadecimal e duração usa milissegundos.
- `src/data/objects/reactivity.json`: vítima e definição compartilhada pelos cinco observadores.
- `src/data/relations.json`: tipos de relação, categorias das pontas, unicidade, limites de intensidade e regras reativas associadas.
- `src/data/reactions.json`: tipo de fato observado, condições de intensidade/distância e transformação por referências.
- `src/game/reactions.ts`: despacho síncrono dos fatos usando inscrições por tipo, condições e operações da engine existente.
- `src/game/audit.ts` e `inspection.ts`: serviço de diagnóstico, correlação causal e fotografias somente leitura.
- `src/dev/AuditPanel.ts`: consumidor HTML/TypeScript habilitado apenas em desenvolvimento.
- `src/dev/audit-view.ts` e `diagnostics.ts`: consultas contextuais, árvore causal e exportação destacada, sem DOM/Phaser.
- `src/data/objects/social.json`: definições dos representantes e alvos, com as ofertas e posições fixas dos alvos.
- `src/data/missions.json`: definição reutilizável `eliminateTarget`, estado inicial e reações comuns.
- `src/data/factions.json`: definições das facções sem representação no mapa.
- `src/data/scenarios.json`: nomes do seletor, posições iniciais, facções/relações iniciais e definições de missão habilitadas. O mapa continua exclusivamente em TypeScript.
- `src/data/events/social.json`: aceitação, entrega, reação à morte, limiar mínimo de reputação, deltas, faixas de recompensa e teto de dano. Os limites de reputação 0–100 pertencem a `relations.json`.
- `src/game/world.ts`: cria partidas isoladas, encontra interações declaradas e avalia reações sobre o estado atual. Compartilha o interpretador de eventos com o combate.
- `src/game/interactions.ts`: seleciona o primeiro evento aplicável na lista `interactions` do objeto ou da instância. Associações, prioridade, contexto e limites estão documentados em [docs/ENGINE_CONTRACT.md](docs/ENGINE_CONTRACT.md).
- `src/game/state.ts`: mapa fixo de 10 × 10 em TypeScript (`L` terra; `W` água), criação do estado e regras de movimento.
- `src/game/events.ts`: interpretador sem imports de Phaser. Avalia condições, sorteia um resultado por peso, executa operações reutilizáveis e devolve resultado estruturado. A fonte aleatória é injetável para testes. Eventos com as mesmas operações podem ser adicionados em JSON, sem uma função específica por evento.
- `src/render/OriginScene.ts`: posições iniciais, desenho do mapa, entrada de teclado, painéis e flashes de 500 ms. A função de desenho recebe `WorldMap`; um gerador futuro pode fornecer essa mesma estrutura sem alterar o desenho.

O estado de cada entidade contém a vida atual e a posição, separados da definição carregada do JSON. A interface lê esse estado diretamente. Nenhum JSON é alterado durante a partida. NPC morto desaparece, deixa de bloquear movimento e não pode receber ataques. Ataques rápidos substituem o temporizador visual anterior, mantendo o último feedback por 500 ms.

Os testes executam a lógica diretamente, sem carregar Phaser ou navegador, cobrindo acerto, esquiva, limiar de probabilidade, dano, morte, condições de ataque, preservação dos JSONs e colisões.

## Regras declarativas

A engine preserva as condições originais (`actorAlive`, `targetAlive`, `adjacent`) e acrescenta `targetAttackable`, `compare` (comparações `gte`/`lte` parametrizadas), `missionStatus` e `noActiveMission`. As referências numéricas consultam um atributo do jogador, a relação com `faction`/`opponent` da missão ou a vida da instância do alvo.

As operações são `damage`, `relation` (adaptador de delta para a reputação da facção sobre o ator), `attributeReward` (consulta e faixas numéricas), `missionStatus` e `spawnTarget`. Reputação e amizade compartilham instâncias em `world.instances`, consultadas pela visão `world.relationInstances`; os limites pertencem ao tipo da relação. No cenário, `relations` usa símbolos locais, por exemplo governo → jogador para reputação e A → vítima para amizade. O array de operações é executado em ordem: relações são alteradas antes de consultar a faixa de recompensa. O combate consulta `attributes.damage` em todos os cenários; no treinamento ele permanece em 10.

`when` seleciona qual evento se aplica ao estado atual; `conditions` valida sua execução e pode retornar uma mensagem de recusa. A reação de alvo derrotado consulta a instância da missão e o ID de seu alvo, sem consultar o identificador de um ataque anterior. `available` indica uma oferta sem missão pendente. As instâncias percorrem `active → ready → completed`; uma nova aceitação cria outra instância. A entrega exige `ready`, impedindo recompensa duplicada.

Os testes originais foram mantidos. Os testes de missões cobrem as duas facções, limites, faixas, repetição, exclusividade, reset e alterações dos próprios dados de evento sem mudar as regras TypeScript.

Os testes de reatividade cobrem fatos admitidos/recusados, direcionalidade, identidades concretas, limites inclusivos, alterações de parâmetros em dados, agressor diferente do jogador, deduplicação e isolamento das partidas. O contrato técnico também registra a futura migração das reações de missão para fatos.
