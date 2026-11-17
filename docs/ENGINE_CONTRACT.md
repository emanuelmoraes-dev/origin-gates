# Contrato da engine — 0.2.2

## Definições, identidade e estado

Definições JSON possuem `id` reutilizável; instâncias possuem `id` único, `definitionId` e `kind`. O contador `nextId` da partida produz `entity_000001`, `entity_000002`, etc., para todos os tipos. Nenhum comportamento é inferido do texto do ID. Reiniciar ou trocar cenário cria outro registro e reinicia o contador; IDs não identificam entidades entre partidas.

`world.instances` é o registro canônico, indexado por ID de instância. `resolve(store, id, kind)` retorna a entidade concreta e verifica existência e tipo; um ID de definição não substitui uma referência de instância. IDs são readonly no contrato TypeScript e não são reassociados durante a execução.

Os tipos compartilham somente identidade. Personagens têm HP, posição, atributos e referências opcionais `factionId` e `offer`. Facções têm nome, sem HP/posição. Missões têm estado e participantes, sem HP/posição. `world.missions` e `world.factions` são visões derivadas do registro, sem cópias de estado; `player` e `entities` referenciam os mesmos personagens registrados. Personagens mortos permanecem registrados, invisíveis e sem colisão, preservando referências históricas.

`createEntity(definition, position, store, interactions?)` cria e registra um personagem, copiando posição e atributos. Todas as criações da mesma partida usam o mesmo store. A definição e suas listas não são modificadas. Não há ECS ou propriedades artificiais de personagem nas facções e missões.

## Configuração inicial e referências

`factions.json` define as facções reutilizáveis. `scenarios.json.factions` informa `definition` e `relation` inicial. `createWorld` instancia cada facção e traduz referências de configuração (`entities[].faction` e `offer.opponent`) para IDs concretos. Neste MVP, uma definição de facção aparece uma única vez por cenário; duplicações são rejeitadas. Personagens e missões não têm essa restrição.

Cada representante recebe `factionId`. As relações do único jogador ficam exclusivamente em `world.relations[factionInstanceId]`; não são copiadas para personagens ou missões. A facção contratante é resolvida por `mission.contractorId → character.factionId → faction`. A adversária é `mission.opponentId`. Não há troca de facção durante uma missão.

IDs de definição ainda são usados para escolher o modelo de uma nova entidade. Depois da criação, referências entre entidades usam IDs de instância. Referências inexistentes, tipo incorreto, contexto de outro executor/contratante e alvos não registrados geram erro, sem fallback para outra entidade. Não há busca de alvo por definição.

## Ofertas e instâncias de missão

Existe uma única definição em `missions.json`:

```json
{
  "id": "eliminateTarget",
  "name": "Eliminar alvo",
  "initialStatus": "active",
  "reactions": ["targetDefeated"]
}
```

A definição declara o estado inicial e as reações comuns; `scenarios[].missions` habilita definições, sem criar missões antecipadamente. A oferta no objeto representante fornece as particularidades:

```json
{
  "offer": {
    "mission": "eliminateTarget",
    "name": "Eliminar alvo rebelde",
    "target": "resistanceTarget",
    "opponent": "resistance",
    "spawn": { "x": 8, "y": 3 }
  },
  "interactions": [
    { "event": "accept", "context": { "offer": "target" } },
    { "event": "deliver", "context": { "offer": "target" } }
  ]
}
```

`offer.target` é definição de NPC; `offer.mission` é definição de missão. Na instância do representante, a oferta copia a configuração e troca `opponent` por `opponentId` concreto. A aceitação válida usa a operação existente `spawnTarget`, agora responsável por criar o par alvo/missão: gera o NPC, gera a missão com ID próprio, registra `executorId`, `contractorId`, `targetId`, `opponentId`, nome e estado inicial, e adiciona o NPC ao mapa. Atualiza apenas o contexto dessa execução com o novo `missionId`, permitindo que a operação seguinte `missionStatus` continue funcionando. Nenhum tipo de operação novo foi introduzido.

`available` representa uma oferta sem missão pendente, não uma instância pré-criada. Instâncias percorrem `active → ready → completed`. `noActiveMission` verifica pendência do par executor/contratante, incluindo `ready`. Assim, cada representante pode ter uma missão pendente, simultaneamente com o outro. A entrega exige `ready`. Uma nova aceitação cria outra missão e outro alvo; não reinicia a missão concluída, que continua registrada.

## Seleção, participantes e execução

A UI mantém a seleção de entidade viva adjacente: preferência para a apontada pelo teclado e, na ausência, primeira na ordem de `world.entities`. Espaço chama `interact(world, target)`. O ator é `world.player` e o alvo é exatamente a instância registrada recebida.

`selectInteraction` percorre `target.interactions ?? target.definition.interactions ?? []` na ordem declarada. Uma substituição de instância, inclusive `[]`, substitui a lista da definição. Cada `event` referencia uma chave do registro estático. O primeiro evento cujo `when` seja satisfeito vence; a ordem do registro e os pesos dos outcomes não afetam a prioridade. Selecionar não modifica estado nem sorteia resultados.

`context.offer: "target"` pede ao adaptador que use a oferta do alvo e encontre a missão pendente pelos IDs do jogador e do contratante. O contexto contém `world`, `contractorId`, `offer` e `missionId?`. Não contém uma missão inferida pelo ID de definição do representante. Sem declaração de contexto, combate continua funcionando apenas com ator/alvo.

- `when`: todas as regras devem ser verdadeiras; ausente/vazio significa aplicável. Falso tenta a próxima associação, sem recusa.
- `conditions`: após selecionar, valida todas em ordem. Falha retorna motivo/mensagem e não executa operações, sorteio ou outro evento.
- `outcomes`: resultados sorteados proporcionalmente a `weight`, após a validação.
- `operations`: transformações executadas sequencialmente. Relações mudam antes da consulta da faixa de recompensa.
- `feedback`: mensagem, cor e duração para a apresentação.

`executeEvent` revalida `when` para chamadas diretas e verifica referências do contexto. Uma recusa nunca vira ataque. Sem evento aplicável, retorna `executed: false`, `reason: "noApplicableEvent"`; referências inválidas são erros explícitos de configuração.

`react` percorre instâncias de missão, consulta as reações da definição e resolve executor/contratante/alvo pelos IDs. `missionTargetHp` consulta somente `mission.targetId`. Uma morte muda apenas a missão que referencia aquele NPC, mesmo quando dois alvos usam a mesma definição. Não há fila, cascata ou dependência do ID do último ataque.

## Decisões e limites

Escolheu-se um registro em memória com união discriminada em vez de ECS, banco de dados ou resolvedor universal de referências. Visões derivadas evitam duplicar estado. Ofertas substituem as antigas definições governmentMission/resistanceMission e o contexto por ID de definição; não se mantiveram aliases ambíguos para o formato antigo.

A operação `spawnTarget` preserva o nome e a função de criar o alvo, mas também instancia a missão antes inexistente. Separar essa criação em um sistema genérico de fábricas e encadeamento de referências foi descartado por ampliar o escopo. Combate, relações, faixas e limites de recompensa permanecem nos eventos existentes.

Continuam especializados: adaptador de oferta/missão, `missionStatus`, `noActiveMission`, `missionTargetHp`, `spawnTarget`, papéis `faction/opponent`, relações do único jogador e UI de missões. Atores arbitrários, múltiplas ofertas por representante, mudança de facção, persistência, coleta de histórico, schema completo e rollback transacional não são suportados. Objetos JSON inválidos podem exigir validação adicional antes de operações; não há infraestrutura universal de transações. Identidade entre sessões e retenção de entidades históricas deverão ser avaliadas somente quando houver necessidade concreta.
