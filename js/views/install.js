import { h, button, toast } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import { back } from '../router.js';
import { pageHeader } from '../components.js';
import { isStandalone, platform, promptInstall } from '../pwa.js';

const CHECKLIST = [
  'Instalar o aplicativo (veja as instruções acima).',
  'Abrir o aplicativo conectado à internet.',
  'Importar um audiolivro (ou criar o livro de demonstração).',
  'Reproduzir o audiolivro por alguns segundos.',
  'Fechar o aplicativo completamente.',
  'Ativar o modo avião.',
  'Abrir o aplicativo novamente pelo ícone.',
  'Acessar a biblioteca: o livro deve estar lá.',
  'Reproduzir o audiolivro: deve continuar de onde parou.',
  'Navegar entre os capítulos (próximo/anterior e lista).',
  'Bloquear a tela do celular.',
  'Verificar se a reprodução continua e se os controles aparecem na tela de bloqueio.',
  'Desbloquear o celular.',
  'Verificar se o progresso foi salvo (feche, reabra e confira a posição).',
];
const KEY = 'audiobook:offline-checklist';

function steps(list) {
  return h('ol', { class: 'steps' }, list.map((s) => h('li', {}, s)));
}

function platformCard({ title, ic, active, children }) {
  return h('details', { class: `platform-card ${active ? 'is-active' : ''}`, open: active },
    h('summary', {}, icon(ic, 22), h('span', {}, title), active && h('span', { class: 'badge badge--accent' }, 'Seu dispositivo'), icon('chevronDown', 18)),
    h('div', { class: 'platform-body' }, children));
}

export default function installView(root) {
  const draw = () => {
    const p = platform();
    const installed = isStandalone();
    let checked = [];
    try {
      checked = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {}

    const cta = installed
      ? h('div', { class: 'notice notice--ok' }, icon('checkCircle', 22), h('div', {}, h('strong', {}, 'Você está usando o app instalado.'), h('p', {}, 'Ele abre em tela cheia, funciona offline e mantém a biblioteca neste dispositivo.')))
      : state.installPrompt
        ? h('div', { class: 'install-cta' },
            h('div', {}, h('strong', {}, 'Pronto para instalar'), h('p', { class: 'muted' }, 'Um toque e o AUDIOBOOK vira um app na sua tela inicial.')),
            button('Instalar agora', { icon: 'download', variant: 'primary', onClick: async () => { const ok = await promptInstall(); if (!ok) toast('Instalação cancelada.'); draw(); } }))
        : p.iOS
          ? h('div', { class: 'notice notice--info' }, icon('share', 22), h('div', {}, h('strong', {}, 'No iPhone/iPad, a instalação é pelo menu Compartilhar.'), h('p', {}, 'Siga os passos de iOS abaixo.')))
          : h('div', { class: 'notice notice--info' }, icon('info', 22), h('div', {}, h('strong', {}, 'Use o menu do navegador para instalar.'), h('p', {}, 'Se o botão não aparecer, o app pode já estar instalado ou o navegador não oferece instalação. Veja as instruções abaixo.')));

    const checklist = h('ol', { class: 'checklist' },
      CHECKLIST.map((s, i) =>
        h('li', {},
          h('label', {},
            h('input', {
              type: 'checkbox', checked: checked.includes(i),
              onChange: (e) => {
                const set = new Set(checked);
                e.target.checked ? set.add(i) : set.delete(i);
                checked = [...set];
                try { localStorage.setItem(KEY, JSON.stringify(checked)); } catch {}
              },
            }),
            h('span', {}, s)))));

    root.replaceChildren(h('div', { class: 'page page-install' },
      pageHeader({ title: 'Instalar e compatibilidade', subtitle: 'Como instalar, o que funciona em segundo plano e os limites de cada sistema.', back: () => back('/configuracoes') }),
      cta,

      h('section', { class: 'detail-section' },
        h('h2', { class: 'section-title' }, 'Como instalar'),
        platformCard({
          title: 'Android (Chrome, Edge, Samsung Internet)', ic: 'phone', active: p.android,
          children: [steps(['Abra o endereço do app no Chrome.', 'Toque em “Instalar” no aviso, ou no menu ⋮ › “Instalar app” / “Adicionar à tela inicial”.', 'Abra o AUDIOBOOK pelo ícone criado.']),
            h('p', { class: 'muted small' }, 'Depois de instalado, você pode usar “Compartilhar › AUDIOBOOK” em gerenciadores de arquivos para importar áudios.')],
        }),
        platformCard({
          title: 'iPhone e iPad (Safari — iOS 16.4 ou superior)', ic: 'phone', active: p.iOS,
          children: [steps(['Abra o endereço no Safari (no iOS 16.4+ também funciona no Chrome/Edge).', 'Toque no botão Compartilhar (quadrado com seta para cima).', 'Escolha “Adicionar à Tela de Início” e confirme.', 'Abra pelo ícone e importe seus audiolivros por lá.']),
            h('div', { class: 'notice notice--warning' }, icon('alert', 20), h('p', {}, h('strong', {}, 'Importante: '), 'no iOS, o app instalado tem armazenamento separado do Safari. Livros importados numa aba do Safari não aparecem no app da Tela de Início (e vice-versa). Instale primeiro e importe dentro do app.'))],
        }),
        platformCard({
          title: 'Computador (Chrome, Edge — Windows, macOS, Linux)', ic: 'monitor', active: p.desktop && !p.safari && !p.firefox,
          children: [steps(['Clique no ícone de instalação na barra de endereço (monitor com seta) ou menu › “Instalar AUDIOBOOK”.', 'O app abre em janela própria e aparece no menu Iniciar / Launchpad.']),
            h('p', { class: 'muted small' }, 'Instalado, ele também pode abrir arquivos de áudio com “Abrir com › AUDIOBOOK” (Chrome/Edge).')],
        }),
        platformCard({
          title: 'Mac com Safari 17+ (macOS Sonoma ou superior)', ic: 'monitor', active: p.mac && p.safari,
          children: steps(['Menu Arquivo › “Adicionar ao Dock”.', 'Abra pelo Dock como um app independente.']),
        }),
        platformCard({
          title: 'Firefox', ic: 'monitor', active: p.firefox,
          children: h('p', {}, 'No Android, use o menu › “Instalar”. No computador, o Firefox não instala PWAs: o app funciona normalmente numa aba (inclusive offline), mas sem janela própria.'),
        })),

      h('section', { class: 'detail-section' },
        h('h2', { class: 'section-title' }, 'Reprodução em segundo plano'),
        h('p', { class: 'muted' }, 'O áudio é tocado por um elemento de áudio nativo do navegador e registrado na Media Session API. Assim o sistema operacional trata o app como um player de mídia: o som continua ao trocar de app ou bloquear a tela, e os controles aparecem na tela de bloqueio e na central de notificações. Não é uma simulação visual.'),
        h('div', { class: 'compat-table-wrap' },
          h('table', { class: 'compat-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Recurso'), h('th', {}, 'Android (Chrome)'), h('th', {}, 'iPhone/iPad (iOS 16.4+)'), h('th', {}, 'Computador'))),
            h('tbody', {},
              row('Tocar com a tela bloqueada', 'Sim', 'Sim', '—'),
              row('Tocar usando outro app', 'Sim', 'Sim', 'Sim (janela minimizada)'),
              row('Controles na tela de bloqueio', 'Sim (notificação de mídia)', 'Sim (Central de Controle / tela de bloqueio)', 'Teclas de mídia e painel do sistema'),
              row('Botões exibidos', 'Play/pausa, ±segundos, capítulo anterior/próximo', 'Play/pausa e ±segundos (o sistema escolhe; o ícone pode mostrar 10 ou 15 s, mas o app aplica 15/30 s)', 'Play/pausa, faixa anterior/próxima'),
              row('Próximo capítulo automático na tela bloqueada', 'Sim', 'Sim, enquanto o áudio estiver tocando', 'Sim'),
              row('Temporizador com tela bloqueada', 'Sim', 'Sim, enquanto toca (contado pelo próprio áudio)', 'Sim'),
              row('Retomar após o sistema encerrar o app', 'Reabra o app: continua do ponto salvo', 'Reabra o app: continua do ponto salvo', 'Igual'))))),

      h('section', { class: 'detail-section' },
        h('h2', { class: 'section-title' }, 'Limitações conhecidas'),
        h('ul', { class: 'limits' },
          limit('iOS', 'Depois de ficar pausado por um tempo em segundo plano, o iOS pode suspender o app e os controles somem da tela de bloqueio. Basta abrir o app e tocar em reproduzir — a posição está salva.'),
          limit('iOS', 'O volume não pode ser controlado por código (é somente leitura). O temporizador pausa diretamente, sem diminuir o volume aos poucos.'),
          limit('iOS', 'Armazenamento do app instalado é separado do Safari. Safari (não instalado) pode apagar dados de sites não usados há 7 dias; apps na Tela de Início não sofrem essa regra.'),
          limit('iOS', 'A importação usa o app Arquivos. Músicas compradas/protegidas por DRM do app Música não podem ser importadas.'),
          limit('Android', 'Economia de bateria agressiva de alguns fabricantes pode encerrar apps em segundo plano. Se a reprodução parar sozinha, desative a otimização de bateria para o Chrome.'),
          limit('Todos', 'Nenhum app web toca áudio depois que o dispositivo é reiniciado sem que você o abra de novo. Ao reabrir, a biblioteca e a posição estão intactas.'),
          limit('Todos', 'O navegador define a cota de armazenamento. Use “Armazenamento › Solicitar” para pedir armazenamento persistente e faça backups completos.')),
        h('div', { class: 'notice notice--info' }, icon('info', 22),
          h('div', {},
            h('strong', {}, 'Precisa de garantias que um PWA não oferece?'),
            h('p', {}, 'Para reprodução em segundo plano totalmente controlada (por exemplo, retomar após reinício ou um serviço de mídia permanente no iOS), a alternativa técnica é empacotar este mesmo código com Capacitor (Android/iOS) e um plugin nativo de áudio, ou publicar no Android via Trusted Web Activity. A interface e o armazenamento podem ser reaproveitados.')))),

      h('section', { class: 'detail-section' },
        h('h2', { class: 'section-title' }, 'Teste de funcionamento offline'),
        h('p', { class: 'muted' }, 'Siga este roteiro para confirmar no seu aparelho. As marcações ficam salvas aqui.'),
        checklist,
        button('Limpar marcações', { icon: 'rotate', variant: 'ghost', onClick: () => { try { localStorage.removeItem(KEY); } catch {} draw(); } }))));
  };
  const row = (...cells) => h('tr', {}, cells.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', {}, c))));
  const limit = (tag, text) => h('li', {}, h('span', { class: 'badge' }, tag), h('span', {}, text));
  draw();
  const offs = [bus.on('install:available', draw), bus.on('install:done', draw)];
  return () => offs.forEach((o) => o());
}
