# Fase 2 — navegação espacial avançada

Escopo: exploração 3D e refinamento visual pontual. CRUD, persistência, backup, busca, painéis, qualidade
automática, acessibilidade e publicação **não** foram alterados.

## 1. Zoom ao cursor
`CameraRig.tsx` passou a tratar a roda assim:

1. O alvo sob o cursor vem dos **mesmos meshes de hit** que já faziam hover/clique (`pick.ts` só os registra;
   não há segundo sistema de picking). Meshes escondidos não respondem.
2. **Objeto** (planeta, lua, satélite): o alvo da câmera é misturado com a posição *viva* do objeto com peso `w`;
   cada passo faz `(1 − w) ← (1 − w)·f`. Converge geometricamente e desfaz de forma simétrica ao afastar. Como segue
   a posição viva, funciona com o planeta em órbita.
3. **Vazio**: o ponto do plano sob o cursor é calculado com a pose *de destino* da câmera e mantido fixo
   (`pan += (P − T)(1 − f)`); eventos rápidos ficam consistentes e não há saltos.
4. **Estabilidade do ponto de interesse**: o alvo anterior continua valendo por 0,9 s enquanto o raio do cursor
   passar a menos de 3 raios dele.
5. Girar, deslocar, teclado e centralizar "assam" o foco em um deslocamento, então o alvo não salta.

Laboratório, formação e visão de tarefa não usam alvo (zoom ao centro). A roda sobre rótulos é repassada ao canvas;
sobre painéis/formulários continua rolando o próprio painel.

## 2. Entrada e saída por proximidade (`proximity.ts`, função pura testada)
Entrar exige **todas** estas condições: alvo planeta válido (o apontado), zoom-in acumulado ≥ 0,4 (≈ 4 passos da roda)
sobre o mesmo alvo, gesto ativo (≤ 0,6 s), distância ≤ `min(7,5·R, 0,9·enquadramento do planeta)` e 0,16 s de permanência.
Sair exige zoom-out sustentado e distância ≥ `max(13·R, 1,55·enquadramento)`. As luas são reveladas de forma progressiva a
partir de `1,9×` a distância de entrada. Nada disso roda com a câmera ocupada (voo, laboratório, formação, reorganizar,
arrasto). A passagem de nível preserva a pose da câmera (sem voo e sem reenquadrar).

## 3. Continuidade das transições
Medido com passo de simulação fixo (30 Hz), mesmo roteiro, antes (main) → depois. "Salto de velocidade" = maior variação de
velocidade entre dois quadros consecutivos, relativa ao pico.

| Transição | salto de velocidade | giro máx./quadro |
|---|---|---|
| Universo → Planeta | 0,35 → 0,12 | 0,70° → 0,16° |
| Planeta → Grupo | 0,38 → 0,12 | 0,46° → 0,11° |
| Grupo → Tarefa | 0,39 → 0,11 | 0,86° → 0,27° |
| Tarefa → Grupo | 0,39 → 0,17 | 0,86° → 0,34° |
| Grupo → Planeta | 0,36 → 0,15 | 0,47° → 0,11° |
| Planeta → Universo | 0,34 → 0,19 | 0,67° → 0,15° |

Defeitos reais corrigidos:
- **Tranco no meio do voo**: a duração do voo era medida com relógio de parede, enquanto a câmera avança por quadros.
  Com taxa de quadros baixa o voo "acabava" cedo e a velocidade quintuplicava de uma vez. Agora é tempo de simulação e a
  mudança de suavização é gradual.
- **Alvo perdido**: se o nó 3D ainda não tinha se registrado, a câmera mirava a origem (a estrela). Agora usa o pai ou o
  último valor conhecido.
- **Sumiço abrupto**: ao sair de um planeta as luas eram desmontadas de uma vez; agora desvanecem.
- **Atravessar corpos**: a câmera é empurrada suavemente para fora de estrela, planetas, luas e satélites.

## 4. Refinamento gráfico (3 problemas observados nas capturas)
Capturas: `docs/fase2/*.jpg` (esquerda = main, direita = fase 2), qualidade cinematográfica, mesma cena e mesmo passo de tempo.

| # | Problema observado | Correção | Evidência |
|---|---|---|---|
| 1 | Perto do planeta a superfície ficava borrada | Até 3 oitavas extras de ruído (e sub-painéis no tecnológico, microtextura/ondulação no oceano) **só** a menos de ~7 raios; não são avaliadas à distância | oceano: energia de alta frequência +32%; rochoso ×2,3; tecnológico visivelmente mais definido; gasoso: ganho visual modesto, **não confirmado pela métrica** (−15%) |
| 2 | Lado noturno quase preto e ilegível | Ambiente maior e tingido pela atmosfera, halo noturno discreto e piso mínimo de luminosidade que preserva a matiz | rochoso (visto do lado noturno): luminância p10 0,0012 → 0,0034; relevo e nuvens passam a aparecer |
| 3 | Esferas iluminadas de frente pareciam discos chapados | Difusão tipo Lambert com pouco *wrap* em vez de `smoothstep` saturado | curvatura legível; razão dia/noite do oceano 104 → 27 (a 1ª tentativa dava 17 e achatava o terminador, então foi ajustada) |

Preservado: relevo por diferenças finitas, luzes de cidade só à noite, atmosfera/nuvens e perfis de qualidade
(nível *mínimo* não usa as oitavas extras). Sem bloom, partículas, pós-processamento ou dependências novas.
Tamanho do pacote praticamente inalterado (núcleo 3D ≈ 246 kB gzip).

## 5. Verificação
- `npm run lint`, `npm run typecheck`, `npm run build`: sem erros.
- `npm test`: 63 testes (inclui geometria de zoom e a máquina de intenção).
- `npm run e2e:nav`: 13/13 — A aproximar sem clique · B região vazia · C entrar por proximidade · D histerese e saída ·
  E alternar planetas · F girar/deslocar/centralizar após o zoom · G rolagem de painéis e formulários · H laboratório sem
  interferência · I movimento reduzido · K clique independente · L a câmera não atravessa estrela/planeta.
- `npm run e2e`: 18/18 — IndexedDB, criação/edição/exclusão de planetas, grupos e tarefas, backup, busca, reorganizar.

## Limitações
- Tudo foi verificado em Chromium com WebGL **por software**: a fluidez numa GPU real não foi medida. Para o resultado ser
  determinístico, os testes usam um passo de simulação fixo (`runtime.fixedDt`, só em dev).
- Sem suporte a toque (pinça). Pinça no trackpad chega como roda com `ctrl` e segue o mesmo caminho do zoom.
- As métricas de imagem comparam cenas equivalentes, mas a câmera tem uma deriva ociosa (não determinística), então
  regiões do planeta podem diferir ligeiramente entre as capturas.
