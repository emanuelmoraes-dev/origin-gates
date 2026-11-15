# Origin Gates — MVP 0.1

Protótipo em TypeScript, Vite e Phaser 3. Requer Node.js 22.12+.

```sh
npm install
npm run dev
```

Abra o endereço indicado pelo Vite. Use WASD ou setas para mover um tile por pressionamento; Espaço para atacar; R para reiniciar. Clique na área do jogo caso o teclado esteja focado em outra janela. Adjacência significa um tile na horizontal ou vertical, sem diagonais. O jogador começa três tiles à esquerda do NPC.

```sh
npm test
npm run typecheck
npm run build
```

## Onde editar

- `src/data/objects/player.json` e `enemy.json`: nomes, vida máxima e cores das definições originais.
- `src/data/events/attack.json`: condições, pesos dos resultados, operações de dano e feedback visual. Pesos iguais dão 50% para cada resultado. Cores usam hexadecimal e duração usa milissegundos.
- `src/game/state.ts`: mapa fixo de 10 × 10 em TypeScript (`L` terra; `W` água), criação do estado e regras de movimento.
- `src/game/events.ts`: interpretador sem imports de Phaser. Avalia condições, sorteia um resultado por peso, executa operações reutilizáveis e devolve resultado estruturado. A fonte aleatória é injetável para testes. Eventos com as mesmas operações podem ser adicionados em JSON, sem uma função específica por evento.
- `src/render/OriginScene.ts`: posições iniciais, desenho do mapa, entrada de teclado, painéis e flashes de 500 ms. A função de desenho recebe `WorldMap`; um gerador futuro pode fornecer essa mesma estrutura sem alterar o desenho.

O estado de cada entidade contém a vida atual e a posição, separados da definição carregada do JSON. A interface lê esse estado diretamente. Nenhum JSON é alterado durante a partida. NPC morto desaparece, deixa de bloquear movimento e não pode receber ataques. Ataques rápidos substituem o temporizador visual anterior, mantendo o último feedback por 500 ms.

Os testes executam a lógica diretamente, sem carregar Phaser ou navegador, cobrindo acerto, esquiva, limiar de probabilidade, dano, morte, condições de ataque, preservação dos JSONs e colisões.
