# Contrato da engine — 0.3.0: observabilidade narrativa

## Definições, identidade e estado

Definições JSON possuem `id` reutilizável; instâncias possuem `id` único, `definitionId` e `kind`. O contador `nextId` da partida produz `entity_000001`, `entity_000002`, etc., para todos os tipos. Nenhum comportamento é inferido do texto do ID. Reiniciar ou trocar cenário cria outro registro e reinicia o contador; IDs não identificam entidades entre partidas.

`world.instances` é o registro canônico, indexado por ID de instância. `resolve(store, id, kind)` retorna a entidade concreta e verifica existência e tipo; um ID de definição não substitui uma referência de instância. IDs são readonly no contrato TypeScript e não são reassociados durante a execução.

Os tipos compartilham somente identidade. Personagens têm HP, posição, atributos e referências opcionais `factionId` e `offer`. Facções têm nome, sem HP/posição. Missões têm estado e participantes, sem HP/posição. `world.missions` e `world.factions` são visões derivadas do registro, sem cópias de estado; `player` e `entities` referenciam os mesmos personagens registrados. Personagens mortos permanecem registrados, invisíveis e sem colisão, preservando referências históricas.

`createEntity(definition, position, store, interactions?)` cria e registra um personagem, copiando posição e atributos. Todas as criações da mesma partida usam o mesmo store. A definição e suas listas não são modificadas. Não há ECS ou propriedades artificiais de personagem nas facções e missões.

## Configuração inicial e referências

`factions.json` define as facções reutilizáveis. `scenarios.json.factions` informa as definições a instanciar; os valores iniciais estão em `scenarios.json.relations`. `createWorld` instancia cada facção e traduz referências de configuração (`entities[].faction` e `offer.opponent`) para IDs concretos. Neste MVP, uma definição de facção aparece uma única vez por cenário; duplicações são rejeitadas. Personagens e missões não têm essa restrição.

Cada representante recebe `factionId`. As reputações são relações concretas facção → jogador em `world.instances`, sem tabela numérica paralela. A facção contratante é resolvida por `mission.contractorId → character.factionId → faction`. A adversária é `mission.opponentId`. Não há troca de facção durante uma missão.

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

Relações são instâncias `kind: "relation"` no mesmo registro canônico, com `id`, `definitionId`, `sourceId`, `targetId` e `intensity`. Não têm HP ou posição. `world.relationInstances` é uma visão derivada do registro contendo amizades e reputações; a intensidade não é copiada para personagens, facções ou missões. A antiga tabela numérica de reputações foi removida.

`relations.json` declara definições reutilizáveis, por exemplo:

```json
{
  "friendship": {
    "id": "friendship", "name": "amizade",
    "sourceKinds": ["character"], "targetKinds": ["character"],
    "unique": true, "reactions": ["respondToAggression"]
  },
  "reputation": {
    "id": "reputation", "name": "reputação",
    "sourceKinds": ["faction"], "targetKinds": ["character"],
    "unique": true, "intensity": { "min": 0, "max": 100 }, "reactions": []
  }
}
```

Em `scenarios.json`, `entities[].key` declara símbolos locais; `player` é reservado para o jogador. As facções também disponibilizam seus IDs de definição como símbolos locais, resolvidos para as instâncias criadas. `relations` contém tanto `{ "definition": "friendship", "source": "A", "target": "victim", "intensity": 90 }` quanto `{ "definition": "reputation", "source": "government", "target": "player", "intensity": 50 }`. Todas as facções e personagens são criados antes das relações. Símbolos ausentes/duplicados são erros; nenhum ID fixo de instância é escrito nos dados. `label` é apenas apresentação.

`createRelation` valida categorias das pontas, intensidade, unicidade e existência das regras antes de consumir um ID, registrar a instância ou criar inscrições em `world.factSubscriptions[rule.on]`. Relações sem regras reativas não criam inscrições. Não cria relação inversa. A origem é quem possui a avaliação, sentimento ou vínculo; o destino é a entidade avaliada ou referenciada. Assim, A → B representa a amizade que A sente por B, e governo → jogador representa a avaliação que o governo possui do jogador. A opinião inversa seria outro vínculo independente.

### Contrato comum de consulta e alteração

`sourceKinds` e `targetKinds` declaram as categorias permitidas para as instâncias concretas. Facções não recebem HP, posição ou atributos de combate. Condições de sobrevivência/distância e operações sobre personagens continuam resolvendo `character`; usar uma facção nesses papéis gera erro.

`unique: true` rejeita outra relação com a mesma combinação `definitionId + sourceId + targetId`, sem deixar registros ou inscrições parciais. Isso vale para amizade e reputação. Tipos diferentes podem conectar as mesmas pontas. `unique: false` permite múltiplas instâncias; este contrato é testado com dados mínimos, sem implementar novos contratos ou gameplay. Todas as relações existentes são correntes; não foi adicionado ciclo de ativação/arquivamento.

`findRelation(world, definitionId, sourceId, targetId)` retorna a relação ou `undefined`, validando definição e pontas sem criar vínculos. `requireRelation` exige exatamente uma relação e lança erro se estiver ausente. Se um tipo não único tiver várias correspondências, a consulta singular rejeita a ambiguidade; a alteração deve usar o ID concreto. Ausência é diferente de intensidade zero e nunca presume um valor inicial.

`getRelationIntensity`, `setRelationIntensity` e `addRelationDelta` trabalham por ID de instância, validam referências e compartilham os limites do tipo. Leituras rejeitam intensidade inválida; atribuições e criação limitam valores finitos ao intervalo declarado. Deltas são somados ao valor atual e limitados pelo mesmo mecanismo. NaN, infinitos e soma que transborde para infinito são rejeitados antes da alteração. Para amizade, não há intervalo imposto além de intensidade finita; para reputação, o intervalo é 0–100. `intensity` ausente na definição significa ausência de limites, não ausência de valor na instância.

Essas funções são os mecanismos internos mínimos da migração, não uma nova API pública abrangente. A consulta percorre a visão derivada; não foi adicionado índice numérico paralelo. Os estados continuam acessíveis em TypeScript; escritas diretas podem contornar as funções, portanto os limites não constituem congelamento ou proteção universal contra mutação externa.

### Migração da reputação e adaptadores preservados

O cenário 02 declara duas relações `reputation`, governo → jogador e resistência → jogador, ambas com intensidade inicial 50. `factions[].relation` foi removido e as amizades do cenário 03 passaram de `socialRelations` para a mesma lista de configuração `relations`. Não há leitura/escrita dupla nem alias para a estrutura antiga.

O valor declarativo `{ "source": "relation", "faction": "faction" }` e a operação `{ "type": "relation", "faction": "opponent", "amount": -15 }` foram preservados como **adaptadores de contexto de missão**. Eles resolvem a facção pelo papel, localizam `reputation` com origem nessa facção e destino no ator da execução, e delegam leitura/delta às funções comuns. A ausência dessa reputação obrigatória é erro de configuração/integridade, sem valor zero implícito. O modelo permite reputações de outros personagens sem armazená-las no jogador global.

Os campos `min`/`max` da antiga operação de reputação foram removidos dos tipos e JSONs: os limites agora pertencem à definição da relação. Os deltas +20/−15, o limiar 20, as faixas de recompensa e o teto de dano continuam nos eventos. A ordem das operações preserva a recompensa calculada após a mudança de reputação. `relationIntensity` das reações utiliza a mesma função de leitura comum.

`character.factionId`, os IDs dos participantes da missão e `character.references.hostileTo` continuam referências diretas. Não são vínculos numéricos independentes e não foram transformados em relações. Permanecem especializados a resolução `faction/opponent`, as regras de missão, a UI e o significado visual de `hostileTo`.

Foram eliminados o armazenamento numérico especial, a aritmética separada de reputação e a ambiguidade de vínculos duplicados nos tipos únicos. Permanecem os débitos de mutabilidade externa, reindexação de regras, fatos locais à memória, conclusão de missões por `react` e ausência de rollback completo. Uma relação pode ser rejeitada sem alterações parciais, mas um evento com várias operações ainda não é uma transação. Não foi introduzida infraestrutura para remoção, histórico, contratos, registro programático ou auditoria.

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

## Auditoria e inspeção — 0.3.0

O estado canônico continua em `world.instances`. A auditoria é um diagnóstico da execução real e o inspetor produz fotografias do estado atual; nenhum deles substitui o registro ou reconstrói partidas. Não há event sourcing, persistência ou rollback geral.

### Contrato e consumo TypeScript

`audit.ts` oferece `AuditLog`, `AuditRecord`, `AuditScope`, `audited`, `note` e `snapshot`, sem Phaser ou DOM. Cada mundo recebe um serviço não enumerável `world.audit`, excluído da serialização do estado canônico. `createWorld(id, { enabled?, capacity? })` habilita auditoria por padrão, com até 1000 registros retidos. `createIdentityStore` também pode receber um `AuditLog`. Para diagnosticar uma montagem que pode falhar, o chamador pode criar o log antes e passá-lo a `createWorld(id, log)`. Use um log novo por mundo/tentativa; compartilhar explicitamente o mesmo serviço compartilha o histórico e o namespace diagnóstico.

```ts
const world = createWorld('social', { capacity: 2000 });
const cancel = world.audit!.subscribe(record => console.log(record));
const result = interact(world, world.entities[0]);
// Ligação explícita do legado, quando ele é consequência dessa ação:
react(world, undefined, world.audit!.causeOf(result));
const history = world.audit!.records();
const stats = world.audit!.stats();
cancel();
world.audit!.clear(); // Não altera personagens, relações, missões ou IDs.
```

`records()` retorna o histórico cronológico retido; `subscribe()` recebe somente registros novos em microtasks, após a pilha síncrona narrativa. `clear()` esvazia a retenção e zera o contador de descartes dessa janela, mas não reinicia sequência, IDs de ocorrências ou traces. Cada inscrição tem identidade própria e seu cancelamento impede entregas ainda pendentes. Distribuição e retenção são independentes: registros descartados/limpos podem já estar agendados para assinantes. Não há replay automático de histórico.

O buffer circular limita o histórico; `stats()` informa capacidade, retidos, descartados, sequência, habilitação e erros de consumidores. As notificações já agendadas são transitórias e não fazem parte desse limite. Erros síncronos, rejeições de promises/thenables e falhas de conversão da mensagem de um consumidor não interrompem outros consumidores nem são propagados como erros narrativos. São contabilizados em `observerErrors`/`lastObserverError`, sem emitir novos registros recursivamente. Consumidores recebem apenas dados destacados/congelados; isso não é um sandbox contra closures que já possuam acesso externo ao mundo mutável.

### Identidade e causalidade dos registros

Um `AuditRecord` contém `id`, `sequence`, `worldId`, `traceId`, `parentId?`, `category`, `phase`, `status`, `instanceIds`, `definitionIds` e `data`. `sequence` é a ordem lógica monotônica do serviço; não depende de relógio/timestamp. IDs diagnósticos têm namespace `world_N:audit:S`, traces usam `world_N:trace:T`, e nenhum deles chama `identity()` ou consome RNG. Não são IDs persistentes de partidas/fatos.

`traceId` agrupa a cadeia; `parentId` aponta para a ocorrência concreta causadora. Registros `start` abrem spans; pontos e encerramentos apontam ao início correspondente. O contexto `AuditScope` é passado explicitamente pelos módulos. Não há contexto causal global implícito. Contexto de outro mundo é rejeitado antes de mutações, com diagnóstico separado no log local.

O evento continua devolvendo os mesmos objetos `Fact` com tipo/participantes. Um `WeakMap` do log associa o objeto do fato à ocorrência `fact/emitted`; o despacho usa essa causa para ligar regra, operação e mutação. Para fatos fornecidos diretamente sem causa conhecida, abre-se uma cadeia própria. Resultados de comandos/interações também podem ser consultados por `causeOf(result)`. `react(world)` isolado abre outra cadeia; a cena passa explicitamente a causa do resultado anterior, sem migrar missões para fatos.

Na integração do cenário social, uma esquiva registra seleção de `attack`, condições, amostra RNG/outcome `dodge`, emissão de `attackAttempted`, despacho, avaliação das quatro relações inscritas, aplicação da reação de A e mutação de `references.hostileTo`. Todas pertencem ao mesmo trace. Não há avaliação inventada para C: ele não fornece uma relação inscrita. A relação vítima → E é registrada com sua direção real e rejeitada na condição correspondente.

### Fidelidade, fotografias e falhas

Condições são registradas onde realmente são avaliadas, respeitando short-circuit. Comparações incluem os operandos efetivamente calculados; nenhuma condição é reavaliada apenas para montar logs. O `when` da seleção e sua revalidação posterior são avaliações reais distintas, com ancestrais distintos. O sorteio registra a única amostra obtida, pesos, total e outcome, inclusive para eventos de um só resultado. Não há RNG extra.

Mutações incluem instância/definição, caminho da propriedade, `before`, `after` e operação responsável. Atribuições de valor igual são marcadas `unchanged`; criações registram propriedades iniciais e referências. Configurações que ocorrem depois do registro inicial são mutações subsequentes, não uma criação retroativamente reescrita.

Registros, arrays e dados são cópias profundamente congeladas e serializáveis. `undefined` é representado por `{ "$undefined": true }`; números não finitos por `{ "$number": "NaN" }` ou equivalente; ciclos são marcados `[Circular]`. Não são armazenados objetos vivos nem fotografias completas do mundo a cada registro.

Recusas legítimas têm status `rejected`/`unavailable`; falhas técnicas geram `failure` e a exceção original continua propagando. Uma mesma exceção pode aparecer em spans aninhados, representando sua propagação, não novas execuções. `stateReverted: false` explicita que não foi executado rollback. Uma operação anterior pode permanecer aplicada; o fato marcado como consumido antes de uma falha em reação continua consumido, preservando a semântica anterior. O resultado do comando continua descrevendo seu resultado direto; as consequências sociais aparecem nos registros posteriores.

### API de inspeção e painel

`createInspector(store).list(kind?)` e `.find(instanceId)` retornam `InstanceSnapshot` destacados, congelados e serializáveis: `id`, `definitionId`, `kind`, `properties`. As propriedades contêm estado e referências, incluindo intensidade e status; o objeto vivo da definição é omitido. Uma fotografia antiga não muda quando a partida avança. Consultar o inspetor não executa comandos nem produz auditoria.

Durante `npm run dev`, o botão **Abrir inspetor** monta o consumidor HTML/TypeScript em `src/dev/AuditPanel.ts`. O painel permite filtrar categorias de registro, buscar IDs, selecionar ocorrências e ver JSON/trace/pai, listar instâncias por tipo e inspecionar relações conectadas. O rodapé mostra descartes e erros de consumidores. Pais ausentes por retenção/limpeza são indicados. **Limpar histórico** só limpa diagnósticos; **Atualizar estado** consulta novamente as instâncias, inclusive após escritas externas não auditadas.

O painel atualiza por assinatura, agrupa renderizações em microtask e cancela a inscrição ao reiniciar/trocar cenário. Eventos de teclado dentro de seus controles não propagam ao jogo. A importação dinâmica está condicionada a `import.meta.env.DEV`; o build de produção não monta nem importa o painel. Auditoria de núcleo pode continuar habilitada sem interface ou ser desligada com `{ enabled: false }`.

### Cobertura verificável e caminhos não interceptados

| Caminho encontrado | Instrumentação |
|---|---|
| `identity` / `nextId++` | Alocação diagnóstica com contador anterior/posterior; não equivale a criação confirmada. |
| `createEntity`, facções em `createWorld`, `createRelation`, missão em `spawnTarget` | Registrador compartilhado `registerInstance`: uma criação por instância. Fábricas também registram falhas. |
| `createWorld`: `label`, `factionId`, `offer`; `spawnTarget`: `factionId` | Mutações explícitas após criação. |
| Operações: `hp`, `attributes[key]`, `references[key]`, `mission.status` | Operação, mutação anterior/posterior e falha propagada. |
| `setRelationIntensity` / `addRelationDelta` | A mutação é registrada apenas no setter; delta e operação são seus ancestrais. |
| `movePlayer` | A cena fornece scope; movimento válido registra posição, bloqueado registra recusa sem mutação. |
| `world.entities`, `ctx.missionId` | Montagem/entrada no mapa e atualização de contexto identificadas como auxiliares, sem duplicar HP. |
| `factSubscriptions`, `processedFacts` | Registros de inscrição/consumo e decisão de ignorar fato já consumido. `visited` permanece temporário. |
| `react` legado | Decisões, eventos e alterações instrumentados; ligação causal somente por scope explícito. |
| Círculos, textos, flashes, seleção e temporizadores da cena | Estado visual, fora da auditoria canônica. |
| Escritas externas diretas em instâncias, subobjetos, registro, listas, definições e índices | **Não interceptadas.** Inspetor mostra o estado atual, sem fabricar histórico. |

Exports de baixo nível `executeEvent`, `applyOperations`, `matches` e `movePlayer` aceitam scope opcional; os três primeiros também usam o contexto de mundo disponível. Chamadas puras sem contexto/scope continuam funcionando, mas **não têm canal de auditoria**. `resolve`, `findRelation`, `requireRelation` e `getRelationIntensity` chamados isoladamente também não auditam suas falhas; dentro de fluxos instrumentados elas são diagnosticadas nos spans correspondentes. Isso impede declarar cobertura universal.

Os testes do serviço e da engine verificam retenção, isolamento, snapshots, causalidade, criação, RNG, recusas, erros parciais, helpers e legado, além de comparar auditoria ligada/desligada nos três cenários. O painel tem verificação de tipos/build; a infraestrutura atual não inclui um teste automatizado de DOM/Phaser ou uma prova visual de layout/interações no navegador.

Débitos reduzidos: ausência de histórico, opacidade das mutações oficiais e falta de inspeção destacada. Permanecem: escrita externa mutável, falhas parciais, fatos identificados por objeto, reindexação e conclusão de missões separada. Limitações novas do diagnóstico: retenção pode remover ancestrais e o painel depende de atualização manual para alterações não auditadas. Não há registro separado de débitos no repositório; esses itens devem ser transferidos ao registro externo do projeto, quando aplicável.
