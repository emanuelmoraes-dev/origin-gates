import { createEngine, type DefinitionBatch, type WorldMap } from '@origin-gates/narrative-engine';

// Deliberately literal proof content: no JSON imports or content adapter.
const player = {
  "id": "player",
  "name": "Explorador",
  "maxHp": 100,
  "damage": 10,
  "color": "#f5d547"
};

const enemy = {
  "id": "enemy",
  "name": "Guardião",
  "maxHp": 100,
  "color": "#f39b38",
  "interactions": [{ "event": "attack" }]
};

const socialObjects = {
  "governmentRepresentative": {
    "id": "governmentRepresentative",
    "name": "Oficial",
    "maxHp": 100,
    "color": "#4499ee",
    "attackable": false,
    "interactions": [
      {
        "event": "accept",
        "context": {
          "offer": "target"
        }
      },
      {
        "event": "deliver",
        "context": {
          "offer": "target"
        }
      }
    ],
    "offer": {
      "mission": "eliminateTarget",
      "name": "Eliminar alvo rebelde",
      "target": "resistanceTarget",
      "opponent": "resistance",
      "spawn": {
        "x": 8,
        "y": 3
      }
    }
  },
  "resistanceRepresentative": {
    "id": "resistanceRepresentative",
    "name": "Rebelde",
    "maxHp": 100,
    "color": "#b47bea",
    "attackable": false,
    "interactions": [
      {
        "event": "accept",
        "context": {
          "offer": "target"
        }
      },
      {
        "event": "deliver",
        "context": {
          "offer": "target"
        }
      }
    ],
    "offer": {
      "mission": "eliminateTarget",
      "name": "Eliminar alvo governista",
      "target": "governmentTarget",
      "opponent": "government",
      "spawn": {
        "x": 8,
        "y": 8
      }
    }
  },
  "resistanceTarget": {
    "id": "resistanceTarget",
    "name": "Alvo rebelde",
    "maxHp": 100,
    "color": "#ce80bc",
    "attackable": true,
    "interactions": [
      {
        "event": "attack"
      }
    ]
  },
  "governmentTarget": {
    "id": "governmentTarget",
    "name": "Alvo governo",
    "maxHp": 100,
    "color": "#69b8d4",
    "attackable": true,
    "interactions": [
      {
        "event": "attack"
      }
    ]
  }
};

const reactivityObjects = {
  "victim": { "id": "victim", "name": "Vítima", "maxHp": 100, "color": "#f39b38", "interactions": [{ "event": "attack" }] },
  "observer": { "id": "observer", "name": "Observador", "maxHp": 100, "color": "#b7c7cd", "attackable": false, "interactions": [] }
};

const relations = {
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
};

const reactions = {
  "respondToAggression": {
    "id": "respondToAggression",
    "on": "attackAttempted",
    "when": [
      { "type": "sameInstance", "left": "relation.target", "right": "target" },
      { "type": "alive", "entity": "relation.source" },
      { "type": "compare", "left": { "source": "relationIntensity" }, "operator": "gte", "right": 70 },
      { "type": "compare", "left": { "source": "distance", "from": "relation.source", "to": "target" }, "operator": "lte", "right": 3 }
    ],
    "operations": [
      { "type": "setReference", "entity": "relation.source", "key": "hostileTo", "value": "actor" }
    ]
  }
};

const missions = [
  {
    "id": "eliminateTarget",
    "name": "Eliminar alvo",
    "initialStatus": "active",
    "reactions": [
      "targetDefeated"
    ]
  }
];

const factions = [
  { "id": "government", "name": "Governo" },
  { "id": "resistance", "name": "Resistência" }
];

const attack = {
  "id": "attack",
  "emits": [{ "type": "attackAttempted" }],
  "conditions": ["actorAlive", "targetAlive", "adjacent", "targetAttackable"],
  "outcomes": [
    {
      "id": "hit",
      "weight": 1,
      "operations": [{ "type": "damage", "amount": { "source": "attribute", "key": "damage" } }],
      "feedback": { "color": "#ef5350", "durationMs": 500, "message": "Acerto!" }
    },
    {
      "id": "dodge",
      "weight": 1,
      "operations": [],
      "feedback": { "color": "#ffffff", "durationMs": 500, "message": "Esquiva! O guardião evitou o ataque." }
    }
  ]
};

const socialEvents = {
  "accept": {
    "id": "accept",
    "when": [
      {
        "type": "missionStatus",
        "statuses": [
          "available"
        ]
      }
    ],
    "conditions": [
      "actorAlive",
      "targetAlive",
      "adjacent",
      {
        "type": "noActiveMission",
        "message": "Entregue a missão pendente deste representante antes de aceitar outra."
      },
      {
        "type": "compare",
        "left": {
          "source": "relation",
          "faction": "faction"
        },
        "operator": "gte",
        "right": 20,
        "message": "Missão recusada: relação com a facção abaixo de 20."
      }
    ],
    "outcomes": [
      {
        "id": "accepted",
        "weight": 1,
        "operations": [
          {
            "type": "spawnTarget"
          },
          {
            "type": "missionStatus",
            "status": "active"
          }
        ],
        "feedback": {
          "color": "#ffffff",
          "durationMs": 0,
          "message": "Missão aceita! Encontre o alvo indicado no mapa."
        }
      }
    ]
  },
  "deliver": {
    "id": "deliver",
    "when": [
      {
        "type": "missionStatus",
        "statuses": [
          "active",
          "ready"
        ]
      }
    ],
    "conditions": [
      "actorAlive",
      "targetAlive",
      "adjacent",
      {
        "type": "missionStatus",
        "statuses": [
          "ready"
        ],
        "message": "O alvo ainda está vivo. Elimine-o antes de voltar."
      }
    ],
    "outcomes": [
      {
        "id": "completed",
        "weight": 1,
        "operations": [
          {
            "type": "relation",
            "faction": "faction",
            "amount": 20
          },
          {
            "type": "relation",
            "faction": "opponent",
            "amount": -15
          },
          {
            "type": "attributeReward",
            "key": "damage",
            "value": {
              "source": "relation",
              "faction": "faction"
            },
            "bands": [
              {
                "min": 0,
                "max": 29,
                "amount": 1
              },
              {
                "min": 30,
                "max": 59,
                "amount": 3
              },
              {
                "min": 60,
                "max": 79,
                "amount": 5
              },
              {
                "min": 80,
                "max": 100,
                "amount": 10
              }
            ],
            "max": 50
          },
          {
            "type": "missionStatus",
            "status": "completed"
          }
        ],
        "feedback": {
          "color": "#ffffff",
          "durationMs": 0,
          "message": "Missão entregue! Relações e dano atualizados. Você pode aceitar outra missão."
        }
      }
    ]
  },
  "targetDefeated": {
    "id": "targetDefeated",
    "when": [
      {
        "type": "missionStatus",
        "statuses": [
          "active"
        ]
      }
    ],
    "conditions": [
      {
        "type": "compare",
        "left": {
          "source": "missionTargetHp"
        },
        "operator": "lte",
        "right": 0
      }
    ],
    "outcomes": [
      {
        "id": "ready",
        "weight": 1,
        "operations": [
          {
            "type": "missionStatus",
            "status": "ready"
          }
        ],
        "feedback": {
          "color": "#ffffff",
          "durationMs": 0,
          "message": "Alvo eliminado! Volte ao representante para entregar a missão."
        }
      }
    ]
  }
};

export const literalDefinitions = {
  characters: [player, enemy, ...Object.values(socialObjects), ...Object.values(reactivityObjects)],
  factions, relations: Object.values(relations), reactions: Object.values(reactions),
  missions, events: [attack, ...Object.values(socialEvents)],
} as DefinitionBatch;
export const suppliedMap: WorldMap = [
  'LLLLLLWWLL', 'LLLLLLWWLL', 'LLLLLLWLLL', 'LLWWLLLLLL', 'LLWWLLLLLL',
  'LLLLLLLLLL', 'LLLLLLWWLL', 'LWLLLLWWLL', 'LWWLLLLLLL', 'LLLLLLLLLL',
].map(row => [...row].map(tile => tile === 'L' ? 'land' : 'water'));

export function programmaticWorld(scenarioId: 'training' | 'rivals' | 'social', audit = true) {
  const engine = createEngine();
  engine.registerDefinitions(literalDefinitions);
  const world = engine.createWorld({ scenarioId, map: suppliedMap, player: { definitionId: 'player', position: { x: scenarioId === 'social' ? 3 : 2, y: 5 } }, missions: scenarioId === 'rivals' ? ['eliminateTarget'] : [], audit: { enabled: audit, capacity: 10000 } });
  populateTestWorld(world, scenarioId);
  return world;
}

export function populateTestWorld(world: Pick<import('@origin-gates/narrative-engine').NarrativeWorld, 'createCharacter' | 'createFaction' | 'createRelation' | 'player'>, scenarioId: string) {
  if (scenarioId === 'training') world.createCharacter({ definitionId: 'enemy', position: { x: 5, y: 5 } });
  if (scenarioId === 'rivals') {
    const government = world.createFaction('government');
    const resistance = world.createFaction('resistance');
    world.createCharacter({ definitionId: 'governmentRepresentative', position: { x: 3, y: 2 }, factionId: government.id,
      offer: { mission: 'eliminateTarget', name: 'Eliminar alvo rebelde', target: 'resistanceTarget', spawn: { x: 8, y: 3 }, opponentId: resistance.id } });
    world.createCharacter({ definitionId: 'resistanceRepresentative', position: { x: 5, y: 2 }, factionId: resistance.id,
      offer: { mission: 'eliminateTarget', name: 'Eliminar alvo governista', target: 'governmentTarget', spawn: { x: 8, y: 8 }, opponentId: government.id } });
    for (const faction of [government, resistance]) world.createRelation({ definitionId: 'reputation', sourceId: faction.id, targetId: world.player.id, intensity: 50 });
  }
  if (scenarioId === 'social') {
    const victim = world.createCharacter({ definitionId: 'victim', label: 'Vítima', position: { x: 4, y: 5 } });
    const a = world.createCharacter({ definitionId: 'observer', label: 'A', position: { x: 4, y: 4 } });
    const b = world.createCharacter({ definitionId: 'observer', label: 'B', position: { x: 5, y: 5 } });
    world.createCharacter({ definitionId: 'observer', label: 'C', position: { x: 3, y: 6 } });
    const d = world.createCharacter({ definitionId: 'observer', label: 'D', position: { x: 0, y: 0 } });
    const e = world.createCharacter({ definitionId: 'observer', label: 'E', position: { x: 4, y: 7 } });
    for (const [source, target, intensity] of [[a, victim, 90], [b, victim, 20], [d, victim, 90], [victim, e, 90]] as const) world.createRelation({ definitionId: 'friendship', sourceId: source.id, targetId: target.id, intensity });
  }
}
