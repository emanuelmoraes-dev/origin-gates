# Contrato da engine — 0.3.1: exploração e exportação de diagnósticos

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

O painel atualiza por assinatura, agrupa renderizações em microtask e cancela a inscrição ao reiniciar/trocar cenário. Eventos de teclado dentro de seus controles não propagam ao jogo. A importação dinâmica está condicionada a `import.meta.env.DEV`; o build de produção não monta nem importa o painel. Desde a 0.3.1, a cena chama `createWorld(id, { enabled: import.meta.env.DEV })`: produção também deixa de coletar registros por padrão. `AuditLog` e `createWorld` preservam seus padrões habilitados para consumidores TypeScript; estes podem ativar auditoria explicitamente sem depender da política da cena.

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

## Exploração e exportação — 0.3.1

Esta versão modifica somente as ferramentas de consulta/apresentação e a política de coleta na cena. Não muda instâncias, eventos, sorteios, regras ou o armazenamento do `AuditLog`.

### Exportação schema 1

**Exportar diagnóstico JSON** usa `createDiagnosticExport(world)` em `src/dev/diagnostics.ts`. A função lê `audit.stats()`, `audit.records()` e `createInspector(world).list()` sincronamente, sem executar comandos, registrar acontecimentos, limpar histórico ou reiniciar o mundo. O resultado é destacado/congelado; registros anteriores e fotografias exportadas não mudam depois.

```json
{
  "schemaVersion": 1,
  "scenarioId": "training",
  "worldId": "world_1",
  "exportedAt": "2026-11-21T15:00:00.000Z",
  "audit": {
    "stats": {
      "worldId": "world_1", "enabled": true, "capacity": 1000,
      "retained": 0, "discarded": 0, "sequence": 12, "observerErrors": 0
    },
    "records": []
  },
  "instances": []
}
```

O exemplo ilustra os campos; em uma partida real `instances` contém as fotografias atuais mesmo após limpar os registros. `schemaVersion` versiona o formato diagnóstico; `scenarioId` identifica o cenário; `worldId` identifica o namespace diagnóstico; `exportedAt` é um timestamp ISO UTC apenas de metadado, sem papel na ordem lógica. `audit.stats` conserva as estatísticas públicas, incluindo descartes por capacidade na janela atual e eventual `lastObserverError`; `audit.records` conserva todos os registros retidos em ordem de sequência e seus IDs, valores e referências causais. `instances` contém os snapshots com `id`, `definitionId`, `kind` e `properties`. Se o mundo não disponibilizar serviço de auditoria, `worldId`/`stats` são `null` e `records` é vazio; o inspetor continua disponível.

Os filtros visuais nunca são parâmetros da exportação. Não são serializados o serviço interno, listeners, callbacks, WeakMaps/WeakSets ou o mundo inteiro. Marcadores de `undefined`/números especiais dos registros seguem o contrato 0.3.0. O arquivo é diagnóstico, não um savegame nem formato de importação/replay.

O painel cria um `Blob` JSON e um object URL, solicita download por um link nativo e remove o link. O nome contém projeto, cenário, mundo e instante, sanitizados e com componentes limitados para evitar nomes inválidos. URLs são revogadas após a solicitação e timers/URLs pendentes são liberados na desmontagem. Falhas de preparação/solicitação aparecem no painel sem alterar a partida. As APIs nativas não permitem confirmar que o usuário realmente salvou o arquivo ou distinguir cancelamento/bloqueio silencioso pelo navegador; a mensagem informa apenas **Download solicitado**.

### Lista e árvore causal

O seletor **Visualização** alterna **Cronológico** e **Árvore causal**. A lista conserva a ordem de `sequence`. A árvore usa `buildCausalTree` de `src/dev/audit-view.ts`, independente de DOM e Phaser: agrupa por `traceId` e conecta somente IDs de pai explícitos, retidos e da mesma cadeia/mundo. Grupos são ordenados pela primeira sequência retida; raízes e irmãos, por `sequence`. Compartilhar participante, proximidade temporal ou trace não implica vínculo pai/filho.

Cada registro, incluindo `start`, `point` e `end`, permanece acessível com seu ID original e detalhes; não se afirma que cada fase é outra ação narrativa. A profundidade é mostrada por indentação. `details/summary` nativos permitem recolher cadeias e descendentes; **Expandir tudo**/**Recolher tudo** controlam a árvore inteira. Registros de falha e recusa têm distinção discreta. **Detalhes #N** seleciona uma ocorrência sem acionar sua expansão. Seleção e estados de abertura são preservados durante atualizações e alternância de visão, enquanto os IDs continuarem retidos.

Um pai ausente produz uma raiz parcial identificada, conservando o `parentId` original. Pais em outra cadeia/mundo, IDs duplicados e ciclos são sinalizados; a visualização não tenta corrigi-los no histórico. Para um ciclo, interrompe-se uma aresta apenas na árvore e conserva-se cada registro. Construção, poda e renderização usam percursos iterativos para evitar recursão infinita ou overflow em cadeias profundas.

O rodapé conserva o contador de descartes e o aviso superior mostra relações causais ausentes/inconsistentes em todo o histórico retido, independentemente do filtro. Um histórico filtrado ou truncado nunca é apresentado como execução completa. Limpar esvazia ambas as visões; uma seleção removida por limpeza/evicção informa que o registro não está mais retido, em vez de manter uma cópia oculta ou inventar detalhes.

### Semântica dos filtros

- **ID de instância** aceita parte do ID. O padrão **cadeia relacionada** encontra traces com pelo menos um registro retido contendo esse ID em `instanceIds` e permite mostrar todos os registros dessas cadeias, incluindo resultados/operações sem participante direto. Só a camada de consulta faz essa associação; `instanceIds` não é modificado.
- **participação direta** restringe as correspondências aos registros cujos próprios `instanceIds` combinam com a busca.
- **Categoria** restringe a categoria das correspondências. A descoberta de traces relacionados à instância considera o histórico completo retido, antes dessa restrição, para que um filtro `outcome` ainda encontre resultados cujo participante esteja declarado no comando.
- **traceId** é correspondência exata, evitando confundir `trace:2` com `trace:20`. **Ver cadeia selecionada** preenche esse campo e limpa categoria/instância; a seleção original permanece disponível.
- Na lista, aparecem somente correspondências. Na árvore, acrescentam-se seus ancestrais explícitos como **contexto**, com identificação visual; irmãos não correspondentes são omitidos. Novos ramos filtrados abrem inicialmente para revelar as correspondências, respeitando escolhas de recolhimento já feitas.
- A lista de instâncias atuais usa seu filtro de categoria/ID, sem reconstruir o estado histórico. Filtros de categoria de registro e trace não restringem o estado atual.

Se a única participação direta de uma instância foi descartada, não se pode deduzir sua associação a registros restantes apenas pela ausência de dados. Os filtros não reconstroem ancestrais nem participantes perdidos. Exportar continua incluindo todo o histórico retido.

### Validação e limitações mantidas

Testes sem Phaser cobrem schema, serialização, fotografias destacadas, exportação vazia/truncada/sem filtro, construção por pai, ordenação, isolamento de traces, ciclos, ancestralidade filtrada e consulta do registro selecionado nas duas visões. A suíte anterior continua protegendo os três cenários e a paridade de auditoria ligada/desligada. O build verifica a política da cena e a ausência do painel em produção. Download real, comportamento visual de expansão/recolhimento, alternância após reinícios e teclado continuam itens de validação manual no navegador, sem adicionar framework DOM.

Permanecem sem resolução nesta versão: falhas na preparação dos próprios registros, acúmulo potencial de notificações, consumidores que geram novos registros recursivamente, escritas externas que contornam a instrumentação, falhas parciais/ausência de atomicidade e reações de missão separadas. A exportação registra o estado atual e o histórico ainda disponível; não recupera informações descartadas e não oferece garantias transacionais.

## Independência e construção programática — 0.4.0

### Fronteiras e entrada pública

`src/game/index.ts` é a entrada pública TypeScript. Seu grafo de dependências permanece inteiramente em `src/game`, sem JSON, adaptador de conteúdo, DOM ou Phaser. Nenhum identificador de cenário decide a montagem no núcleo; `scenarioId` é apenas metadado diagnóstico. O mapa retangular de `land`/`water` é fornecido pelo consumidor, copiado e congelado. Movimento continua cardinal, bloqueado por água, limites e personagens vivos.

`src/content/originGates.ts` carrega os JSONs atuais, registra um lote e resolve exclusivamente ali os símbolos declarativos (`player`, facções, `A`, `victim` etc.). `src/content/map.ts` fornece o mapa fixo preservado. A cena e o seletor passam a importar esse adaptador. Não há segundo interpretador: adaptador e API usam `createWorldState`, `createCharacterInstance`, `createFactionInstance`, `createRelation` e os mesmos caminhos de execução. `spawnTarget` também usa `createCharacterInstance`, incluindo automaticamente seu personagem em `world.entities`.

APIs públicas:

| Entrada | Contrato |
|---|---|
| `createEngine()` | Cria um registro privado, inicialmente vazio. |
| `engine.registerDefinitions(batch)` | Registra um lote validado de definições. |
| `engine.definitions` | Catálogo congelado, organizado por categoria e ID. |
| `engine.createWorld({ map, player, scenarioId?, audit?, missions? })` | Cria mundo isolado, jogador e estruturas auxiliares. `player` é um `CharacterConfig`. `missions` habilita um subconjunto; omitido, habilita todas as missões registradas. |
| `world.registerDefinitions(batch)` | Registro aditivo local ao mundo, entre execuções. |
| `world.createCharacter({ definitionId, position, label?, factionId?, interactions?, offer? })` | Registra personagem e o inclui no mapa automaticamente; retorna handle congelado. |
| `world.createFaction(definitionId)` | Instancia facção e retorna handle. |
| `world.createRelation({ definitionId, sourceId, targetId, intensity })` | Valida pontas/unicidade/intensidade e registra instância e inscrições reativas; retorna handle. |
| `world.player`, `world.map`, `world.definitions` | Handle do jogador, mapa e catálogo imutáveis. |
| `world.move(actorId, dx, dy)` | Executa movimento auditado, retornando aceitação/recusa. |
| `world.interact({ actorId, targetId, random? })` | Seleciona a primeira associação cujo `when` é aplicável e executa/valida o evento. |
| `world.command({ eventId, actorId, targetId, random?, context? })` | Executa evento explícito, revalidando `when` e `conditions`, sem procurar associações. |
| `world.react({ cause?, random? }?)` | Executa somente o polling legado de missões. `cause` é um resultado anterior deste mundo e liga explicitamente a cadeia causal. |
| `world.inspect.list(kind?)`, `.find(id)` | Fotografias destacadas, congeladas, do registro canônico. |
| `world.diagnostics(now?)`, `world.audit` | Exportação schema 1 e serviço diagnóstico existente. |

Handles têm apenas `id`, `definitionId`, `kind`. IDs concretos são únicos **dentro de cada mundo**, não globalmente; cada referência é resolvida no mundo receptor. O consumidor deve conservar o mundo junto ao ID. Resultados de comandos também são cópias congeladas; não expõem referências vivas de instâncias ou definições. Não há API pública para editar arbitrariamente HP, atributos, referências ou índices. A classe `NarrativeWorld` mantém o estado em campo privado JavaScript. Isso não constitui encapsulamento universal do repositório: imports diretos de módulos internos e o adaptador usado pela apresentação ainda permitem acessar `GameState` mutável.

### Exemplo completo e adição posterior

O arquivo `examples/programmatic-world.ts` contém esta construção e é executado por `tests/examples.test.ts`. Pode ser importado por um consumidor TypeScript/Vite sem carregar Phaser:

```ts
import { createEngine } from './src/game'; // ajuste relativo ao consumidor

const engine = createEngine();
engine.registerDefinitions({ characters: [
  { id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff' },
] });
const world = engine.createWorld({
  map: [['land', 'land'], ['water', 'land']],
  player: { definitionId: 'citizen', position: { x: 0, y: 0 } },
});
const other = world.createCharacter({
  definitionId: 'citizen', position: { x: 1, y: 0 },
});

// Em um momento posterior, entre execuções narrativas:
world.registerDefinitions({ relations: [{
  id: 'religiousDevotion', name: 'Devoção', sourceKinds: ['character'],
  targetKinds: ['character'], unique: true, reactions: [],
}] });
const relation = world.createRelation({
  definitionId: 'religiousDevotion', sourceId: world.player.id,
  targetId: other.id, intensity: 90,
});
console.log(world.inspect.find(relation.id));
```

O exemplo só instancia uma relação estrutural sem comportamento novo. A prova completa dos três cenários, incluindo eventos e regras declarativas, está em `tests/fixtures/programmatic.ts`: literais TypeScript independentes dos dados de produção. `tests/programmatic.test.ts` usa somente a API; `tests/scenario-equivalence.test.ts` compara essas construções com o adaptador JSON em sequências idênticas, incluindo movimento real e RNG controlado. Não existem dois conjuntos de conteúdo de produção.

### Registro, propriedade e validação

`DefinitionBatch` aceita arrays opcionais `characters`, `factions`, `relations`, `events`, `reactions`, `missions`. IDs têm namespace por categoria. Qualquer duplicata na mesma categoria é erro, inclusive uma definição idêntica e duplicatas dentro do lote. Não há substituição/remoção. Todos os dados são clonados e congelados recursivamente antes de pertencer ao registro; alterações posteriores no objeto original não afetam a engine. Não se aceitam ciclos, funções, accessors, instâncias de classes ou números não finitos. A engine não congela os objetos do chamador.

O registro constrói um candidato com o catálogo anterior e todo o lote, valida esse candidato e só então o publica. Referências futuras **dentro do mesmo lote** funcionam: objeto → evento, oferta → missão/personagem/facção, missão → evento e relação → reação. Referências ausentes em outros lotes ainda não registrados são erro. Um lote inválido não deixa parte de suas definições visível. Essa atomicidade é específica do registro; não implica transações sobre operações narrativas.

A validação runtime cobre IDs não vazios, categorias conhecidas, HP máximo positivo, nomes/cores dos objetos, flags, posições inteiras, associações/contexto de interação, referências de ofertas, categorias/unicidade/limites de relações, condições/operandos/referências/operações reconhecidos, estados de missão, pesos positivos finitos, total finito, feedback e emissão de fatos. `reputation` continua sendo referência especializada exigida quando uma operação/valor de reputação é registrada. Não é um schema universal: não prova antecipadamente a disponibilidade de todo contexto de execução ou a validade narrativa de qualquer combinação de operações. Campos adicionais de dados simples não constituem novas instruções. Falhas de contexto/integridade continuam exceções, com possibilidade de efeitos anteriores permanecerem aplicados.

Preservadas as normalizações: intensidade finita é limitada apenas quando a definição declara `intensity.min/max`; sem limites, permanece como fornecida. Intensidade negativa não é automaticamente proibida. Dano continua limitado pelo interpretador para não produzir HP negativo, e recompensas continuam seguindo a primeira faixa inclusiva e o teto declarado. A criação valida posição inteira, mas não reserva tiles nem impõe uma política nova de spawn/ocupação: configurar um personagem fora de terra ou sobre outro continua responsabilidade do montador. A movimentação mantém suas verificações espaciais.

### Isolamento e extensibilidade temporal

Cada engine possui seu registro; cada mundo recebe um fork do catálogo imutável atual. Definições congeladas podem compartilhar identidade em memória; as tabelas e futuras adições são locais. Registrar na engine posteriormente só afeta mundos criados depois. Registrar num mundo não modifica o registro da engine ou de outros mundos.

`world.registerDefinitions` é permitido somente entre execuções síncronas de interação, comando e reação legada. Um contador protegido por `try/finally` cobre também o despacho síncrono dentro do comando; tentativa de registro a partir do RNG é rejeitada, e a guarda é liberada mesmo após exceções. A adição não executa regras, não reproduz fatos anteriores, não cria instâncias e não altera inscrições das relações existentes. Uma relação de definição inédita pode então ser criada entre instâncias já presentes; sua criação instala as inscrições daquela relação. Novas definições de missão passam a ser habilitadas; missões anteriores explicitamente desabilitadas na configuração inicial permanecem assim.

Não há hot reload, migração, atualização concorrente ou promessa de segurança contra código TypeScript malicioso. RNG é o ponto de controle probabilístico, não um callback declarativo de comportamento. Não foram introduzidos callbacks de reação, novos fatos, condições ou operações.

### Contexto de execução e especializações preservadas

Interações identificam o ator por `actorId`, inclusive quando ele não é o jogador. A lista de associações da instância substitui a da definição integralmente, inclusive `[]`. Cada associação pode pedir `{ context: { offer: 'target' } }`: a engine usa a oferta concreta do alvo e encontra a missão pendente para **aquele ator e contratante**. As recusas de `conditions` continuam resultados, sem fallback para outro evento ou ataque.

Comandos explícitos precisam solicitar `context: { offer: 'target', missionId? }` quando o evento depende de missão/oferta. Exemplo: `world.command({ eventId: 'deliver', actorId, targetId: contractorId, context: { offer: 'target', missionId }, random: () => 0 })`. `missionId` é validado contra contratante/executor pelo interpretador. Omitido, é selecionada a missão pendente do par ator/contratante. Não existe contexto arbitrário fornecido pelo consumidor. `offer.opponentId` e `factionId` são IDs de facções concretas; o núcleo não resolve nomes simbólicos nem escolhe uma instância por ID de definição. Definição com template `offer` exige oferta concreta ao instanciar o representante; overrides de oferta também passam pelas mesmas validações. A oferta deve referenciar missão habilitada neste mundo.

Comandos admitidos produzem os fatos declarados e os despacham automaticamente. Fatos mantêm `type`, `actorId`, `targetId`; relações já inscritas selecionam regras por tipo, resolvem `relation.source`/`relation.target`, avaliam condições e aplicam as operações existentes. Nada foi migrado do polling de missões para esse despacho. Estados/status, ofertas, `spawnTarget`, recompensa por faixas, papéis facção/oponente e a definição estrutural `reputation` continuam especializações temporárias. Missões continuam sendo criadas pelas operações, sem fábrica pública arbitrária.

### Diagnóstico e cobertura dos caminhos de criação/mutação

Registro anterior à existência de um mundo é validado sem criar histórico ou mundo artificial. Ao criar um mundo auditado, um registro `definition/attached` identifica o catálogo recebido, sem inventar os acontecimentos pré-mundo. Adições no mundo usam `definition/registered`; erros de registro geram falhas diagnósticas sem publicar o candidato. O painel inclui a categoria `definition`. O schema da exportação permanece 1; a implementação pura foi movida para `src/game/diagnostics.ts`, com reexport compatível em `src/dev/diagnostics.ts`.

| Caminho atual | Cobertura e limites |
|---|---|
| `DefinitionRegistry.register` associado a mundo | Tentativa, IDs/categorias confirmados e falhas; catálogo, views e missões habilitadas atualizados como configuração. Registro pré-mundo não tem histórico. |
| `createWorldState` | Criação, catálogo anexado, mapa e jogador configurados; inicialização das listas/índices é parte da criação. |
| `identity` / `nextId++`, `registerInstance` | Alocação com contador e uma criação confirmada por instância, separados dos IDs diagnósticos. |
| `createCharacterInstance`, incluindo jogador, adaptador, API e `spawnTarget` | Criação canônica; mutações de `label`, `factionId`, `offer`; integração automática na lista de personagens do mapa. |
| `createFactionInstance`, `createRelation` | Criação canônica; pontas e intensidade no snapshot inicial; inscrições por fato registradas. |
| Missão em `spawnTarget` | Criação canônica e atualização de `ctx.missionId` auditadas; personagem usa a fábrica compartilhada. |
| Operações `damage`, `attributeReward`, `setReference`, `missionStatus` | Mutações de HP, atributos, referências e status com anterior/posterior; operações sem mudança permanecem identificadas. |
| `setRelationIntensity`, `addRelationDelta` | Setter instrumentado preservado; delta é ancestral, sem duplicar a mutação. |
| `movePlayer`, `world.move`, cena | Movimento/recusa; scope fornecido pelos caminhos públicos e pela cena. |
| `dispatchFacts`: `processedFacts`, inscrições e deduplicação | Consumo/decisões registrados; deduplicação temporária não vira estado narrativo. |
| `react` legado e comandos pela API | Decisões, operações, falhas e RNG; resultados destacados conservam a associação causal para `react({cause})`. |
| Configuração simbólica do adaptador | Resolvida antes das fábricas; configuração final do mapa registrada. Mapas de aliases locais não são estado canônico. |
| Renderer, flashes, seleção, temporizadores, painel | Estado visual/consulta, fora da auditoria narrativa. |
| Escritas externas por imports internos, registro/listas/objetos mutáveis | **Não interceptadas**; a fachada pública reduz a exposição, mas não altera essa limitação dos módulos internos. |

Helpers de baixo nível sem scope/contexto continuam sem canal de auditoria, como descrito na 0.3.0. A instrumentação não torna o processamento transacional: falhas parciais, preparação dos próprios registros e consumidores assíncronos conservam suas limitações. Não se afirma cobertura universal de mutações externas.

### Evidências, débitos e validação manual

Os 157 testes anteriores foram preservados; adaptações restringem-se aos imports de conteúdo/mapa, agora em `src/content`. As novas provas verificam registro válido/inválido/atômico, propriedade dos dados, duplicatas, referências concretas, isolamento, integração no mapa, adições sem retroatividade/reindexação, proteção durante comandos e polling legado, personagens com ator não jogador, paridade dos três cenários, RNG, causalidade, snapshots/exportação e auditoria ligada/desligada. `tests/independence.test.ts` percorre imports transitivos de **todos** os módulos do núcleo, das provas programáticas e do exemplo; rejeita conteúdo, Phaser, JSON e dependências dinâmicas nessa fronteira. Isso complementa a execução real sem navegador; não prova independência de APIs que venham a ser adicionadas sem passar pelos testes.

| Débito | Classificação nesta versão |
|---|---|
| DT-17 — dependência dos JSONs | Resolvido para o núcleo: carregamento e símbolos isolados no adaptador; provas transitivas e executáveis. |
| DT-01 — coerência de criação canônica/auxiliares | Resolvido nos caminhos oficiais de criação de personagens/facções/relações/missões: serviço compartilhado integra mapa e inscrições. Escrita direta por internos pode ainda violar invariantes; não implica resolver toda mutabilidade externa. |
| DT-18 — API de instâncias | Parcial: criação explícita de personagens/facções/relações e execução por IDs; sem ciclo de vida universal, remoção ou fábrica arbitrária de missões. |
| DT-07 — validação externa | Parcial: fronteira runtime proporcional e registro atômico; sem schema universal, validação semântica completa de contextos ou rollback de operações. |

Mantidos: mutabilidade dos internos, transações/falhas parciais, memória narrativa, deduplicação por identidade do objeto-fato, entrega assíncrona de auditoria, retenção limitada e reatividade legada separada. Limitações explícitas novas: duplicatas idênticas também são rejeitadas; referências entre lotes exigem disponibilidade anterior; não há atualização retroativa de mundos/assinaturas; a seleção de missões habilitadas precisa ser decidida na montagem. Não foram acrescentadas dependências externas.

Typecheck/build não substituem validação visual. Os testes não exercitam DOM/Phaser, download real ou teclado no navegador. Permanecem necessárias a validação manual completa dos cenários 02/03 após 0.3.x e a conferência visual dos três cenários e ferramentas de diagnóstico nesta versão.

## Composições e referências contextuais — 0.4.1

Esta versão adiciona montagem coletiva à API 0.4.0; não migra os cenários de produção nem seus contextos de eventos. `src/content/originGates.ts` continua montando os três cenários sobre as fábricas compartilhadas. Não há pacotes separados, dependências novas ou conteúdo do Origin Gates/Phaser importado pelo núcleo.

### Definição e instância

`DefinitionBatch` passa a aceitar `compositions: CompositionDefinition[]`. Cada definição possui `id` e, opcionalmente, `characters`, `factions`, `relations`, `parameters` e `roles`. Registro aditivo, validação do lote inteiro, referências cruzadas no mesmo lote, cópias congeladas e isolamento por mundo conservam as garantias da 0.4.0. Não há composição aninhada, loops, condicionais ou quantidades aleatórias.

| Campo | Contrato |
|---|---|
| `characters[]` | `key`, `definitionId`, `position` local; opcionais `label`, `faction`, `interactions`, `offer`. `faction` é referência contextual, convertida em `factionId`. Interações da instância substituem as da definição, inclusive `[]`. |
| `factions[]` | `key` e `definitionId`; cada montagem cria facções distintas. |
| `relations[]` | `definitionId`, `source`, `target`, `intensity`, `key?`; pontas são resolvidas uma vez e armazenadas como IDs concretos. |
| `parameters` | Mapa `nome: { kind }` de referências externas obrigatórias, fornecidas em `bindings` ao instanciar. Não aceita parâmetros numéricos ou expressões. |
| `roles` | Mapa `nome: { kind, initial?, allowVacant? }`. Um ocupante ou `null`; `allowVacant` é `true` por padrão. Se `false`, exige ocupante inicial e impede desocupação. |
| Referência na definição | Texto ou `NarrativeReference`; `{ parameter: 'nome' }` identifica explicitamente um parâmetro. Não há lookup de instância por ID de definição. |
| `offer` de personagem | `mission`, `name`, `target` são IDs/dados de definição; `opponent` é referência contextual de facção; `spawn` é posição local futura. A fábrica recebe uma `MissionOffer` com `opponentId` concreto e spawn global. |

Uma definição de personagem com template de oferta exige `offer` explícita na composição. Não se adivinha qual instância de uma facção deve substituir `OfferDefinition.opponent`, nem se transforma indiscriminadamente o template de produção. Ofertas de composição podem reutilizar os mesmos IDs de missão/alvo; seus vínculos e coordenadas são próprios de cada montagem.

A instância `kind: 'composition'` pertence a `world.instances`, usa a mesma identidade e contém `origin`, `key?` (alias), `symbols`, `bindings` concretos e `roles`. Não armazena cópias dos estados de seus membros. `symbols.self` identifica a própria composição; as demais chaves identificam personagens, facções e relações nomeadas criados nessa montagem. Relações sem chave continuam canônicas e identificáveis por ID/procedência. `bindings` permanece separado dos símbolos dos novos membros.

### Exemplo público completo

`examples/compositions.ts` contém um exemplo completo executado pelos testes. Abaixo, sua parte essencial, sem JSON ou Phaser:

```ts
import { createEngine } from './src/game';

const engine = createEngine();
engine.registerDefinitions({
  characters: [{ id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff' }],
  relations: [{ id: 'gratitude', name: 'Gratidão', sourceKinds: ['character'],
    targetKinds: ['character'], unique: true, reactions: [] }],
  compositions: [{ id: 'court', characters: [
    { key: 'Arthur', definitionId: 'citizen', position: { x: 0, y: 0 } },
    { key: 'Edward', definitionId: 'citizen', position: { x: 1, y: 0 } },
  ], roles: { rei: { kind: 'character', initial: 'Arthur' } } }],
});
const world = engine.createWorld({
  map: Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 'land' as const)),
  player: { definitionId: 'citizen', position: { x: 0, y: 0 } },
});
const court = world.instantiateComposition({
  definitionId: 'court', key: 'olimpo', origin: { x: 5, y: 5 },
});
const arthur = court.resolve('Arthur');
const gratitude = world.createRelation({ definitionId: 'gratitude',
  source: 'root#player', target: 'olimpo#<rei>', intensity: 80 });
world.assignRole({ compositionId: court.id, role: 'rei',
  instanceId: court.resolve('Edward').id });
// court.resolve('<rei>') agora identifica Edward.
// court.resolve('Arthur') e gratitude.targetId continuam identificando Arthur.
console.log(arthur, world.inspect.find(gratitude.id));
```

O comentário `gratitude.targetId` se refere ao estado consultado pelo inspetor; o handle não expõe esse campo vivo. Os IDs continuam únicos no mundo receptor, não globalmente entre mundos. O consumidor deve conservar o mundo associado ao ID; strings idênticas de mundos diferentes não carregam um token de propriedade capaz de detectar sua origem externa.

### API pública, escopos e gramática

| Entrada | Resultado |
|---|---|
| `world.instantiateComposition({ definitionId, origin, key?, bindings?, context? })` | `CompositionHandle` congelado com `id`, `definitionId`, `kind`, `resolve(ref, kind?)` e `tryResolve(ref, kind?)`. |
| `world.resolveReference(ref, { compositionId?, kind? }?)` | Handle da instância exigida; lança erro tipado em falha ou papel vago. |
| `world.tryResolveReference(ref, context?)` | Handle ou `undefined` **somente para papel válido desocupado**; outras falhas continuam exceções. |
| `world.assignRole({ compositionId, role, instanceId })` | Atribuição controlada; `instanceId: null` desocupa quando permitido. |
| `world.createCharacter({ ..., key? })` | Criação individual com símbolo opcional em `root`. |
| `world.createFaction(definitionId, { key? }?)` | Mesmo contrato anterior, com símbolo raiz opcional. |
| `world.createRelation({ definitionId, intensity, source, target, context?, key? })` | Resolve pontas contextuais imediatamente e chama a fábrica existente. A forma anterior com `sourceId`/`targetId` continua disponível; não se misturam as formas. `key` opcional pertence ao root. |
| `parseReference(textoOuEstrutura)` | Produz `NarrativeReference` estruturada e congelada; não faz lookup. |

`root` é escopo de resolução, não uma instância/composição artificial. `root#player` sempre referencia o jogador inicial; `player.key` opcional cria um segundo símbolo raiz. Instâncias individuais não precisam de chave. Símbolos raiz e aliases de composição têm namespaces separados: `root#court` e `court#self` são inequívocos. Símbolos locais e papéis também têm namespaces distintos (`rei` versus `<rei>`); parâmetros usam `{ parameter }` explicitamente. Entre personagens/facções/relações locais, chaves são únicas. `self` é reservado como símbolo local da composição.

Nomes usam `[A-Za-z_][A-Za-z0-9_-]*`. O namespace `entity_` seguido apenas de dígitos é reservado. Aliases não podem ser `root`, repetir outro alias ou conter delimitadores. A gramática textual é centralizada em `references.ts`:

| Texto | Forma estruturada e significado |
|---|---|
| `entity_000001` | `{ type: 'instance', id: 'entity_000001' }`; IDs textuais usam ao menos seis dígitos. |
| `Arthur` | `{ type: 'symbol', key: 'Arthur' }`; exige `compositionId` explícito ou handle de composição. |
| `<rei>` | `{ type: 'role', key: 'rei' }`; ocupante atual no contexto explícito. |
| `root#kosmos` | `{ type: 'symbol', scope: 'root', key: 'kosmos' }`. |
| `olimpo#Arthur` | `{ type: 'symbol', scope: 'olimpo', key: 'Arthur' }`; alias de composição concreta. |
| `olimpo#<rei>` | `{ type: 'role', scope: 'olimpo', key: 'rei' }`. |

Não há tentativa de interpretar um símbolo como ID de definição ou de procurar outro escopo. `<rei>` não é um símbolo literal e `root` não possui papéis. `ReferenceResolutionError.code` distingue `invalidSyntax`, `missingContext`, `compositionNotFound`, `aliasNotFound`, `symbolNotFound`, `roleNotFound`, `roleVacant`, `kindMismatch` e `instanceNotFound`. Consultas puras não auditam por padrão. Um ID concreto inexistente durante a montagem não pode ser satisfeito por adivinhação de um ID que ainda será criado.

### Duas cidades, bindings e relações entre composições

`tests/fixtures/compositions.ts` declara `rivalCity` com duas facções, representantes, ofertas locais e reputação facção → parâmetro `player`. É conteúdo literal TypeScript de prova, independente dos JSONs. A prova B em `tests/compositions.test.ts` executa este fluxo sobre um mapa 40 × 24:

```ts
// Após registrar a definição rivalCity da fixture e criar o mundo:
const a = world.instantiateComposition({ definitionId: 'rivalCity', key: 'cityA',
  origin: { x: 2, y: 2 }, bindings: { player: 'root#player' } });
const b = world.instantiateComposition({ definitionId: 'rivalCity', key: 'cityB',
  origin: { x: 22, y: 2 }, bindings: { player: world.player.id } });
const governmentA = a.resolve('government');
const governmentB = world.resolveReference({ type: 'symbol', scope: 'cityB', key: 'government' });
// governmentA.id !== governmentB.id; reputações e missões são independentes.
```

Relações globais podem conectar essas facções, personagens, elementos de root ou composições, se `sourceKinds`/`targetKinds` permitirem. A chave local da relação e `createdByCompositionId` não restringem suas pontas. Unicidade continua sendo definição + origem + destino; não significa exclusividade de cargo ou pertencimento. `membership` na fixture é somente uma definição de relação, sem arrays paralelos de membros atuais.

Bindings aceitam IDs, formas estruturadas ou textos como `family#prince` e `court#<rei>`. `context` no pedido de instanciação serve **apenas para referências não qualificadas dos bindings**, resolvidas no mundo já existente. As referências dentro da definição usam a nova composição. Todos os parâmetros declarados são obrigatórios e têm categoria validada. Um binding é capturado em `bindings.nome = id`: mudar depois o papel usado como entrada não altera o binding. Um príncipe externo pode ocupar o papel militar e receber relações de soldados, mantendo posição, identidade e origem familiar; a prova E verifica isso sem duplicação. Dependências de composições externas ainda inexistentes falham, sem resolução futura/circular.

### Coordenadas, procedência e papéis

Somente `characters[].position` e `characters[].offer.spawn` são locais: somam `origin.x/y`. `CompositionConfig.origin` e posições/`MissionOffer.spawn` das fábricas individuais permanecem globais. Não se percorrem propriedades arbitrárias `x/y`, não se movem bindings e não se reescrevem as definições. A origem é uma âncora inteira finita; quem precisa estar em terra dentro do mapa são os pontos concretos declarados. Nenhuma rotação/escala é aplicada.

Na montagem coletiva, personagens devem estar em terra dentro do mapa e não sobrepor personagens vivos já existentes ou outros personagens planejados. Personagens mortos não ocupam tiles. Ofertas futuras são verificadas estaticamente para terra/limites, mas seus tiles não são reservados nem bloqueados por ocupação atual. A ocupação dinâmica de `spawnTarget` conserva a política anterior da criação individual, que **não rejeita sobreposição**; o teste explicita essa limitação em vez de alterar regras de missão nesta versão. Um futuro tratamento de spawn ocupado deve definir sua própria semântica de recusa, fora desta entrega.

Personagens, facções e relações criados durante a montagem recebem `createdByCompositionId` desde seu registro inicial. Esse ID é origem estrutural estável, não facção atual, nacionalidade ou pertencimento. Mover uma instância, ocupar papel em outra composição ou criar uma relação de organização não transfere origem. Elementos externos não recebem essa propriedade. Missões/alvos criados posteriormente por operações de um representante **não herdam automaticamente** sua composição; o spawn global já resolvido na oferta é suficiente para a prova das duas cidades.

Papéis têm categoria e zero/um ocupante. A atribuição valida composição/papel/ID existentes e categoria no mundo receptor. Não consulta HP nem interpreta o significado narrativo do papel. Trocar Arthur por Edward não redireciona o símbolo `Arthur`, relações pessoais, missões existentes ou origem. Não são emitidos fatos de sucessão nem consequências políticas. `roles` não cria instâncias canônicas adicionais.

### Preparação, confirmação e garantias de falha

Antes de consumir IDs, `prepareComposition` resolve bindings existentes, prepara um lookup prospectivo de identidades/categorias, resolve referências locais/papéis, traduz posições e chama os validadores puros extraídos das fábricas (`prepareCharacter`, `prepareRelation`). A preparação não chama as fábricas nem executa eventos/operações. Inclui referências de ofertas, missões habilitadas, sobreposição, categorias e duplicatas de relações também entre participantes externos. Símbolos duplicados/inexistentes e categorias estáticas já são validados ao registrar o lote.

Relações podem referenciar relações declaradas posteriormente; a confirmação usa ordenação por dependências, com percurso determinístico na ordem de declaração. Papéis iniciais também podem referenciar papéis posteriores. Ciclos de dependência de relações ou papéis iniciais são rejeitados antes da criação. Não existe migração/rebind tardio de pontas. IDs previstos são ajustados à ordem final; nenhuma alocação narrativa é registrada durante a preparação.

Após validação, cria-se a composição, depois facções, personagens, relações em ordem de dependência, papéis iniciais e alias. As mesmas fábricas registram membros, integram personagens ao mapa e instalam inscrições reativas. A guarda síncrona de registro aditivo cobre toda a montagem. `assignRole` é também o caminho usado para atribuições iniciais.

**Garantia verificada:** erros previsíveis cobertos pela preparação não deixam instâncias, aliases, papéis, inscrições ou consumo de IDs no mundo. Testes com falha tardia de papel, duplicatas externas, categorias incompatíveis, bindings, ciclos, ofertas e posições comparam snapshots anteriores/posteriores e o próximo ID; uma tentativa rejeitada com amizade planejada também é seguida de ataque para verificar ausência de reação fantasma.

Isso não é uma transação universal. Falha inesperada de infraestrutura durante confirmação pode deixar criação parcial; não há rollback. Escritas externas por módulos internos ainda podem violar as invariantes, inclusive durante chamadas reentrantes de código diagnóstico personalizado. A auditoria continua descrevendo `stateReverted: false` nessas falhas. Não há remoção, reparação automática ou persistência.

### Auditoria, inspeção e evidências

Categorias novas: `composition`, `reference`, `role`; filtro de instâncias inclui `composition`. A composição aparece no inspetor com origem, alias, símbolos, bindings e papéis. A exportação schema 1 continua incluindo todo o histórico retido e snapshots de todas as instâncias canônicas, incluindo composições. Root e tabela de aliases são contextos auxiliares, sem instância artificial; bindings de root/aliases são auditados, e o alias de cada composição também está em seu snapshot. O schema não adiciona um snapshot separado do mapa de símbolos raiz.

Exemplo da cadeia de montagem: `composition/start` (definição, origem, alias, bindings solicitados) → `reference/considered` e `reference/resolved` → `composition/validated` → alocações/criações e operações dos membros → `role`/mutações `roles.rei` → alias vinculado → `composition/instantiated`. Todas essas ocorrências pertencem ao mesmo `traceId`, com pais explícitos. Resoluções prospectivas são marcadas `stage: 'preparation'` e usam IDs na ordem final; não afirmam que as instâncias já foram criadas. Em falhas de preparação, a tentativa e a exceção ficam diagnosticáveis sem eventos de alocação/criação.

Posteriores atribuições registram ocupante anterior/posterior e mantêm snapshots antigos destacados. Consultas puras não geram registros. Auditoria desligada conserva os resultados; as provas comparam estado de composições, combate, missão e papel nas duas políticas. Retenção pode remover ancestrais. Não há histórico de registro pré-mundo, conforme contrato 0.4.0.

Novos caminhos de mutação instrumentados: `rootSymbols` na criação individual/jogador; identidade e registro de `composition`; procedência no snapshot inicial dos membros; `symbols`/`bindings` configurados na criação; `compositionAliases` após montagem; `roles[chave]` pela atribuição controlada. Mapa de personagens e inscrições reativas continuam sendo mantidos pelas fábricas já instrumentadas. Lookup prospectivo, IDs previstos e ordenação são temporários, sem mutação narrativa. Permanecem fora da cobertura as escritas diretas por internos e o estado visual, como nas versões anteriores.

Os 212 testes anteriores continuam com as mesmas propriedades. `tests/compositions.test.ts` contém as provas A–F; `tests/composition-integrity.test.ts` cobre registro, isolamento, gramática, referências, papel vago/obrigatório, falhas sem efeitos, relações futuras e o exemplo público. `tests/independence.test.ts` inclui transitivamente esses testes, fixtures, exemplos e todos os módulos do núcleo. Nenhuma prova usa imports internos para completar criação/resolução. Execute `npm test` ou `npm test -- tests/compositions.test.ts tests/composition-integrity.test.ts`.

Débitos tratados: resolução contextual antes restrita ao adaptador ganha infraestrutura genérica; DT-18 avança com criação coletiva e papéis controlados; DT-07 avança com validação estrutural/contextual anterior à montagem; DT-01 conserva integração pelas fábricas oficiais; DT-17 continua resolvido para a independência do núcleo. Permanecem parciais validação semântica de todo contexto, encapsulamento dos internos, falhas parciais/ausência de transações, memória/persistência, auditoria assíncrona e polling legado de missões. Produção ainda usa o adaptador interno, cuja migração e separação de pacotes ficam para 0.4.2.

Limitações deliberadas: nomes simbólicos ASCII, papéis singulares, parâmetros somente de instâncias, nenhuma composição aninhada ou remoção, ciclos de montagem rejeitados, símbolos históricos imutáveis, relações com pontas capturadas, sem reserva/detecção dinâmica de spawn, sem procedência automática de criações futuras. Os participantes de execução `actor`, `target`, `relation.source` e `relation.target` **não** passaram a interpretar referências de composição. Condições/operações que exigem personagens continuam rejeitando outras categorias, mesmo quando a relação permite uma composição.

Não foram adicionados testes de DOM/Phaser. Build/typecheck e regressão de lógica não confirmam layout, controles ou downloads reais. A validação manual anterior pendente dos cenários 02/03 e a conferência do filtro/JSON de composição no painel continuam necessárias.

## Pacotes, consultas e consumo público — 0.4.2

Esta seção descreve a estrutura atual; as seções anteriores preservam o histórico dos contratos. A 0.4.1 foi aprovada pelo usuário, incluindo validação manual dos três cenários. A validação visual desta migração 0.4.2 permanece separada das provas automatizadas.

### Pacote e fronteira

O repositório possui exatamente dois npm workspaces: `@origin-gates/narrative-engine` em `packages/narrative-engine` e `@origin-gates/game` em `packages/origin-gates`. O segundo declara dependência de versão `0.4.2` do primeiro; npm resolve o workspace correspondente. A engine não possui dependências de runtime. TypeScript, Vitest e tipos Node são ferramentas de desenvolvimento; Phaser e a configuração Vite pertencem ao jogo.

O único export suportado é `@origin-gates/narrative-engine`, definido explicitamente no `package.json`:

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  }
}
```

`tsc` compila `src` em ESM NodeNext com imports relativos `.js` e declarações TypeScript. Não há formato CommonJS paralelo ou alias de fontes. O build usa `lib: ES2022`, sem DOM. Espaço 2D, mapa, colisões, distância e transformações de composição continuam dentro da engine atual. Não foi criada uma extensão espacial/gráfica.

A superfície pública conserva registro/criação/execução/composições/resolução/papéis e acrescenta consultas narrativas. Exporta seus tipos de definição, configuração, handles, resultados, views e diagnósticos; `GameState`, fábricas internas, `executeEvent` e setters não são exports públicos. Referências relativas internas nas declarações geradas são resolvidas pelo compilador dentro do pacote, não constituem pontos de entrada adicionais para consumidores.

O estado de `NarrativeWorld` permanece em campo privado JavaScript. Os consumidores não recebem estado canônico mutável. Os exports do pacote bloqueiam deep imports por nome; testes arquiteturais também rejeitam o jogo atravessando diretórios, importando tipos privados ou usando aliases para acessar fontes/artefatos internos. Isso é uma fronteira de API, não um sandbox contra um processo malicioso que possua acesso arbitrário ao sistema de arquivos. As unidades internas do próprio pacote ainda podem acessar serviços privados.

Os caminhos históricos `src/game/*.ts`, `tests` e `examples` da engine correspondem agora a `packages/narrative-engine/src/*.ts`, `tests` e `examples`. Conteúdo/renderer/painel antigos estão em `packages/origin-gates/src`. O contrato acompanha a engine em `docs/ENGINE_CONTRACT.md`; a documentação raiz aponta para ele.

### Consultas narrativas públicas

`world.query` é uma interface congelada de leituras síncronas do estado **atual**, independente de `AuditLog`, do inspetor e de eventos históricos. Os resultados são views tipadas, clonadas e congeladas recursivamente; uma leitura antiga não muda após comandos posteriores. `undefined` continua sendo ausência normal de campo opcional, sem os marcadores usados na serialização diagnóstica. Não se devolvem catálogos, arrays internos ou referências vivas de definições.

| Consulta | Campos/filtros e ordem |
|---|---|
| `characters()` | Todos os personagens canônicos na ordem de criação, incluindo jogador e mortos. |
| `character(id)` | Um `CharacterView` ou `undefined` para ID inexistente. ID vazio/não string ou categoria existente incompatível são erros. Não resolve símbolos/IDs de definição como fallback. |
| `adjacent(actorId)` | Personagens vivos a Manhattan 1, na ordem de criação; usa a mesma primitiva de adjacência da engine. Ator inexistente ou categoria incompatível são erros. Pode retornar `[]`. |
| `factions()` | Facções com identidade, procedência opcional e nome, na ordem de criação. |
| `relations({ definitionId?, sourceId?, targetId?, participantId? }?)` | Conjunção dos filtros; `participantId` corresponde a uma das pontas. Inclui identidade, procedência, nome da definição, pontas concretas e intensidade. Ordem de criação; desconhecidos/sem correspondência retornam `[]`. Qualquer categoria permitida nas relações pode ser consultada. |
| `missions({ executorId?, contractorId?, pending? }?)` | Conjunção dos filtros, ordem de criação. `pending: true` inclui `active`/`ready`; `false`, concluídas. Reutiliza o predicado de pendência do sistema existente. IDs inexistentes não encontram resultados; executor/contratante existentes de categoria incorreta são erros. |

`CharacterView` contém identidade, procedência opcional, `kind`, `name`, `label?`, `color`, `maxHp`, `hp`, `alive`, posição, atributos, referências concretas, `factionId?` e `offer?`. A oferta é destacada e possui `opponentId` concreto e spawn global. O objeto `definition` e os índices de execução não são expostos. `FactionView`, `RelationView` e `MissionView` também são somente leitura, incluindo seus arrays/subobjetos quando presentes.

Consultas não geram auditoria, sorteios, fatos, comandos ou alterações; funcionam com coleta desligada. Os filtros são os campos explícitos acima, sem linguagem de consulta, ORM, expressão ou seleção arbitrária por propriedade. As buscas são lineares para o protótipo. O consumidor atualiza as views após ações relevantes; não há assinatura genérica de mudança de estado ou cache universal.

### Seleção de alvos e comandos

`interact({ actorId, targetId?, random? })` continua selecionando o evento por `when` e validando `conditions`. Quando `targetId` é fornecido, sua integridade é verificada e as condições continuam decidindo a validade da interação. Quando omitido, a API usa o primeiro personagem vivo adjacente na ordem de criação. Sem vizinho, retorna recusa `noApplicableEvent`, registra `reason: noAdjacentCharacter` e não sorteia nem emite fatos. Isso permite auditar a tentativa sem o renderer escrever manualmente registros internos. A apresentação decide a mensagem e os controles de reinício.

`command` continua exigindo `targetId` e evento explícitos. Não há fallback de evento para ataque. A seleção visual permanece no consumidor: direção aponta um vizinho; Espaço usa esse ID se ainda estiver entre os adjacentes, senão o primeiro. Nenhuma identidade de objeto de snapshot é utilizada para comparar alvos.

### Carregamento real dos cenários

O conceito de cenário pertence ao jogo, em `src/data/scenarios.json`. Cada cenário define jogador, missões habilitadas e pedidos de instanciação de composições. Exemplo real do treinamento:

```json
{
  "id": "training",
  "name": "01 — Campo de treinamento",
  "player": { "definitionId": "player", "position": { "x": 2, "y": 5 } },
  "missions": [],
  "compositions": [{
    "definitionId": "trainingCamp", "key": "training",
    "origin": { "x": 5, "y": 5 }
  }]
}
```

`src/data/compositions.json` registra `trainingCamp` (Guardião local 0,0), `rivalSettlement` (facções, representantes, ofertas e reputações) e `socialGroup` (vítima A–E e amizades direcionais). O grupo social usa origem 4,5; Lealdades Rivais usa 0,0. Coordenadas globais, HP, interações e regras anteriores foram preservados. As reputações da composição rival usam `{ parameter: 'player' }` com binding `root#player`. Cada cenário de produção contém agora uma instância canônica de composição; todos os membros iniciais recebem sua procedência.

O adaptador apenas organiza arquivos, chama `engine.registerDefinitions`, `engine.createWorld` e `world.instantiateComposition`. Não contém tabelas locais de símbolos ou resolução de facções/ofertas/relações. Composições mantêm a exigência 0.4.1 de ofertas explícitas locais. Os templates antigos dos objetos foram preservados; o runtime das ofertas desses representantes vem da composição. Remover essa duplicidade de conteúdo não fez parte desta versão.

### Renderer e painel

O renderer importa somente tipos públicos e o adaptador do jogo. Usa `world.move`, `interact`, `react({ cause })` e `world.query`. A atualização ocorre na criação, após movimentos e execuções, sem novas consultas a cada frame. Círculos, foco, labels, temporizadores e cache de snapshots são organizados por ID no consumidor. Vida, reputação, pendência, colisão, seleção de evento e reações permanecem governadas pela engine.

O painel importa tipos públicos `AuditCategory`, `AuditRecord`, `AuditValue`, `InstanceSnapshot`, `NarrativeWorld` e `InstanceHandle`. Usa `world.audit.records/stats/subscribe/clear`, `world.inspect.list/find` e `world.diagnostics()`. Consulta/filtro/árvore causal e nome de download permanecem no jogo; o prefixo `origin-gates` não pertence à engine. O schema diagnóstico 1 e os contratos anteriores de retenção/cópias/exportação foram preservados. `AuditLog` continua público para compatibilidade, mas o painel não precisa criar scopes, inserir registros ou acessar o estado canônico.

Diagnósticos e gameplay permanecem separados: o painel pode atualizar por assinaturas de auditoria, mas o renderer não reconstrói estado por registros. A cena conserva `{ enabled: import.meta.env.DEV }`; o painel só é importado/montado em desenvolvimento. A sobreposição visual conhecida de legendas à região JSON permanece sem reformulação.

### Consumo externo e comandos

O exemplo completo em `scripts/consumer/index.ts`, na raiz do repositório, importa o pacote pelo nome, registra personagens/evento/composição, cria mundo e acampamento, resolve o Guardião, executa uma interação e verifica HP 90 por consulta. Também verifica snapshots e exportação e contém uma asserção de tipo `@ts-expect-error` para escrita em `CharacterView`. Os exemplos que acompanham o pacote em `examples/` também importam o nome público.

`npm run test:consumer` executa `npm pack` local, verifica que `src`/`tests` não integram o tarball, instala o arquivo offline em diretório temporário fora do monorepositório, compila o exemplo com `NodeNext`, `lib: ES2022`, `types: []`, `skipLibCheck: false` e executa seu ESM em Node. O consumidor não precisa de Phaser, conteúdo do jogo, tipos Node, DOM ou fontes internas. O compilador é ferramenta do verificador, não dependência de runtime do pacote. A tentativa de deep import deve resultar em `ERR_PACKAGE_PATH_NOT_EXPORTED`. Não há publicação npm.

Na raiz: `npm install`, `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`. Build/test de cada workspace também estão nos respectivos `package.json` e no README raiz. `dev` constrói a engine uma vez e inicia `tsc --watch` + Vite; não há alias para fontes. O Vite consome o export compilado e exclui o pacote da pré-otimização para observar suas alterações. Scripts de orquestração usam Node e funcionam no ambiente Windows verificado.

### Correspondência dos testes, evidências e limites

Os 302 casos anteriores foram preservados. Unidades internas que usavam o antigo adaptador foram reparametrizadas com as fixtures literais TypeScript de prova já existentes; seu helper interno usa os serviços da engine, sem JSON, implementação ou dependência do jogo. Testes que carregam dados reais de produção ficam no jogo e não importam internos. A equivalência entre produção e fixture agora normaliza IDs de instâncias correspondentes, excluindo somente a composição/procedência adicionadas, e mantém as comparações de vínculos, estado e resultados. Não se exige igualdade artificial das sequências diagnósticas de montagens diferentes.

Distribuição verificada: engine 292 casos (282 anteriores + 10 de consultas), jogo 25 (20 anteriores adaptados + 5 de produção), fronteira raiz 10 novos; total 327. A prova do tarball é um comando adicional executável, fora dessa contagem Vitest.

As provas arquiteturais analisam AST de imports/reexports/calls/imports de tipos, resolvem os módulos com TypeScript e verificam destinos reais. Exercitam exemplos negativos de acesso relativo a `src`/`dist`, deep imports, `require`, import dinâmico, import de tipo e alias TypeScript. O consumidor atual não usa `paths` nem `resolve.alias` do Vite. O teste transitivo da engine foi mantido e cobre fontes, declarações e provas públicas, rejeitando conteúdo, Phaser e identificadores de APIs DOM. Esses testes são proporcionais ao projeto, não um verificador universal de código JavaScript malicioso.

A regressão real confirma composições e procedência na produção, combate/morte/feedback, missões simultâneas e repetidas, recompensas/reputações/recusas e reação social para acerto/esquiva. Consultas são verificadas por ordem, filtros, ausência/categorias, atualização de posição/HP/morte/relação/missão, isolamento, imutabilidade e auditoria ligada/desligada. A guarda de fronteira não se limita a buscar um texto específico.

Débitos tratados: consumo privilegiado do adaptador/renderer/painel foi removido; a separação física, exports e artefato empacotável tornam verificável a independência antes apenas conceitual. DT-17 permanece resolvido; DT-18 avança com consultas públicas e consumo externo real; DT-01 conserva fábricas oficiais integradas e DT-07 mantém as validações existentes. Esses avanços não resolvem integralmente ciclo de vida universal, validação semântica completa ou mutabilidade de módulos internos.

Permanecem: polling legado de missões, falhas parciais sem rollback, procedência limitada à montagem, deduplicação de fatos por objeto, retenção/entrega assíncrona de auditoria, ocupação dinâmica de spawn e limitação visual do painel. O pacote oferece somente ESM no ambiente verificado; não há publicação, CJS, sandbox, persistência, framework gráfico ou terceiro pacote espacial. O acesso direto a arquivos pelo próprio código de unidades internas continua possível, mas não é contrato público.

Build e verificações HTTP do servidor de desenvolvimento não são validação visual. A conferência final de controles, flashes, layouts, downloads e troca/reinício de cenários será feita no navegador pelo desenvolvedor. Nenhum teste DOM/Phaser novo foi introduzido.
