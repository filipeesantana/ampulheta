# Ampulheta

> O tempo não precisa parecer que está passando para estar passando.

**Ampulheta** é uma aplicação web estática que transforma intervalos de tempo em ampulhetas. A areia é calculada a partir do tempo real, e cada grão que cai representa uma fração exata do intervalo.

Uma ampulheta de 30 segundos escorre sem parar. Uma de 94 anos pode passar a tarde inteira imóvel — cada grão dela vale cerca de 16 horas. Isso é intencional.

Tudo roda no navegador. Não há servidor, conta, rastreamento nem etapa de build.

---

## Recursos

- **Quantas ampulhetas você quiser**, independentes entre si (“Minha vida”, “Faculdade”, “Projeto”, “Viagem”…).
- **Criação simples**: por duração (30 minutos, 1 hora, 1 mês, 94 anos — começando agora ou em outra data) ou por duas datas (hora opcional). O início pode estar no passado.
- **Troca rápida**: setas ao lado do nome, teclas ← →, deslizar o dedo, ou a lista rápida (toque no nome), com busca quando há muitas ampulhetas. A posição aparece discretamente (ex.: `3 / 8`).
- **Reiniciar com virada**: a ampulheta gira 180° com peso e inércia, a areia acompanha a gravidade e o ciclo recomeça agora — **com a mesma duração** de antes (30 minutos continuam 30 minutos; 1 mês continua 1 mês de calendário).
- **Ações claras** no botão “Ações” (•••): Informações, Editar, Reiniciar, Duplicar, Arquivar e Excluir. Quando uma ampulheta termina, “Reiniciar” aparece ao lado de “Terminou.”.
- **Grain Engine**: a quantidade de grãos se adapta à duração; um grão só cai quando a sua fração de tempo termina.
- **Persistência local** em IndexedDB: feche o navegador e volte anos depois — o estado é reconstruído na hora, sem “replay”.
- **Informações** (escondidas por padrão): progresso com números humanos (`47,2%`; `0,0000041%` só quando necessário), tempo decorrido e restante, datas, grãos e o valor de cada grão.
- **Modo contemplação**: a ampulheta domina a tela, o nome permanece discreto, o resto some e o cursor se esconde; tela cheia e tela sempre acesa quando o navegador permite.
- **Exportar/importar** em JSON versionado, com validação, mesclagem ou substituição. Backups da versão anterior continuam aceitos.
- **Som opcional** (desligado por padrão), sintetizado localmente, muito discreto.
- **Responsivo**, **acessível** (teclado, foco visível, rótulos, `prefers-reduced-motion`) e **instalável** (PWA, funciona offline).
- **Sem dependências**: HTML, CSS e JavaScript puro. Fonte e ícones locais.

---

## Como funciona

### O tempo

Cada ampulheta guarda dois instantes absolutos (epoch em milissegundos, UTC), `start` e `end`, e a sua **duração canônica**. O estado é sempre calculado a partir do relógio do dispositivo:

```
progresso = (agora − início) / (término − início)
```

Timers e `requestAnimationFrame` servem apenas para **redesenhar**; nunca acumulam tempo. Ao voltar de uma aba em segundo plano, de uma suspensão do sistema ou de um navegador fechado, a ampulheta é redesenhada imediatamente no estado correto.

### Reiniciar

Reiniciar define `início = agora` e `término = agora + duração canônica`. A duração canônica é guardada em unidades de calendário (`{ anos, meses, dias, horas, minutos, segundos }`):

- criada por duração → exatamente o que foi digitado (ex.: `{ minutes: 30 }`);
- criada por datas → a diferença de calendário entre as datas;
- ampulhetas antigas (sem esse dado) → derivada de `término − início` na migração automática.

O reinício só é gravado ao fim da animação, com o horário daquele instante. Com movimento reduzido, não há rotação: um esmaecimento curto e o reinício.

### O Grain Engine

Cada ampulheta é dividida em **N grãos lógicos** de mesma duração. O grão *k* cai exatamente em `início + k · (duração / N)`. N cresce de forma logarítmica com a duração:

```
u = log10(duração em segundos) / log10(90 anos em segundos)
N = 200 + (50 000 − 200) · u^2,75        (arredondado a 3 algarismos)
```

| Duração | Grãos  | Cada grão     | Comportamento        |
|---------|--------|---------------|----------------------|
| 10 s    | 303    | ≈ 33 ms       | fluxo contínuo       |
| 10 min  | 1 920  | ≈ 0,3 s       | chuva perceptível    |
| 1 h     | 3 590  | ≈ 1 s         | um grão por segundo  |
| 1 dia   | 8 540  | ≈ 10 s        | quedas espaçadas     |
| 1 ano   | 26 500 | ≈ 20 min      | silêncio             |
| 94 anos | 50 000 | ≈ 16h 29min   | quase imóvel         |

Quantidade lógica de grãos ≠ partículas desenhadas: a posição de cada grão visível é função pura do tempo, e no máximo algumas centenas são desenhadas por quadro.

### Massa de areia

A massa é contínua e derivada do progresso exato, medida pela área visível — se 37,5% do tempo passou, 37,5% da areia visível está embaixo. Em cima, a superfície desce com uma cratera no ângulo de repouso; embaixo, cresce uma pilha cônica. As relações área → altura são tabeladas uma única vez.

Na virada, a areia se comporta como um fluido granular: a superfície fica perpendicular à gravidade dentro do bulbo e a área é conservada em qualquer ângulo (recorte de polígono + bisseção).

### Desempenho

- A ampulheta é desenhada em três canvases do tamanho dela (não da tela): fundo e frente estáticos (pintados só ao redimensionar) e areia dinâmica.
- A massa de areia fica em cache e só é repintada quando a superfície se move perceptivelmente; quando nada visível muda, **nenhum quadro é desenhado** — o agendador dorme até o próximo grão.
- `requestAnimationFrame` só roda com grãos no ar, filete contínuo ou animações; nada roda com a aba oculta.
- Densidade de pixels limitada a 2× e a um teto de pixels por camada.
- Sem `backdrop-filter`, sem blend modes sobre a animação; interface animada apenas com `transform` e `opacity`.

---

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo, `ampulheta`) — ou use o existente.
2. Envie **o conteúdo desta pasta** para a raiz do repositório (o `index.html` deve ficar na raiz), substituindo os arquivos anteriores.
3. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
4. Abra `https://SEU-USUARIO.github.io/ampulheta/`.

Todos os caminhos são relativos: funciona em subdiretório, em domínio próprio ou em qualquer servidor estático. Não há roteamento — recarregar nunca quebra. O `.nojekyll` evita o processamento por Jekyll.

### Atualizações

O service worker usa **rede primeiro** e revalida cada arquivo com o servidor, então uma versão nova publicada chega na próxima visita. O cache é nomeado por versão e escopo, e caches antigos são apagados na ativação. Os arquivos CSS/JS também são referenciados com `?v=` no `index.html`. Ao publicar uma nova versão, atualize `VERSION` em `sw.js` e o `?v=` no `index.html` (recomendado, não obrigatório).

### Rodar localmente

Abra o `index.html` diretamente ou sirva a pasta:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Via `file://` tudo funciona, exceto o modo offline (service worker) e, em alguns navegadores, a fonte local — que dá lugar à fonte do sistema.

---

## Estrutura

```
index.html              Página única (marcação, diálogos, ícones em SVG)
manifest.webmanifest    Manifesto da PWA
sw.js                   Service worker (rede primeiro, cache versionado)
css/
  base.css              Fonte, tokens de design, reset, tipografia
  layout.css            Palco, barra superior, navegação inferior, contemplação
  components.css        Botões, painéis, menus, modais, formulários, avisos
  hourglass.css         Cenário, camadas da ampulheta e transições
  responsive.css        Notebooks, tablets, celulares e telas baixas
js/
  utils.js              Utilitários, hash determinístico, DOM seguro
  time-engine.js        Fonte da verdade temporal e calendário
  format.js             Números, percentuais, datas e intervalos em pt-BR
  grain-engine.js       Grain Engine
  sand-geometry.js      Vidro, massa de areia e areia fluida da virada
  model.js              Esquema v2, migração e validação de registros
  storage.js            IndexedDB (v2, com migração) e preferências
  store.js              Coleção de ampulhetas, reinício e sincronização entre abas
  import-export.js      Backup JSON versionado (v1 e v2)
  hourglass-renderer.js Desenho em Canvas 2D em camadas
  scene.js              Agendador de renderização
  flip.js               Animação de virada (reinício)
  sound.js              Som opcional sintetizado
  ui-dialogs.js         Diálogos, popovers ancorados, confirmação e avisos
  ui-form.js            Criação e edição
  ui-panels.js          Menu, lista rápida, ações e informações
  ui-stage.js           Palco, navegação, deslizar, virada e contemplação
  ui-settings.js        Configurações, ajuda e importação
  app.js                Inicialização, seleção, ações e atalhos
assets/
  fonts/                Inter (SIL OFL 1.1)
  icons/                Favicon e ícones da PWA
tests/
  index.html            Testes: tempo, grãos, geometria, reinício, migração e backups
```

Os scripts são clássicos (não ES Modules) e registram suas APIs no namespace `Ampulheta`, para que o projeto abra direto do disco sem problemas de CORS e continue sem build. As responsabilidades são separadas: **time-engine** (verdade temporal), **renderer/scene/flip** (representação), **ui-*** (interação) e **storage/store** (persistência). O FPS nunca determina o progresso.

---

## Dados, privacidade e compatibilidade

- As ampulhetas ficam no **IndexedDB** do navegador (banco `ampulheta`). Se ele não estiver disponível, a aplicação usa `localStorage` e, em último caso, só a memória da sessão — sempre com aviso.
- Nada é enviado a servidor algum. Sem contas, cookies de rastreamento, analytics ou CDNs.
- Os dados ficam **somente naquele navegador, naquele dispositivo**. Limpar os dados de navegação os apaga: exporte um backup de vez em quando.

### Esquema e migração

- **Banco v1 → v2**: ao abrir a nova versão, cada registro recebe `schemaVersion: 2`, `mode` e `duration` (derivada de `término − início`) dentro da própria transação de atualização do IndexedDB. Nada é apagado; registros ilegíveis ficam intactos e apenas são ignorados.
- Se outra aba ainda estiver aberta com a versão antiga, ela libera o banco e mostra um aviso para recarregar.

### Backup

**Exportar** gera `ampulheta-backup-AAAA-MM-DD.json`:

```json
{
  "format": "hourglass-backup",
  "version": 2,
  "exportedAt": "2026-09-30T12:00:00.000Z",
  "preferences": { "sound": false, "contemplationFullscreen": true, "reduceMotion": false, "showLabel": true },
  "hourglasses": [
    {
      "id": "3f0c…",
      "name": "Minha vida",
      "start": "1995-03-10T03:00:00.000Z",
      "end": "2089-03-10T03:00:00.000Z",
      "mode": "duration",
      "duration": { "years": 94, "months": 0, "days": 0, "hours": 0, "minutes": 0, "seconds": 0 },
      "tone": "areia",
      "archived": false,
      "order": 0,
      "createdAt": "2026-09-30T12:00:00.000Z",
      "updatedAt": "2026-09-30T12:00:00.000Z"
    }
  ]
}
```

**Importar** valida o arquivo **antes** de qualquer alteração: JSON inválido, formato desconhecido e versões mais novas são recusados com mensagem clara; registros corrompidos e IDs repetidos são ignorados e contabilizados. Backups **versão 1** continuam aceitos (a duração é derivada na importação). *Adicionar às atuais* nunca apaga nada (conflito de ID vira cópia); *Substituir tudo* pede confirmação. O conteúdo é tratado estritamente como dado.

---

## Atalhos de teclado

| Tecla | Ação                                  |
|-------|---------------------------------------|
| ← →   | Ampulheta anterior / próxima          |
| L     | Lista de ampulhetas                   |
| N     | Nova ampulheta                        |
| I     | Informações                           |
| C     | Modo contemplação                     |
| F     | Tela cheia                            |
| M     | Menu                                  |
| ?     | Ajuda                                 |
| Esc   | Fechar / sair da contemplação         |

Os atalhos não interferem quando você está digitando em um campo.

## Testes

Abra `tests/index.html` (localmente ou no endereço publicado, em `/tests/`). A página testa tempo e calendário, formatação, Grain Engine, massa de areia, areia fluida da virada, reinício com duração preservada (30 minutos, 1 mês, 94 anos), migração do esquema v1 e importação de backups v1 e v2.

## Licença

Código sob a licença [MIT](LICENSE). Fonte [Inter](https://github.com/rsms/inter) sob a SIL Open Font License 1.1 (`assets/fonts/OFL-Inter.txt`).

Desenvolvido por Filipe Santana.
