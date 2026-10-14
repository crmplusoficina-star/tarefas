# Ajustes: órbitas no universo, controle de densidade e anexos locais

Escopo: somente os três pontos pedidos. Navegação da fase 2, visão orbital (grupos + tarefas ao clicar), CRUD, busca, laboratório
e backup continuam como estavam (ver verificações abaixo).

## 1. Órbitas e luas visíveis no universo

- Cada planeta mostra, **sem clicar**, as órbitas e luas dos próprios grupos, animadas, reaproveitando os mesmos componentes
  (`MoonNode`, `MoonLane`, anel de progresso, sinal de urgência). Nada de elemento novo: é o sistema orbital existente numa escala
  compacta (raio da órbita `1,45·R + 0,7 + 0,55·pista`, luas a 45 %), que **se abre até a escala normal** quando a câmera se aproxima
  (zoom por proximidade) ou o planeta é aberto por clique. Fechar faz o caminho inverso.
- Clicar no planeta mantém a viagem e a aproximação; as luas não recebem cliques no universo (o clique vai para o planeta).
- Ao passar o cursor, o resumo de tarefas deixou de desenhar anéis próprios: os pontos de tarefa viajam **sobre a órbita da lua**
  correspondente e os nomes dos grupos ficam ancorados nas luas reais. O brilho suave do planeta foi mantido.

## 2. Responsividade e densidade (`domain/overview.ts`, regras puras e testadas)

| Entrada | Regra |
|---|---|
| Zoom / distância | nível de detalhe `0..1` pelo raio aparente do planeta em pixels: `smoothstep((px − 9)/17)`; planeta apontado ou em foco de zoom tem no mínimo 0,7 |
| Tamanho da janela | orçamento × 0,6 abaixo de 900 px, × 1,3 a partir de 1700 px |
| Perfil gráfico (inclui o automático por FPS) | planetas com órbitas ao mesmo tempo: 3 / 6 / 10; luas por planeta: 3 / 5 / 8 (mínimo/equilibrado/cinematográfico) |
| Quem ganha espaço | primeiro o planeta apontado, depois os maiores na tela; entre as luas, as de grupos com trabalho urgente e mais tarefas abertas (`rankGroups`) |
| Detalhe progressivo | cada lua tem peso `clamp(lod·máx + 0,5 − posição)`: ao afastar saem primeiro as menos importantes, depois as órbitas, depois tudo; ao aproximar volta na ordem inversa |

Só o **desenho** é limitado: dados, busca, lista acessível e dock continuam completos. Ao selecionar um planeta todas as luas e
todas as tarefas são montadas (testado com 14 grupos × 4 tarefas). Luas e satélites extras só são montados para o planeta aberto
ou em aproximação, e saem depois que as órbitas se fecham (sem “pulo”).

### Medido (Chromium, WebGL por software; 24 planetas × 6 grupos × 5 tarefas = 144 grupos, 720 tarefas)

| Janela | planetas com órbitas | luas desenhadas | rótulos | rótulos sobrepostos |
|---|---|---|---|---|
| 800 × 600 | 4 | 12 | 21 | 0 |
| 1280 × 720 | 6 | 30 | 23 | 0 |
| 1920 × 1080 | 8 | 48 | 24 | 0 |
| 2560 × 1440 | 8 | 48 | 24 | 0 |

Poucos elementos (3 planetas × 3 grupos): os 3 planetas e as 9 luas aparecem. Zoom (12 planetas): luas visíveis 25 → 23 → 10
ao afastar em dois passos, e 24 ao voltar.

## 3. Anexos locais nas tarefas

- **Armazenamento**: loja `files` no IndexedDB (esquema v2, migração automática do v1 testada). Os bytes ficam **separados** dos
  registros de tarefa (que só guardam nome, tipo, tamanho e data), então listar/atualizar tarefas continua leve. Sem servidor, API
  ou serviço externo.
- **Interface** (painel da tarefa): lista com tipo, nome, tamanho e data; anexar por botão ou arrastando arquivos; **visualizar**
  (imagem e PDF abrem em janela dentro do app, SVG só via `<img>`), **baixar** (qualquer tipo, mesmos bytes) e **excluir** (com
  confirmação e “Desfazer”). Tarefa nova mostra uma dica: anexos só depois de lançar a tarefa.
- **Limites**: 25 MB por arquivo, 30 por tarefa, arquivo vazio recusado; erros viram aviso (inclusive armazenamento cheio).
- **Backup**: o JSON passa a ter `files` (bytes em base64) e `schema: 2`; só entram arquivos que alguma tarefa referencia. Na
  restauração os bytes são gravados **antes** de a tela passar a apontar para eles; anexos sem arquivo no backup são descartados
  da tarefa e contados no aviso. Backups antigos (schema 1) abrem normalmente.
- **Limpeza**: arquivos de tarefas/grupos/planetas excluídos são removidos sozinhos, mas só quando nem os dados atuais nem o
  histórico de desfazer os alcançam (desfazer uma exclusão nunca encontra o anexo sumido). Um arquivo recém-gravado fica protegido
  até a tarefa ser salva.

## Verificação

| O quê | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` · `npm run build` | limpos |
| `npm test` | 97 testes (novos: regras de densidade/universo, anexos no domínio, sanitização, IndexedDB com arquivos, upgrade v1→v2, backup com/sem arquivos, bytes grandes, comandos de anexar/excluir/desfazer/backup) |
| `npm run e2e:ajustes` (novo) | órbitas e luas animadas sem clicar; clique abre todos os grupos e tarefas; poucos/muitos elementos em 800–2560 px; zoom; planeta com 14 grupos; anexar/visualizar/baixar/recarregar/backup+restauração/excluir+desfazer |
| `npm run e2e:orbital` | 13/13 (visão orbital da entrega anterior) |
| `npm run e2e:nav` | 13/13 (fase 2) |
| `npm run e2e` | 18/18 (CRUD e persistência) |

Capturas nesta pasta (`1-` a `12-`). Um defeito encontrado e corrigido durante a validação: a janela de visualização do anexo ficava
presa dentro do painel lateral (o filtro de fundo do painel confina elementos fixos); agora é renderizada no `body` e o teste confere
a posição.

## Limitações honestas

- Testado só com WebGL por software (SwiftShader); sem medição de FPS em GPU real.
- Baixar/visualizar usam o arquivo inteiro em memória (limite de 25 MB por arquivo); backups com muitos anexos grandes geram um
  JSON grande (base64 ≈ +33 %). A cota do navegador não é consultada previamente: se estourar, o aviso aparece ao anexar.
- Visualização embutida só para imagem e PDF (depende do leitor de PDF do navegador); planilhas e documentos são download.
- Anexos não passam pela busca global e não são copiados ao mover tarefas entre grupos (acompanham a tarefa, sem duplicar).
- Em telas muito pequenas (800 px) ficam 4 planetas com órbitas ao mesmo tempo; os demais continuam como planetas.
