# Contrato da engine — 0.2.1

## Participantes e seleção

`OriginScene` escolhe uma instância viva e adjacente: a entidade apontada pelo teclado tem preferência; caso contrário, usa a primeira na ordem de `world.entities`. Espaço chama `interact(world, target)`. Esse comportamento visual não mudou.

O ator é sempre `world.player`; o alvo é exatamente a instância recebida, não a definição JSON, nem o alvo de uma missão inferido. `selectInteraction` lê `target.interactions`, se definido; caso contrário, lê `target.definition.interactions`. A lista da instância **substitui** a da definição, inclusive se for `[]`. Lista ausente equivale a `[]`.

Cada associação referencia um evento do registro por chave. Percorre-se a lista na ordem declarada, da primeira para a última. O primeiro evento cujo `when` seja satisfeito é escolhido. A ordem das chaves do registro, o identificador e os pesos dos resultados não determinam prioridade. A seleção não sorteia resultados nem modifica estado.

`interact` executa somente o evento selecionado. Se não existir um aplicável, retorna `{ executed: false, reason: 'noApplicableEvent', message: 'Nenhuma interação disponível.' }`, sem sorteio, operações ou ataque implícito. Referência de evento ou missão inexistente é erro de configuração e lança exceção; não é ausência de evento aplicável.

## Associação JSON e contexto

Em uma definição de objeto (`src/data/objects/*.json`):

```json
{
  "id": "governmentRepresentative",
  "name": "Oficial",
  "maxHp": 100,
  "color": "#4499ee",
  "attackable": false,
  "interactions": [
    { "event": "accept", "context": { "mission": "governmentMission" } },
    { "event": "deliver", "context": { "mission": "governmentMission" } }
  ]
}
```

Para combate, basta `"interactions": [{ "event": "attack" }]`. O ataque agora é uma associação explícita do guardião e dos dois tipos de alvo. `attackable` continua sendo validação de ataque, não uma regra de seleção.

Uma entrada de `entities` em `scenarios.json` pode fornecer `interactions` no mesmo formato, junto a `object` e `position`. `createWorld` passa essa substituição para `createEntity`. Instâncias criadas por `spawnTarget` herdam as associações de sua definição. Definições e listas não são modificadas durante a execução.

`event` é a chave no registro `events`. `context.mission` é um ID explícito de definição de missão presente na partida. O adaptador `resolveContext` resolve esse ID e constrói `{ world, mission }`, preservando as referências ao estado e à definição. Sem `context`, a execução recebe `undefined`, suficiente para os eventos atuais de combate e para regras sem missão. Não existe busca da missão por papel, facção ou identidade do representante durante a interação.

O campo `interactions` foi removido de `missions.json`: a associação pertence ao objeto ou à instância que oferece a interação. As missões continuam declarando representante, alvo, facções e posição de criação para os mecanismos já existentes.

## `when` e `conditions`

- `when` seleciona aplicabilidade. Todas as entradas devem ser verdadeiras; ausente ou vazio significa aplicável. Falso faz o seletor tentar a próxima associação, sem mensagem de recusa.
- `conditions` valida a execução **depois da seleção**. Todas devem ser satisfeitas, em ordem. A primeira falha retorna `executed: false`, o motivo e a mensagem configurada, quando houver. Não se tenta outro evento: uma recusa nunca se transforma em ataque.
- `executeEvent` também revalida `when` para proteger chamadas diretas. Somente após todas as verificações ele sorteia um `outcome` por `weight` e aplica suas `operations` sequencialmente. `feedback` retorna mensagem, cor e duração para a apresentação.

Exemplo existente: `accept.when` aceita estados `available`/`completed`; `accept.conditions` exige adjacência, ausência de missão pendente e relação suficiente. Relação baixa seleciona `accept`, mas devolve a recusa sem criar alvo. Nos estados `active`/`ready`, seleciona-se `deliver`; alvo vivo produz a mensagem de validação existente.

## Limites deliberados

Generalizou-se a associação e a escolha; não os conceitos de toda a engine. O contexto ainda possui um adaptador específico de missão, e não um resolvedor arbitrário de variáveis. `missionStatus`, `noActiveMission`, `missionTargetHp`, `spawnTarget`, faixas de recompensa e referências `faction`/`opponent` continuam especializados. Não há novos tipos de operação.

`react` continua percorrendo missões e resolvendo seu representante, usando os IDs de reação do cenário. A UI ainda conhece HP, dano, relações e missões. O ator continua sendo o jogador e há um único alvo explícito; participantes arbitrários não foram introduzidos. O registro de eventos e a importação dos JSONs continuam estáticos; não há validador completo de schema nem transação com rollback para JSON inválido. Para dados válidos, falhas de condições acontecem antes de qualquer operação.
