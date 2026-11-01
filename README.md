# AUDIOBOOK — audiolivros offline

Aplicativo web progressivo (PWA) de audiolivros em **HTML, CSS e JavaScript puros**, sem dependências.
Importe arquivos de áudio do dispositivo, organize sua biblioteca e ouça **offline**, com **reprodução em
segundo plano** e **controles na tela de bloqueio**.

- Biblioteca pessoal com capas, gêneros, busca, filtros (em andamento / não iniciados / concluídos), grade ou lista
- Livros com vários arquivos ou capítulos; ordem ajustável (arrastar, setas, por nome ou nº da faixa)
- Um arquivo longo (.m4b/.mp3) pode ser dividido em capítulos por marcações de tempo ou intervalo fixo;
  capítulos embutidos (M4B “Nero chpl” e MP3 ID3 “CHAP”) são detectados automaticamente
- Leitura local de tags (título, autor, narrador, gênero, ano, sinopse, **capa embutida**)
- Player completo + mini player persistente; velocidade de 0,5x a 3x; ±15/30 s; capítulo anterior/próximo
- Temporizador (5, 10, 15, 30, 45 min, 1 h ou fim do capítulo) com cancelar/reiniciar e temporizador padrão
- Progresso salvo automaticamente, retomada exata, retrocesso inteligente após pausas longas
- Marcadores com notas, notas pessoais por livro, favoritos, playlists (o próximo livro começa sozinho)
- Histórico, estatísticas de audição (tempo total, hoje, 7 dias, sequência, gêneros, mais ouvidos)
- Painel de armazenamento, armazenamento persistente, limpeza do cache sem tocar na biblioteca
- Exportação/importação de dados (JSON) e **backup completo com áudio** (`.audiobook`)
- Tema claro, escuro (tons quentes, confortável à noite) e automático
- Livro de demonstração gerado no próprio aparelho (áudio sintetizado, sem direitos autorais)

---

## 1. Estrutura do projeto

```
index.html              Casca do app (barra lateral, barra inferior, mini player, <audio> único)
manifest.json           Manifesto PWA (ícones, atalhos, share target, file handler)
sw.js                   Service Worker (cache offline-first da interface)
css/
  tokens.css            Cores e medidas dos temas claro/escuro
  base.css              Reset e tipografia
  layout.css            Estrutura, navegação, mini player, toasts
  components.css        Botões, capas, cartões, folhas, listas, campos
  views.css             Estilos de cada tela
  player.css            Player completo e barra de progresso
js/
  app.js                Inicialização, rotas, atalhos de teclado
  db.js                 IndexedDB (stores e migrações)
  repo.js               Regras de dados: livros, capítulos, áudio, progresso, marcadores, playlists...
  player.js             Motor de áudio, Media Session, temporizador, salvamento do progresso
  covers.js             Capas (Object URLs, redimensionamento, capas geradas, arte da tela de bloqueio)
  metadata.js           Leitura de tags ID3 / MP4 e capítulos embutidos
  audio-probe.js        Duração e compatibilidade de cada arquivo
  demo.js               Audiolivro de demonstração sintetizado
  backup.js             Exportação/importação (JSON e backup completo)
  pwa.js                Service Worker, instalação, armazenamento persistente, arquivos compartilhados
  router.js             Rotas por hash (#/biblioteca, #/livro/:id...)
  ui.js, icons.js       Utilitários de interface, modais, toasts e ícones SVG
  components.js         Cartões, listas de capítulos, barras de progresso...
  sheets.js             Folhas de velocidade, temporizador, capítulos, marcadores, playlists
  sortable.js           Arrastar para reordenar (mouse e toque)
  theme.js, state.js, utils.js
  views/                Uma tela por arquivo: home, library, details, player-view (player + mini player),
                        import, favorites, history, settings, storage, stats, install, playlists
icons/                  Ícones do app (PNG, maskable, apple-touch-icon, favicon SVG)
tools/
  update-sw.mjs         Atualiza a lista de arquivos e a versão do Service Worker
  render-icons.mjs      Gera os PNGs dos ícones a partir dos SVGs
  test-e2e.mjs          Teste automatizado ponta a ponta (inclui modo offline)
```

Telas (rotas): Início `#/inicio` · Biblioteca `#/biblioteca` · Player `#/player` · Detalhes `#/livro/:id` ·
Importar `#/importar` · Editar `#/editar/:id` · Favoritos `#/favoritos` · Histórico `#/historico` ·
Configurações `#/configuracoes` · Armazenamento `#/armazenamento` · Estatísticas `#/estatisticas` ·
Playlist `#/playlist/:id` · Instalar e compatibilidade `#/instalar`.

---

## 2. Como executar

Não há etapa de build. Basta servir a pasta por HTTP.

**No computador (teste local):**

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080`. (`localhost` é considerado seguro, então o Service Worker funciona.)

**No celular:** o Service Worker e a instalação **exigem HTTPS**. Publique a pasta em qualquer hospedagem
estática com HTTPS. Todos os caminhos são relativos, então funciona também em subpastas. Opções:

- **GitHub Pages** (este repositório): *Settings › Pages › Build and deployment › Deploy from a branch ›
  `main` / `(root)`*. O app ficará em `https://<usuário>.github.io/audiobook/`.
- Netlify, Vercel, Cloudflare Pages: arraste a pasta ou conecte o repositório (sem comando de build).

> Depois de alterar qualquer arquivo, rode `node tools/update-sw.mjs`. Ele atualiza a lista de arquivos
> do cache e a versão; os usuários verão o aviso “Nova versão disponível — Atualizar”.

---

## 3. Como instalar no celular

| Plataforma | Passos |
|---|---|
| **Android** (Chrome, Edge, Samsung Internet) | Abra o endereço › toque em **Instalar** no aviso ou menu ⋮ › **Instalar app** / **Adicionar à tela inicial**. |
| **iPhone/iPad** (iOS 16.4+) | Abra no **Safari** (ou Chrome/Edge no iOS 16.4+) › botão **Compartilhar** › **Adicionar à Tela de Início**. |
| **Computador** (Chrome/Edge) | Ícone de instalação na barra de endereço › **Instalar**. Mac com Safari 17+: **Arquivo › Adicionar ao Dock**. |

**Importante no iOS:** o app instalado na Tela de Início tem um armazenamento **separado** do Safari.
Instale primeiro e importe os audiolivros **dentro do app instalado**.

A tela **Configurações › Instalar app** (`#/instalar`) mostra essas instruções, destaca o seu sistema e
oferece o botão de instalação quando o navegador permite.

---

## 4. Como importar audiolivros

1. Toque em **+** (Início/Biblioteca) ou **Importar audiolivro**.
2. **Selecionar arquivos de áudio** (vários de uma vez) ou, no computador, **Selecionar pasta** /
   arrastar e soltar. Formatos: os que o navegador reproduz (MP3, M4A/M4B/AAC, OGG/OPUS, WAV, FLAC, WebM...).
3. O app lê duração, tags e capa **localmente** e sugere título, autor, narrador, gênero e ordem.
4. Ajuste as informações, escolha uma capa (opcional; sem capa, uma capa tipográfica é gerada) e
   organize os capítulos: arraste pela alça, use as setas, o menu **Organizar…** (por nome, por faixa,
   inverter, renomear) ou a **tesoura** para dividir um arquivo longo em capítulos.
5. **Salvar na biblioteca**: os arquivos são **copiados para o IndexedDB** e verificados. A tela de
   detalhes confirma **“Disponível offline”**. Se algum arquivo não for gravado, o app avisa e indica
   quais capítulos não tocarão offline. Eles podem ser corrigidos em **Editar › Vincular arquivo**.

Outras formas de importar:
- **Android (app instalado):** em um gerenciador de arquivos, **Compartilhar › AUDIOBOOK**.
- **Computador (Chrome/Edge, app instalado):** **Abrir com › AUDIOBOOK**.
- **Backup:** Configurações › Importar dados ou backup (`.json` ou `.audiobook`).
- **Sem arquivos?** “Criar livro de demonstração” gera um livro de 3 capítulos no próprio aparelho.

Conteúdo em domínio público para testar: audiolivros do **LibriVox** (librivox.org), que podem ser baixados
e importados.

---

## 5. Como funciona a reprodução em segundo plano

O app não simula nada visualmente. Ele usa os mecanismos reais do navegador e do sistema:

1. **Um único elemento `<audio>` nativo** fica fora das telas (`index.html`). Trocar de tela só troca o
   conteúdo de `<main>`, então o áudio nunca é recriado nem interrompido.
2. **O áudio vem do IndexedDB como Blob** e é tocado via `URL.createObjectURL(blob)`. Não há streaming
   nem rede. As URLs são revogadas ao trocar de arquivo, para não vazar memória.
3. **Media Session API:** o app publica título do livro, autor, capítulo atual e capa (`MediaMetadata`), o
   estado (`playbackState`) e a posição (`setPositionState`). Também registra as ações *play, pause,
   seekbackward (−15 s), seekforward (+30 s), previoustrack, nexttrack, seekto e stop*. Por isso o
   sistema mostra os controles na tela de bloqueio, na notificação de mídia (Android), na Central de
   Controle (iOS) e nas teclas de mídia do computador.
4. **Troca de capítulo sem a tela ligada:** o arquivo do próximo capítulo é **pré-carregado** com
   antecedência. Quando o evento `ended` dispara, a nova fonte é aplicada de forma **síncrona** e a
   reprodução continua, mesmo com a página em segundo plano.
5. **iOS e gesto do usuário:** o primeiro `play()` precisa acontecer durante um toque. Como o áudio é lido
   do banco de forma assíncrona, o elemento é “destravado” com um clipe silencioso durante o toque; depois
   a fonte real toca normalmente.
6. **Temporizador confiável:** o tempo restante é descontado a partir dos eventos do próprio áudio
   (`timeupdate`), que continuam com a tela bloqueada, e não apenas por `setInterval` (que o sistema
   congela em segundo plano).
7. **Progresso:** salvo a cada 5 s durante a reprodução (se ativado), ao pausar, trocar de capítulo,
   esconder o app (`visibilitychange`) e ao fechar (`pagehide`, com cópia síncrona no `localStorage`).

---

## 6. Arquitetura offline-first

- **Interface:** o `sw.js` pré-carrega todos os arquivos do app (HTML, CSS, JS, ícones, manifest) num
  cache versionado (`audiobook-shell-<versão>`). A navegação é respondida pelo `index.html` em cache. Os
  demais arquivos seguem a estratégia *cache primeiro*. O app usa fontes do sistema, sem fontes externas.
- **Dados e áudio:** tudo fica no **IndexedDB** (banco `audiobook`): livros, capítulos, **áudio (Blob)**,
  capas, progresso, marcadores, histórico, playlists, estatísticas e configurações. O áudio **nunca** fica
  no Cache Storage nem no `localStorage`.
- **Atualizações seguras:** uma nova versão é instalada em paralelo e só assume quando o usuário toca em
  “Atualizar”. A ativação remove apenas caches antigos da interface; o IndexedDB não é tocado.
  Mudanças de esquema do banco são migrações incrementais em `js/db.js`.
- **Limpar cache do app** (Armazenamento): baixa a interface de novo e só então substitui o cache. Sem
  internet, mantém o cache atual para o app não deixar de abrir. A biblioteca não é afetada.
- **Storage Manager:** o painel mostra o espaço usado pelo áudio, capas, cache e dados, e o espaço
  disponível estimado. O app pede `navigator.storage.persist()` após a primeira importação e tem um botão
  para pedir de novo. Nada é apagado sem confirmação, e “Apagar todos os dados” exige digitar `APAGAR`.

Nenhuma função principal depende de internet: abrir o app, biblioteca, reprodução, capítulos,
progresso, temporizador, configurações, favoritos, histórico, busca, importação, backup e estatísticas.

---

## 7. Limitações por plataforma (sem promessas que o navegador não garante)

| Tema | Android (Chrome) | iPhone/iPad (iOS 16.4+) |
|---|---|---|
| **Segundo plano** | Continua ao trocar de app e com a tela bloqueada. | Continua com a tela bloqueada e em outros apps **enquanto toca**. Pausado por muito tempo, o iOS pode suspender o app. |
| **Tela de bloqueio** | Notificação de mídia com play/pausa, ±segundos e capítulos. | Play/pausa e ±segundos. O ícone pode mostrar 10 ou 15 s, mas o app aplica 15/30 s. Pode sumir se o app for suspenso. |
| **Instalação** | Prompt automático ou menu “Instalar app”. | Manual: Compartilhar › Adicionar à Tela de Início. Armazenamento separado do Safari. |
| **Persistência** | `persist()` costuma ser concedido para apps instalados. Sem ele, o sistema pode limpar dados só sob pressão de espaço. | No Safari (não instalado), dados de sites sem uso por 7 dias podem ser apagados; **apps na Tela de Início não sofrem essa regra**. Cota ligada ao espaço do aparelho. |
| **Importação** | Seletor de arquivos e “Compartilhar › AUDIOBOOK” (share target). | App **Arquivos** (iCloud Drive / No meu iPhone). Músicas com DRM do app Música não podem ser importadas. |
| **Após reiniciar o aparelho** | Nenhum app web retoma o som sozinho. Ao abrir, a biblioteca e a posição estão intactas. | Igual. |
| **Volume por código** | Funciona (o temporizador abaixa o volume aos poucos). | Somente leitura: o temporizador pausa direto. |

Outros: Firefox no computador não instala PWAs, mas o app funciona numa aba, inclusive offline. Alguns
fabricantes Android têm economia de bateria agressiva; se o som parar sozinho, desative a otimização de
bateria do navegador.

**Alternativa técnica quando um PWA não basta:** para um serviço de mídia nativo permanente (por exemplo,
garantias maiores no iOS, retomar após reinício ou publicar nas lojas), empacote este mesmo código com
**Capacitor** (Android/iOS) e um plugin nativo de áudio em segundo plano. No Android também é possível
publicar via **Trusted Web Activity**. Interface, regras e armazenamento são reaproveitados.

---

## 8. Teste obrigatório de funcionamento offline

### Procedimento manual (no celular)

1. Instalar o aplicativo (seção 3).
2. Abrir o aplicativo conectado à internet.
3. Importar um audiolivro (ou “Criar livro de demonstração”).
4. Reproduzir o audiolivro.
5. Fechar o aplicativo completamente.
6. Ativar o modo avião.
7. Abrir novamente o aplicativo pelo ícone.
8. Acessar a biblioteca: o livro deve aparecer.
9. Reproduzir o audiolivro: deve continuar de onde parou.
10. Navegar entre os capítulos (anterior/próximo e lista de capítulos).
11. Bloquear a tela do celular.
12. Verificar se a reprodução continua e se os controles aparecem na tela de bloqueio.
13. Desbloquear o celular.
14. Verificar se o progresso foi salvo (feche, reabra e confira a posição).

O roteiro também está no app, com caixas de seleção, em **Configurações › Instalar app**.

### Teste automatizado

`tools/test-e2e.mjs` roda o fluxo completo no Chromium (Playwright). Ele importa 3 arquivos reais, toca o
livro, muda a velocidade para 2x, confere a troca automática de capítulo, navega por 8 telas durante a
reprodução, cria um marcador e pausa. Em seguida **recarrega em modo offline**, confere biblioteca,
retomada, velocidade, reprodução e capítulos, testa o temporizador “fim do capítulo”, gera um backup
completo, apaga tudo e restaura, e por fim remove o livro.

```bash
python3 -m http.server 8765
```

```bash
node tools/test-e2e.mjs http://localhost:8765/
```

Resultado da última execução: **29 verificações OK, 0 falhas**. Bloqueio de tela e controles do sistema
não podem ser automatizados num navegador headless: use o procedimento manual acima no aparelho.

---

## 9. Atalhos de teclado (computador)

`Espaço`/`K` reproduzir/pausar · `←`/`J` −15 s · `→`/`L` +30 s · `Shift+←/→` capítulo anterior/próximo ·
`,` `.` velocidade − / + · `B` marcador · `F` abrir/fechar o player.

## 10. Privacidade

Tudo fica no seu dispositivo. O app não faz requisições a servidores externos, não usa analytics e não
envia seus arquivos para lugar nenhum.
