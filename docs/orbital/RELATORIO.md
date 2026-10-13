# Visão orbital: grupos e tarefas visíveis sem entrar em cada grupo

Escopo: apenas a apresentação de grupos/tarefas ao redor dos planetas e a interação de hover/clique que leva a ela.
CRUD, persistência, backup, busca, painéis, laboratório e a navegação da fase 2 não foram alterados.

## O que mudou

| Momento | Antes | Agora |
|---|---|---|
| Universo, cursor sobre um planeta | cartão HTML com texto | brilho suave + resumo **na cena**: um anel fino por grupo (cor do grupo), o grupo como ponto mais claro e suas tarefas abertas mais importantes como pontos no mesmo anel; nomes de grupos e de 2 tarefas por grupo como rótulos ancorados. Câmera e nível intactos; ao sair o resumo some aos poucos |
| Universo, longe | só planetas | planetas + indicadores (anel de progresso, urgência, contagem). O resumo discreto só existe nos 2 planetas mais próximos e some quando há muitos |
| Clique no planeta | viagem cinematográfica; luas sem tarefas (era preciso clicar em cada uma) | mesma viagem; ao chegar, **todos os grupos já mostram as tarefas como satélites** em órbitas compactas ao redor da própria lua |
| Nome das tarefas | só dentro do grupo | os mais importantes que cabem, ao lado do satélite (leque radial a partir da lua) |
| Tarefa | exigia abrir o grupo | clicar no nome/satélite abre os detalhes direto; editar/concluir inalterados |
| Clique numa lua | foca o grupo | igual (órbitas abrem nas faixas de prioridade) |

Removido: os cartões HTML `orbit-preview` / `orbit-task-chip` (commit `c50805d`, revertido em `d684c81`) e o cartão de hover de
planeta/lua. Mantido: o cartão pequeno de hover de **tarefa** (status, prioridade, prazo).

## Como funciona

- `domain/overview.ts` (puro, testado): ordem de importância (atrasada/iminente → crítica → em andamento → prioridade → prazo;
  concluídas por último), limite de satélites por grupo (`satelliteCap`: orçamento 32/64/110 por perfil gráfico ÷ nº de grupos,
  entre 4 e 14), alcance de cada grupo (`groupReach`) usado para alargar as órbitas das luas (`layoutGroups(…, reach)`), orçamento
  de nomes (`labelBudget`), conteúdo e nível do resumo (`haloContent`, `haloTarget`).
- `Satellites.tsx`: cada grupo tem um `SatelliteSystem` que alterna entre o modo compacto (órbitas em escala reduzida, satélites
  menores) e o modo foco (faixas completas) por um único valor contínuo, `focus`, sem recriar nada. O que não cabe vira "+N" no
  rótulo do grupo e uma pequena nuvem de satélites menores (`MiniSats`).
- `PlanetHalo.tsx` + `Universe.tsx` (`HaloDirector`): resumo em cena (um `Points` + um anel por grupo; no máximo 4 planetas, 2
  no perfil mínimo). `uiStore.haloPlanets` / `haloLabelPlanets` dizem ao HUD quais rótulos escrever.
- `WorldLabels.tsx`: rótulos continuam HTML ancorados (posição escrita por quadro, sem re-render), agora com `+N`, contagem
  no planeta, cor do grupo na borda, escolha gulosa por importância dentre os que cabem, leque radial a partir da lua, e passar o
  cursor numa lua passa a escrever os nomes dela. Colisões são removidas por prioridade a cada quadro.
- `CameraRig.tsx`: o enquadramento e os limiares de entrada/saída por proximidade usam o mesmo alcance das órbitas.

## Verificação (Chromium + WebGL por software, `npm run e2e:orbital`)

| # | Cenário | Resultado |
|---|---|---|
| 1 | poucos planetas/tarefas | 4 planetas legíveis, 0 sobreposições, 0 elementos legados |
| 3 | hover sem clique | nada abre, câmera inalterada, sem cartão; resumo 1,00 → 0,72 em 6 quadros → 0,45; rótulos do resumo somem |
| 4 | um clique | 3/3 luas, 10/10 tarefas como satélites, 10/10 mais próximos da própria lua, 7 nomes de tarefas + 3 de grupos, 0 colisões |
| 5 | abrir tarefa direto | abre o painel pela etiqueta, sem passar pelo grupo; concluir/reabrir funciona |
| 6 | selecionar grupo | foca o grupo, faixas com rótulo, `Esc` volta ao planeta |
| 2 | 16 planetas | no máx. 4 resumos, 0 colisões, 40 rótulos no DOM |
| 7 | 130 tarefas / 5 grupos | 60 satélites individuais (limite), 60/60 associados à lua certa, 9 nomes, "+N" nos 5 grupos, 0 colisões |
| 8 | 1280×720 · 1920×1080 · 2560×1440 | 9 · 12 · 12 nomes de tarefas, fonte mínima 11 px, 0 colisões |
| 8c | hover numa lua em 1280×720 | os nomes dos vizinhos recuam; só **2** nomes do grupo cabem sem sobrepor |
| 8b | zoom | afastar reduz os nomes (9 → 0), aproximar devolve |
| 9 | CRUD e persistência | `npm run e2e`: 18/18 (criar, editar, concluir, mover, excluir/desfazer, busca, reorganizar, recarregar, backup) |
| 10 | fase 2 | `npm run e2e:nav`: 13/13 |

Capturas nesta pasta: `1-` a `10-`.

## Limitações honestas

- Em um grupo com ~12 satélites o espaço em tela só comporta 2–3 nomes por vez (hover na lua, 1280×720). Os demais continuam
  como satélites visíveis e entram ao aproximar a câmera ou focar o grupo (os "+N" e a nuvem de satélites menores sinalizam o resto).
- Com 130 tarefas, 11 das 33 críticas não são desenhadas como satélite individual no planeta (o limite por grupo vale); elas
  aparecem no "+N" e entram no foco do grupo. Só atrasadas/iminentes e críticas vêm antes das demais.
- Testado apenas com WebGL por software (SwiftShader); não há medida de FPS em GPU real. A contagem de elementos de rótulo no
  DOM é limitada por regra (≤ 40 com 16 planetas; ≤ satélites exibidos + 20 em um planeta), não por medição de desempenho.
- O brilho de hover do planeta é intencionalmente sutil; o destaque principal é o resumo em cena.
