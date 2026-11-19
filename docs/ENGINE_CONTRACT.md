# Contrato da engine — 0.2.3

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

Continuam especializados: adaptador de oferta/missão, `missionStatus`, `noActiveMission`, `missionTargetHp`, `spawnTarget`, papéis `faction/opponent`, reputação do único jogador e UI de missões. Múltiplas ofertas por representante, mudança de facção, persistência, coleta de histórico, schema completo e rollback transacional não são suportados. Objetos JSON inválidos podem exigir validação adicional antes de operações; não há infraestrutura universal de transações. Identidade entre sessões e retenção de entidades históricas deverão ser avaliadas somente quando houver necessidade concreta.

## Comandos, fatos e reações independentes — 0.2.3

Um **comando** solicita uma ação, sujeita a `when`/`conditions` e ao sorteio de `outcomes`. Um **fato** descreve uma ocorrência admitida, com `type`, `actorId` e `targetId` concretos. Uma **reação** é uma regra automática interessada em determinado tipo de fato, sem interação direta. **Condições** consultam referências/estado; **operações** transformam o estado. A reação usa `on`, `when` e `operations`; não usa `conditions`, que permanece validação de comandos.

O evento declara emissões no nível da execução, independentemente do outcome:

```json
{ "id": "attack", "emits": [{ "type": "attackAttempted" }] }
```

`executeEvent` valida, sorteia, aplica as operações e retorna `facts` no resultado admitido. Tipos repetidos em `emits` são deduplicados por execução. Acerto, esquiva e ataque letal produzem a tentativa; falha de validação não produz fatos nem sorteio. Não há comparação do ID do evento com `attack` no interpretador. Os IDs do fato vêm dos participantes passados à execução, não de `world.player`.

`executeCommand(world, event, actor, target, random?, context?)` verifica participantes registrados, chama o interpretador e despacha os fatos retornados. Qualquer personagem registrado pode ser ator. `interact` continua sendo o caminho da UI e passa o jogador. Chamadas diretas de baixo nível a `executeEvent` retornam os fatos, mas não os despacham; esse comportamento permite testes isolados e exige que novos chamadores usem `executeCommand` ou despachem explicitamente.

### Relações e descoberta das regras

Relações são instâncias `kind: "relation"` no mesmo registro canônico, com `id`, `definitionId`, `sourceId`, `targetId` e `intensity`. Não têm HP ou posição. `world.socialRelations` é uma visão derivada; a intensidade não é copiada para personagens. A reputação entre o jogador e facções continua em `world.relations`; ela não foi migrada nesta versão.

`relations.json` declara definições reutilizáveis, por exemplo:

```json
{ "friendship": { "id": "friendship", "name": "amizade", "reactions": ["respondToAggression"] } }
```

Em `scenarios.json`, `entities[].key` declara símbolos locais; `player` é reservado para o jogador. `socialRelations` contém `{ "definition": "friendship", "source": "A", "target": "victim", "intensity": 90 }`. Todos os personagens são criados antes da resolução dos símbolos. Símbolos ausentes/duplicados são erros; nenhum ID fixo de instância é escrito nos dados. `label` é apenas apresentação.

`createRelation` resolve os dois personagens, registra a instância e inscreve suas regras em `world.factSubscriptions[rule.on]`, com IDs da relação e da regra. Não cria relação inversa. Para `friendship`, origem é quem sente amizade; destino é quem recebe esse sentimento. Esse significado está na definição/regra, não em uma condicional específica no TypeScript.

`dispatchFacts` consulta somente o índice do tipo recebido e resolve cada relação inscrita. Não busca regras em missões ou exclusivamente na vítima, nem percorre todos os personagens por ataque. A fonte de inscrições atual são relações; futuras fontes podem acrescentar seus próprios contextos ao despacho. O índice atual permite refinamento futuro por participante sem alterar o produtor dos fatos. Mudanças em associações de regras ou em `on` após a inscrição exigirão reconstrução do índice; limiares e alcance são lidos diretamente dos dados das regras a cada avaliação.

### Referências, condições e operações da reação

`actor` e `target` resolvem os participantes do fato; `relation.source` e `relation.target` resolvem os personagens apontados pela relação. IDs inválidos ou tipos incorretos lançam erro. As extensões reutilizam `matches` e `applyOperations` da engine existente:

- `sameInstance`: igualdade de duas referências concretas.
- `alive`: HP positivo da referência indicada.
- `compare` com `relationIntensity`: lê a intensidade canônica.
- `compare` com `distance`: distância Manhattan entre duas referências; `gte`/`lte` preservam limites inclusivos.
- `setReference`: grava em `character.references[key]` o ID resolvido de outra referência, sem operação específica de amizade ou vingança.

Exemplo de transformação da regra compartilhada:

```json
{
  "on": "attackAttempted",
  "operations": [
    { "type": "setReference", "entity": "relation.source", "key": "hostileTo", "value": "actor" }
  ]
}
```

O `when` completo em `reactions.json` exige que `relation.target` seja a vítima do fato, que a origem esteja viva, intensidade ≥ 70 e distância origem/vítima ≤ 3. Os valores estão exclusivamente nos dados. A apresentação interpreta `references.hostileTo` como vermelho persistente; o flash de dano/esquiva continua sendo um temporizador visual independente.

### Limites do despacho e débitos técnicos

Cada ocorrência é representada pelo objeto `Fact` retornado pelo interpretador. Um `WeakSet` por partida impede reprocessar esse mesmo objeto; cada par relação/regra é executado no máximo uma vez por ocorrência, mesmo com inscrições duplicadas. Uma tentativa posterior cria outro objeto de fato e pode reagir novamente. Atribuir o mesmo `hostileTo` é idempotente; não há soma de hostilidade ou criação de novas relações.

O despacho é síncrono, em uma passagem finita pelas inscrições, na ordem de criação. Reações não declaram emissões, portanto não há cascatas, fila ou execução periódica enquanto uma condição permanece verdadeira. As condições consultam o estado após o comando e antes de cada reação; não há snapshot transacional. Falha de configuração durante uma operação não tem rollback nem repetição automática.

O controle de ocorrência por identidade de objeto é local à memória: clonar ou desserializar um fato representa uma nova ocorrência para este MVP. IDs persistentes de ocorrência, histórico, transporte, remoção/reindexação de inscrições e política de prioridade/conflitos deverão ser avaliados quando necessários. Só relações fornecem regras ao novo despacho; não há resolvedor universal de contextos. As regras sociais usam as capacidades comuns, enquanto operações de missão ainda exigem o contexto especializado correspondente.

**Integração pendente:** `react` continua concluindo missões pelo mecanismo da 0.2.2. Migrar esse fluxo para um futuro fato como `characterDied` deve substituir a consulta antiga, não consolidar dois sistemas permanentes. Também permanecem fora do escopo propagação de informação, percepção com obstáculos, IA, perseguição, contra-ataques e relações procedurais.
