# Ampulheta

> O tempo não precisa parecer que está passando para estar passando.

**Ampulheta** é uma aplicação web estática que transforma intervalos de tempo em ampulhetas. Não é um cronômetro com desenho de ampulheta: a areia é calculada a partir do tempo real, e cada grão que cai representa uma fração exata do intervalo.

Uma ampulheta de 10 segundos escorre sem parar. Uma de 94 anos pode passar a tarde inteira imóvel — cada grão dela vale cerca de 16 horas. Isso é intencional.

Tudo roda no navegador. Não há servidor, conta, rastreamento nem build.

---

## Recursos

- **Quantas ampulhetas você quiser**, independentes entre si (“Minha vida”, “Faculdade”, “Hoje”, “Próximas férias”…).
- **Dois jeitos de criar**: entre duas datas (hora opcional) ou por uma duração — agora ou a partir de outra data (anos, meses, dias, horas, minutos e segundos, com atalhos rápidos).
- **Início no passado** é permitido: a ampulheta já aparece parcialmente escoada (“desde que comecei a faculdade”).
- **Grain Engine**: a quantidade de grãos se adapta à duração; os grãos só caem quando a sua fração de tempo termina.
- **Persistência local** em IndexedDB: feche o navegador e volte anos depois — o estado é reconstruído na hora, sem “replay”.
- **Painel de detalhes** (escondido por padrão): início, término, duração, decorrido, restante, percentuais com precisão adaptativa (ex.: `0,000000382%`), grãos totais, caídos, restantes, valor de cada grão e tempo até o próximo grão.
- **Modo contemplação**: esconde tudo, oculta o cursor, usa tela cheia quando possível e mantém a tela acesa (Wake Lock).
- **Final sóbrio**: a última areia cai, e aparece apenas “Terminou.”
- **Editar, duplicar, reiniciar (nova cópia começando agora), arquivar e excluir** — com confirmação própria.
- **Exportar/importar** tudo em JSON versionado, com validação, mesclagem ou substituição.
- **Som opcional** (desligado por padrão), sintetizado localmente, muito discreto.
- **Responsivo**: desktop, tablet e celular (gesto de deslizar para trocar de ampulheta).
- **Acessível**: navegação por teclado, rótulos ARIA, foco visível, `prefers-reduced-motion`.
- **PWA instalável** e funcionamento offline depois do primeiro carregamento.
- **Sem dependências**: HTML, CSS e JavaScript puro. Fontes e ícones locais.

---

## Como funciona

### O tempo

Cada ampulheta guarda apenas dois instantes absolutos (epoch em milissegundos, UTC): `start` e `end`. O estado é sempre calculado a partir do relógio do dispositivo:

```
progresso = (agora − início) / (término − início)
```

Timers e `requestAnimationFrame` servem apenas para **redesenhar**; nunca acumulam tempo. Ao voltar de uma aba em segundo plano, de uma suspensão do sistema ou de um navegador fechado, a ampulheta é redesenhada imediatamente no estado correto.

Datas digitadas são interpretadas no fuso local e convertidas para epoch na hora. A exibição volta ao fuso local. O backup usa ISO 8601 em UTC.

### O Grain Engine

Cada ampulheta é dividida em **N grãos lógicos** de mesma duração. O grão *k* cai exatamente em `início + k · (duração / N)`. A quantidade N cresce de forma logarítmica com a duração:

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

Duas âncoras calibram a curva: **1 hora ≈ 1 grão por segundo** e **90 anos (uma vida longa) = teto de 50 000 grãos**.

### Massa × grãos

- **Massa de areia**: contínua, derivada do progresso exato. A quantidade é medida pela área visível — se 37,5% do tempo passou, 37,5% da areia visível está embaixo. Em cima, a superfície desce com uma cratera no ângulo de repouso da areia; embaixo, cresce uma pilha cônica.
- **Grãos animados**: eventos discretos que atravessam o gargalo. A posição de cada grão é função pura do tempo (`agora − instante de queda`), então nada precisa ser armazenado e nada é reproduzido ao voltar.

A renderização usa Canvas 2D com camadas em cache (vidro, bases, reflexos). Quando nada visível muda, **nenhum quadro é desenhado**: o agendador dorme até o próximo grão ou até a areia se mover perceptivelmente.

---

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo, `ampulheta`).
2. Envie **o conteúdo desta pasta** para a raiz do repositório (o `index.html` deve ficar na raiz).
3. No repositório, abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**, selecione a branch `main` e a pasta `/ (root)`. Salve.
5. Aguarde um ou dois minutos e abra `https://SEU-USUARIO.github.io/ampulheta/`.

Todos os caminhos são relativos: o projeto funciona em subdiretório, em domínio próprio ou em qualquer servidor estático. Não há roteamento — recarregar a página nunca quebra. O arquivo `.nojekyll` impede que o GitHub Pages processe os arquivos com Jekyll.

### Rodar localmente

Abra o `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000
# depois abra http://localhost:8000
```

Via `file://` tudo funciona, exceto o service worker (modo offline) e, em alguns navegadores, as fontes locais — que dão lugar às fontes do sistema.

---

## Estrutura

```
index.html              Página única (marcação, diálogos, ícones em SVG)
manifest.webmanifest    Manifesto da PWA
sw.js                   Service worker (rede primeiro, cache como reserva)
css/
  base.css              Fontes, tokens de design, reset, tipografia
  layout.css            Palco, controles, legenda, introdução, contemplação
  components.css        Botões, painéis, modais, formulários, avisos
  hourglass.css         Luz, vinheta, granulação e transições da ampulheta
  responsive.css        Adaptações para tablet, celular e telas baixas
js/
  utils.js              Utilitários, hash determinístico, DOM seguro
  time-engine.js        Fonte da verdade temporal, calendário, estados
  format.js             Números, percentuais, datas e intervalos em pt-BR
  grain-engine.js       Grain Engine: quantidade, valor e instante dos grãos
  sand-geometry.js      Perfil do vidro e massa da areia (independente de pixels)
  model.js              Esquema, criação e validação de registros
  storage.js            IndexedDB (com alternativas) e preferências
  store.js              Coleção de ampulhetas e operações; sincroniza abas
  import-export.js      Backup JSON versionado
  hourglass-renderer.js Desenho em Canvas 2D
  scene.js              Agendador de renderização (quando redesenhar)
  sound.js              Som opcional sintetizado (Web Audio)
  ui-dialogs.js         Diálogos animados, confirmação e avisos
  ui-form.js            Criação e edição
  ui-panels.js          Menu e painel de detalhes
  ui-stage.js           Palco, navegação, deslizar, contemplação
  ui-settings.js        Configurações, ajuda e importação
  app.js                Inicialização, seleção e atalhos de teclado
assets/
  fonts/                Cormorant Garamond e Inter (SIL OFL 1.1)
  icons/                Favicon e ícones da PWA
tests/
  index.html            Testes dos módulos de tempo, grãos, geometria e dados
```

Os scripts são clássicos (não ES Modules) e registram suas APIs no namespace `Ampulheta`. A escolha é deliberada: assim o projeto abre direto do disco (`file://`) sem problemas de CORS e continua sem nenhuma etapa de build.

---

## Privacidade

- Nenhuma informação das ampulhetas é enviada a servidor algum. Não há chamadas de rede além do carregamento dos próprios arquivos do site.
- Sem contas, cookies de rastreamento, analytics ou CDNs.
- Depois do primeiro carregamento (em HTTPS), a aplicação funciona offline.

## Armazenamento

- As ampulhetas ficam no **IndexedDB** do navegador (banco `ampulheta`). Se ele não estiver disponível, a aplicação usa `localStorage` e, em último caso, apenas a memória da sessão (com aviso).
- Preferências pequenas (som, tela cheia, movimento reduzido, nome sob a ampulheta) ficam em `localStorage`.
- Ao criar a primeira ampulheta, a aplicação pede ao navegador armazenamento persistente (`navigator.storage.persist()`), para reduzir o risco de limpeza automática.
- Os dados ficam **somente naquele navegador, naquele dispositivo**. Outro navegador não os vê; limpar os dados de navegação os apaga. Exporte um backup de vez em quando.
- Sites publicados no mesmo domínio (ex.: dois projetos em `usuario.github.io`) compartilham o mesmo IndexedDB.

## Exportar e importar

**Exportar** gera `ampulheta-backup-AAAA-MM-DD.json` com todas as ampulhetas (arquivadas inclusive) e as preferências:

```json
{
  "format": "hourglass-backup",
  "version": 1,
  "exportedAt": "2026-09-30T12:00:00.000Z",
  "preferences": { "sound": false, "contemplationFullscreen": true, "reduceMotion": false, "showLabel": true },
  "hourglasses": [
    {
      "id": "3f0c…",
      "name": "Minha vida",
      "start": "1995-03-10T03:00:00.000Z",
      "end": "2075-03-10T03:00:00.000Z",
      "tone": "areia",
      "archived": false,
      "order": 0,
      "createdAt": "2026-09-30T12:00:00.000Z",
      "updatedAt": "2026-09-30T12:00:00.000Z"
    }
  ]
}
```

**Importar** lê o arquivo e o valida **antes** de qualquer alteração:

- JSON inválido, formato desconhecido ou versão mais nova que a suportada são recusados com mensagem clara.
- Registros corrompidos (sem nome, datas inválidas, término antes do início…) são ignorados e contabilizados.
- IDs repetidos dentro do arquivo são ignorados.
- **Mesclar** adiciona ao que já existe, nunca apaga: um ID que já existe com o mesmo conteúdo é ignorado; com conteúdo diferente, é importado como cópia (novo ID).
- **Substituir tudo** apaga as ampulhetas atuais e restaura as do arquivo, com as preferências (pede confirmação).
- O conteúdo é tratado estritamente como dado: nada é executado nem inserido como HTML.

---

## Atalhos de teclado

| Tecla     | Ação                                   |
|-----------|----------------------------------------|
| ← →       | Trocar de ampulheta                    |
| C         | Modo contemplação                      |
| F         | Tela cheia                             |
| I         | Detalhes                               |
| M         | Menu                                   |
| N         | Nova ampulheta                         |
| S         | Som ligado/desligado                   |
| ?         | Ajuda                                  |
| Esc       | Fechar painel ou sair da contemplação  |

Os atalhos não interferem quando você está digitando em um campo.

## Testes

Abra `tests/index.html` (localmente ou no endereço publicado, em `/tests/`). A página executa os testes dos módulos de tempo, formatação, Grain Engine, geometria da areia, validação e backup, e mostra o resultado.

## Atualizações e o service worker

O service worker usa a estratégia **rede primeiro**: com internet, o navegador sempre recebe a versão mais recente publicada; sem internet, usa a cópia guardada. Não é necessário alterar nada no `sw.js` para publicar mudanças — basta enviar os arquivos. Se adicionar novos arquivos ao projeto, inclua-os na lista `ASSETS` do `sw.js` para que funcionem offline.

## Licença

Código sob a licença [MIT](LICENSE).
Fontes: [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant) e [Inter](https://github.com/rsms/inter), ambas sob a SIL Open Font License 1.1 (textos em `assets/fonts/`).

Desenvolvido por Filipe Santana.
