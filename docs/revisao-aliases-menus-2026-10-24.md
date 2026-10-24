# Revisão dos menus e aliases — etapa 6

Base: `dd86872faba0c0c453bf007018ffbb0a3fb716bc`, branch
`feat/casamento-olimpo`. Revisão exclusivamente offline, sem commit, push ou deploy.

## Auditoria do carregador real

A função `carregarComandos` foi extraída e executada isoladamente, sem iniciar o
bot. Foram inventariados todos os nomes e aliases, incluindo nomes canônicos que
sobrescrevem registros anteriores sem emitir aviso. O inventário identificou 16
rotas com mais de uma declaração: sete autoaliases e nove disputas entre módulos.
Os nove avisos `Alias ignorado` correspondem aos sete autoaliases e a `morder` e
`flip`; portanto, os avisos sozinhos não descrevem todas as sobreposições.

| Rota | Declarações | Resultado e tratamento |
|---|---|---|
| `arrancarcalcinha` | Nome e alias do mesmo comando adulto | Autoalias inofensivo; preservado. |
| `beijogostoso` | Nome e alias do mesmo comando adulto | Autoalias inofensivo; preservado. |
| `beijolesbico` | Nome e alias do mesmo comando adulto | Autoalias inofensivo; preservado. |
| `blow2` | Nome e alias do mesmo comando adulto | Autoalias inofensivo; preservado. |
| `pgpeito2` | Nome e alias do mesmo comando adulto | Autoalias inofensivo; preservado. |
| `pgpeito3` | Nome e alias do mesmo comando adulto | Autoalias inofensivo; preservado. |
| `menu-adulto` | Nome e alias do próprio menu | Autoalias inofensivo; preservado. |
| `tapa` | Comandos adulto e de brincadeiras | Brincadeira vence; adulto continua acessível por `bater`. |
| `soco` | Comandos adulto e de brincadeiras | Brincadeira vence; adulto continua acessível por `murro`. |
| `morder` | Adulto e alias de `mordida` | Adulto vence; brincadeira permanece em `mordida`. |
| `mordida` | Alias adulto e nome de brincadeira | Brincadeira vence; adulto permanece em `morder`. |
| `flip` | Cara ou coroa e alias de `espelhar` | Cara ou coroa vence; filtro permanece em `espelhar`/`espelho`. |
| `gay` | Porcentagem e efeito de imagem | Efeito vence; a porcentagem estava inacessível e ganhou `gayporcentagem`. |
| `meme` | Alias de `explicarmeme` e gerador | Gerador vence; explicação permanece em `explicarmeme` e seus demais aliases. |
| `encerrar-enquete` | Módulos de decisão e de opinião | Handler de opinião vence e já delega o encerramento administrativo ao módulo de decisão; preservado. |
| `meuslembretes` | Implementações da raiz e de utilitários | Raiz vence; utilitário permanece em `meus-lembretes`; ambos preservados. |

Os vencedores existentes não foram alterados. Não foi removido nenhum nome ou
alias. As sobreposições preservadas ficam explícitas nos testes; uma colisão nova
faz a auditoria falhar. Os avisos inofensivos podem continuar aparecendo: o loader
de produção não foi modificado para silenciá-los.

## Defeito reproduzido e correção mínima

Antes da correção, o teste de acessibilidade falhou para a implementação de
porcentagem `gay`: nem seu nome nem qualquer alias apontavam para ela. Foi adicionado
somente o alias exclusivo `gayporcentagem`. `/gay` continua sendo o efeito de imagem.
A chave diária da brincadeira continua `gay`, preservando a compatibilidade dos dados.
O novo acesso aparece no portal de brincadeiras; o renderizador passou a reservar
o complemento “adulto” aos acessos alternativos da categoria adulta.

Resultado: 647 rotas no registro, 345 entradas públicas no catálogo e 12 portais.
A paginação permanece em 12 entradas. As 50 entradas adultas continuam presentes
e bloqueadas quando o modo adulto está desligado. O comando reservado continua
oculto e não é executado pelos testes de menus.

## Testes desatualizados

As verificações antigas procuravam texto no código dos menus, títulos anteriores,
aliases como entradas independentes ou todos os comandos na primeira página.
Agora usam o catálogo, o loader real e todas as páginas renderizadas com `/`, `!`
e `#`. Os oito comandos de voz pertencem ao portal modificador; `tiktok-audio`
pertence ao portal download. Os testes de funcionalidade e de permissões existentes
foram preservados.

Também foram corrigidas duas expectativas antigas de aliases: `figurinha` possui
`fig`, `f` e `figu`; TikTok possui `tt`, `ttk`, `tik-tok` e `tiktokdl`. Nenhum alias
desses comandos foi alterado na produção.

## Arquivos alterados

Produção, para envio manual à hospedagem após revisão:

- `comandos/menu-brincadeiras/aleatorios.js`
- `dados/menus-catalogo.js`
- `dados/menus-olimpo.js`

Suítes existentes atualizadas, sem necessidade de envio para aplicar a mudança:

- `scripts/teste-atividade-grupo.js`
- `scripts/teste-corvip.js`
- `scripts/teste-downloads-extra.js`
- `scripts/teste-efeitos-visuais.js`
- `scripts/teste-efeitos.js`
- `scripts/teste-figurinha.js`
- `scripts/teste-menus-olimpo.js`
- `scripts/teste-modificador-voz.js`
- `scripts/teste-nomecustom.js`
- `scripts/teste-perfil.js`
- `scripts/teste-prefixo.js`
- `scripts/teste-temavip.js`
- `scripts/teste-tiktok.js`

Arquivos novos:

- `scripts/helpers/menu-catalogo-teste.js`
- `scripts/teste-aliases-comandos.js`
- `docs/revisao-aliases-menus-2026-10-24.md`

## Validação final

865 cenários aprovados, zero reprovados, em 22 suítes com contagem de cenários.
O teste adicional de carregamento também passou: 23 scripts executados no total.

| Suíte | Aprovados |
|---|---:|
| Atividade do grupo | 26 |
| Cor VIP | 20 |
| Nome customizado | 22 |
| Tema VIP | 15 |
| Perfil | 11 |
| Efeitos | 16 |
| Efeitos visuais | 61 |
| Modificador de voz | 55 |
| Downloads extra | 39 |
| TikTok | 18 |
| Figurinha | 54 |
| Prefixo | 25 |
| Menus do Olimpo | 54 |
| Auditoria de aliases | 33 |
| Brincadeiras aleatórias | 11 |
| ON/OFF | 86 |
| Proteção do bot | 48 |
| Donos | 72 |
| Arcontes | 98 |
| Enquetes nativas | 38 |
| Integração de animações | 44 |
| Meus lembretes | 19 |

Sintaxe dos JavaScripts alterados/criados e `git diff --check` verificados.
Rede, MongoDB real e leitura do `.env` bloqueados nas execuções. Nenhuma migração,
permissão real ou dado de autenticação foi alterado. As correções anteriores do
ranking, donos, antigolpe, limite de caracteres e totag permanecem intactas.

O risco funcional concentra-se no novo acesso e na entrada adicional do portal
de brincadeiras, que pode deslocar comandos entre páginas. Os endereços existentes
continuam iguais. A validação offline não comprova a execução em WhatsApp/LatamHost
nem a disponibilidade dos serviços externos usados por outros comandos.
