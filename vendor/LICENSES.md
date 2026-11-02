# Componentes de terceiros (pasta `vendor/`)

Usados somente pela função **Converter ebook em audiolivro**. São baixados pelo app sob demanda
(na primeira conversão) e guardados no cache offline do aparelho. Arquivos sem modificações.

| Componente | Versão | Uso | Licença | Origem |
|---|---|---|---|---|
| ONNX Runtime Web | 1.20.1 | Executa o modelo neural de voz (WebAssembly) | MIT | https://github.com/microsoft/onnxruntime |
| piper-phonemize (WASM) | 1.0.0 | Converte texto em fonemas | MIT | https://github.com/diffusion-studio/piper-wasm |
| └ espeak-ng (embutido no WASM, inclui dados de idiomas) | — | Fonemização (voz `pt-br`) | GPL-3.0 | https://github.com/rhasspy/espeak-ng |
| lamejs | 1.2.1 | Codifica o áudio gerado em MP3 | LGPL-3.0 (biblioteca separada, sem modificações; LAME: https://lame.sourceforge.io) | https://github.com/zhuker/lamejs |
| PDF.js | 6.5.438 | Extrai o texto de PDFs | Apache-2.0 | https://github.com/mozilla/pdf.js |

**Vozes:** baixadas na primeira vez em que são usadas, não fazem parte do repositório.
- `pt_BR-faber-medium` e `pt_BR-edresson-low`: https://huggingface.co/rhasspy/piper-voices — licença no
  arquivo `MODEL_CARD` publicado junto de cada modelo.
- `pt_BR-dii-high` (feminina), `pt_BR-miro-high` e `pt_PT-dii-high` (feminina): OpenVoiceOS
  (https://huggingface.co/OpenVoiceOS) — **CC BY-NC-SA 4.0**: livres para uso pessoal/não comercial;
  uso comercial não permitido. Ver https://github.com/OHF-Voice/piper1-gpl/discussions/27.
