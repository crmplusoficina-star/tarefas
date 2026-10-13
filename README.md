# ÓRBITA — um universo interativo de produtividade

Não é um gerenciador de tarefas com tema espacial: **organizar tarefas é a mecânica do universo**.

| Nível | O que é | Como aparece |
|---|---|---|
| **Universo** | o seu sistema inteiro (renomeável) | estrela central, órbitas, nebulosa, estrelas em 3 camadas |
| **Planeta** | uma categoria **criada por você** (sem lista fixa, sem limite) | planeta procedural com superfície, atmosfera e anel de progresso |
| **Grupo orbital** | subdivisão do planeta (também livre) | lua, estação espacial ou asteroide em órbita |
| **Tarefa** | uma atividade | satélite; quanto mais urgente, mais perto do centro |

Nomes como *SEP*, *Viagens* ou *Clientes* são apenas exemplos — o app nasce **vazio**.

## Rodando

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # produção em dist/
npm run lint && npm run typecheck && npm test
npm run e2e        # teste ponta a ponta no Chromium (com `npm run dev` ativo)
```

Requer Node 20+ e um navegador moderno com WebGL (há um modo de contingência sem WebGL).

## O que dá para fazer

- **Laboratório de formação planetária** (`N`): nome, descrição, símbolo, tipo de superfície
  (rochoso, gasoso, oceânico, tecnológico ou *personalizado* com mistura livre), paletas e cores, relevo,
  turbulência, tamanho, atmosfera (névoa, halo, aurora, tempestade, nuvens), e **posição** em um mapa de
  órbitas. A pré-visualização é o planeta real, renderizado ao vivo; ao confirmar ele se condensa no universo.
- **Entrar no planeta**: a câmera viaja, o resto do universo some e os grupos surgem em órbita.
  Grupos podem ser criados, renomeados, recoloridos, reordenados (mais para dentro/fora) e excluídos.
- **Tarefas como satélites**: prioridade define a faixa orbital, subtarefas viram um anel de progresso,
  prazo vira um sinal luminoso (amarelo → laranja → vermelho pulsante), tarefas concluídas migram para a faixa
  de arquivo com uma animação de conclusão, e tarefas relacionadas são ligadas por feixes de luz.
- **Cada tarefa**: título, descrição, prazo e horário, prioridade, status, subtarefas, observações,
  data de conclusão (automática e editável), conexões, e mover entre grupos **e planetas**.
- **Indicadores no próprio universo**: anel de progresso do planeta/lua, sinal de urgência, estação quando um
  grupo tem muitas tarefas em andamento, radar de localização e *breadcrumb*.
- **Navegação**: arrastar para girar, botão direito/Shift para mover, roda para zoom, clique para entrar,
  busca global (`Ctrl K`), dock de planetas (`1`–`9`, `[` `]`), centralizar câmera (`C`), radar clicável.
- **Reorganizar** (`R`): arraste planetas entre as órbitas; o universo encaixa na vaga livre mais próxima.
- **Personalização**: renomear o universo, efeitos gráficos (automático/mínimo/equilibrado/cinematográfico),
  movimento (sistema/reduzido/completo), velocidade das órbitas, rótulos e trilhas.
- **Segurança dos dados**: confirmação de exclusão + **desfazer** (`Ctrl Z`), exportar/importar backup JSON,
  reparo automático de registros corrompidos, aviso quando o armazenamento local não está disponível.

Atalhos: `?` abre a lista completa dentro do app.

## Persistência

Tudo é salvo em **IndexedDB** (`orbita`: `planets`, `groups`, `tasks`, `meta`) e sobrevive ao recarregar.
A camada de dados fica atrás de uma interface (`src/data/adapter.ts`); hoje há `IndexedDbAdapter` e
`MemoryAdapter` (testes / armazenamento bloqueado). Para integrar um backend, implemente
`StorageAdapter` (`loadAll`, `apply(ops)`, `clear`) — o app já emite apenas diferenças (`put`/`delete`
por registro), em lotes, e descarrega pendências ao ocultar a página.

## Arquitetura

```
src/
  domain/   tipos, layout orbital, urgência/prazos, estatísticas, busca, sanitização  (puro, testado)
  data/     adaptadores de armazenamento, persistência por diff, backup
  state/    stores, transições puras (model.ts), comandos de produto (commands.ts), exemplo
  scene/    React Three Fiber: câmera, planetas, luas, satélites, shaders GLSL, efeitos
  ui/       HUD, laboratório, painel de tarefa, busca, configurações, lista acessível
  hooks/    atalhos de teclado
e2e/        teste ponta a ponta (Playwright)
```

Separação deliberada: **renderização espacial** (`scene/`), **lógica de interação** (`state/commands.ts`,
`hooks/`) e **gerenciamento de dados** (`domain/`, `data/`, `state/model.ts`). Estado de alta frequência
(posições, relógios orbitais, câmera) vive em `scene/runtime.ts`, nunca no estado do React.

### Sem sobreposição, sem limite

Planetas ocupam **órbitas discretas** (*lanes*). Planetas da mesma órbita compartilham a velocidade angular,
então um espaçamento válido permanece válido para sempre. Cada órbita tem capacidade proporcional ao seu
perímetro; quando enche, o próximo planeta vai para a órbita seguinte. O mesmo vale ao arrastar
(`resolvePlacement`). A câmera reenquadra conforme o universo cresce, e rótulos sobrepostos são ocultados
por prioridade. Testado com 49 planetas criados pela interface (5 órbitas, 49 vagas únicas).

### Desempenho

Perfis de qualidade (`scene/quality.ts`): resolução, estrelas, nebulosa, camadas atmosféricas, relevo e
detalhe dos satélites. No modo **Automático**, o app mede a taxa de quadros e reduz os efeitos sozinho
(avisando o usuário). Sem WebGL, a interface inteira continua utilizável pelo **mapa em lista**.

### Acessibilidade

Objetos do mapa são botões reais (`Tab` percorre, `Enter` entra), `Esc` sobe um nível, anúncios por região
`aria-live`, diálogos com foco preso, rótulos ARIA e `prefers-reduced-motion` (congela órbitas, pulsos e
viagens de câmera; também configurável).

## Testes

- `npm test` — 48 testes (layout sem sobreposição, urgência, transições do modelo, persistência em IndexedDB
  simulado, backup e reparo, busca, comandos de produto com desfazer/reconciliação).
- `npm run e2e` — percorre os critérios de sucesso no navegador real e confere o conteúdo gravado no IndexedDB
  (criar planeta → grupos → tarefas → editar/concluir → mover → excluir/desfazer → busca → reorganizar →
  recarregar → exportar/apagar/importar). Usa WebGL por software, então roda sem GPU.

## Limitações conhecidas / próximos passos

- Desktop-first: não há gestos de toque (pinça) nem layout otimizado para celular.
- Os dados ficam no navegador; sincronização multi-dispositivo exige implementar um `StorageAdapter` remoto
  (a interface e o formato de operações já existem).
- Sem notificações de prazo e sem tarefas recorrentes.
- Pós-processamento (bloom real) não foi adotado para evitar dependências; os brilhos são sprites/cascas aditivas.
