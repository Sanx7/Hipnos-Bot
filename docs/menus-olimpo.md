# Portais do Olimpo

O menu principal apresenta somente os 12 submenus, com descrição breve, incluindo
as áreas adulto e dono para qualquer solicitante. Mostrar um portal não autoriza
a execução de seus comandos. Nenhuma lógica de autorização ou ação foi alterada.

## Uso

- `/menu`: central de navegação.
- `/menu-admin`: primeira página administrativa.
- `/menu-admin 2`: página seguinte.
- `/menu-relacionamentos`: namoro, casamento, propostas, encerramentos e consultas.
- `/menu-rpg`: identidade, economia, faculdade e carreira.
- `/menu-modificador`: efeitos de áudio.

Todos os submenus aceitam um número de página opcional e exibem até 12 comandos
por mensagem. Os links de continuação, retorno e comandos usam o prefixo atual.
Os aliases existentes e a barra legada permanecem aceitos. A consulta aos menus
é livre; os controles globais ON/OFF e somente admin continuam no roteador.

## Inventário verificado

O loader local passou de 613 para 616 entradas, contando aliases, pela inclusão
de três novos submenus. Há 330 comandos de execução classificados uma única vez,
além dos 13 menus (central + 12 portais) e do atalho `brincadeira`.
Comandos novos exigem atualização editorial do catálogo; o teste acusa omissões.
Nenhum comando carregado ficou sem categoria. Helpers sem `nome`/`executar`
(`webp-animado.js` e `audio-extrator.js`) não são comandos.

RPG e modificadores tinham pastas de comandos sem submenu próprio. Relacionamentos
estavam distribuídos entre brincadeiras e dono. Comandos gerais antes anunciados
na central foram realocados em utilitários, efeitos, figurinhas ou dono.
Packs de figurinhas ficam no ateliê. A posição dos arquivos de execução é preservada.

| Portal | Comandos | Páginas |
|---|---:|---:|
| `menu-admin` | 57 | 5 |
| `menu-brincadeiras` | 50 | 5 |
| `menu-relacionamentos` | 14 | 2 |
| `menu-utilitario` | 42 | 4 |
| `menu-efeitos` | 48 | 4 |
| `menu-figurinhas` | 19 | 2 |
| `menu-download` | 12 | 1 |
| `menu-modificador` | 8 | 1 |
| `menu-rpg` | 17 | 2 |
| `menu-adulto` | 40 | 4 |
| `menu-vip` | 8 | 1 |
| `menu-dono` | 15 | 2 |

## Comparação com os textos anteriores

A lista abaixo registra comandos canônicos que não eram anunciados em nenhum
dos textos de menu anteriores. A comparação considera nomes e aliases escritos
nos textos, sem tratar menções a outros menus como cobertura de seus comandos.

- **Égide de Atena:** `arconte`, `historicoarconte`, `listaarcontes`, `removerarconte`.

- **Laços de Afrodite e Hera:** `aceitar`, `ajustardatacasamento`, `casamento`, `casar`, `divorciar`, `recusar`, `aceitarnamoro`, `namorar`, `namoro`, `recusarnamoro`, `terminar`.

- **Oráculos de Hermes:** `afk`.

- **Jornadas dos Heróis:** `carreira`, `empregos`, `trabalhar`, `carteira`, `depositar`, `sacar`, `transferir`, `diplomas`, `estudar`, `faculdade`, `faculdades`, `matricular`, `retomar`, `trancar`, `ficha`, `registrar`, `testrpg`.

- **Trono de Hipnos:** `diagnostico`, `marcarsugestao`, `nuke`, `versugestoes`.

## Catálogo por portal

### 🛡️ Égide de Atena

- **👥 Gestão do grupo:** `abrir`, `addblacklist`, `ban`, `blacklist`, `d`, `delete`, `emojilista`, `emojiregistrar`, `emojiremover`, `enquete-admin`, `fechar`, `hidetag`, `inativos`, `kick`, `linkgp`, `modoadulto`, `mute`, `promover`, `rebaixar`, `remblacklist`, `soadm`, `totag`, `unmute`.
- **⚖️ Tribunal dos Sonhos:** `adv`, `advs`, `historicoadv`, `remadv`, `setlimiteadv`, `zeraradv`.
- **🛡️ Guardiões do recinto:** `anti-audio`, `antiapagada`, `antidoc`, `antievento`, `antiflood`, `antigolpe`, `antilink`, `antilinkhard`, `antipay`, `antistatus`, `limitecaractere`.
- **🏛️ Arcontes do Olimpo:** `arconte`, `historicoarconte`, `listaarcontes`, `removerarconte`.
- **🔮 Regras de figurinhas:** `delfigadv`, `delfigban`, `delfigdel`, `figadv`, `figban`, `figdel`, `figlistanegra`.
- **🌙 Boas-vindas e anúncios:** `legendabv`, `resetbannerbv`, `resetlegendabv`, `setads`, `setbannerbv`, `welcome`.

### 🎮 Jogos do Limbo

- **🎲 Sorte e destino:** `8ball`, `carta`, `dado`, `escolha`, `flip`, `moeda`, `numero`, `roleta`, `simounao`, `sorte`, `sorteio`.
- **🎭 Interações:** `abraço`, `aconchego`, `beijo`, `carinho`, `chute`, `comer`, `cutucada`, `lutar`, `matar`, `mordida`, `soco`, `tapa`.
- **🎮 Jogos e desafios:** `adivinha-emoji`, `anagrama`, `cobrinha`, `desenharpalavra`, `dino`, `eununca`, `forca`, `gartic`, `jogar`, `ppt`, `quiz`, `rimas`, `velha`, `verdadeouconsequencia`.
- **💬 Conversas do limbo:** `curiosidadenumero`, `elogio`, `encerrar-enquete`, `enquete`, `frase`, `gatofato`, `gerar-nome`, `insulto`, `parecido`, `pergunta`, `qi`, `quem`.
- **⚠️ Roleta de expulsão:** `roletarussa`.

### 💍 Laços de Afrodite e Hera

- **💍 Uniões de Hera:** `aceitar`, `ajustardatacasamento`, `casamento`, `casar`, `divorciar`, `recusar`.
- **💞 Namoros de Afrodite:** `aceitarnamoro`, `namorar`, `namoro`, `recusarnamoro`, `terminar`.
- **🔮 Oráculo dos pares:** `casal`, `compatibilidade`, `crush`.

### 🧰 Oráculos de Hermes

- **⚖️ Tribunal dos Sonhos:** `minhaspunicoes`.
- **🧰 Consultas e ferramentas:** `apagadas`, `cep`, `checkativo`, `clima`, `conversor`, `ddd`, `emojimix`, `horoscopo`, `jornal`, `letra`, `meme`, `nasa`, `procurado`, `rankativo`, `revelar`, `revelaraudio`, `tempo-resposta`, `tomp3`, `wiki`.
- **📖 Vida no Olimpo:** `afk`, `avaliar`, `dono`, `info`, `mediaavaliacoes`, `novidades`, `perfil`, `ping`, `ranking`, `redes`, `sugestao`.
- **⏳ Lembretes:** `cancelarlembrete`, `lembrete`, `meuslembretes`.
- **🧠 Inteligência e linguagem:** `dicionario`, `explicarmeme`, `gemini`, `gpt`, `reescrever`, `resumir`, `traduzir`, `transcrever`.

### 🎨 Espelhos de Morfeu

- **🎨 Filtros e montagens:** `ad`, `apagar`, `beautiful`, `blur`, `bobross`, `bolsonaro`, `cerebro`, `circulo`, `clown`, `comrade`, `conquista`, `contraste`, `espelhar`, `fake-chat`, `gay`, `glass`, `grayscale`, `greyscale`, `heart`, `impostor`, `invert`, `jail`, `passed`, `pixel`, `removebg`, `rip`, `sepia`, `sfundo`, `triggered`, `wasted`.
- **💫 Montagens de participantes:** `batslap`, `kiss`, `kissme`, `ship`, `shipme`, `slap`, `spank`.
- **🌑 Ilusões animadas:** `derreter`, `entidade`, `falha`, `fogogif`, `glitchgif`, `gun`, `naoolhe`, `ondasanim`, `rotacao3d`, `textopulsar`, `vhs`.

### 🖼️ Ateliê de Hefesto

- **🖼️ Criação e conversão:** `attp`, `brat`, `bratvid`, `figurinha`, `renomear`, `s`, `togif`, `toimg`, `tomp4`, `ttp`.
- **🏺 Museu de figurinhas:** `abrirpack`, `addfig`, `analisarpack`, `apagarpack`, `criarpack`, `denunciarpack`, `museu`, `reativarpack`, `usarpack`.

### 📥 Mensageiros do Olimpo

- **📥 Mídias e redes:** `facebook`, `igmp3`, `insta`, `pinterest`, `play`, `robloxstalk`, `tiktok`, `tiktok-audio`, `twitter`, `videocontrario`, `videolento`, `videorapido`.

### 🎙️ Ecos do Tártaro

- **🎙️ Vozes do Tártaro:** `demonio`, `esquilo`, `estourar`, `gigante`, `lento`, `rapido`, `reverso`, `robo`.

### ⚔️ Jornadas dos Heróis

- **⚒️ Caminhos profissionais:** `carreira`, `empregos`, `trabalhar`.
- **🏦 Tesouro dos heróis:** `carteira`, `depositar`, `sacar`, `transferir`.
- **🎓 Templo do conhecimento:** `diplomas`, `estudar`, `faculdade`, `faculdades`, `matricular`, `retomar`, `trancar`.
- **⚔️ Identidade do herói:** `ficha`, `registrar`, `testrpg`.

### 🔞 Véus de Dionísio

- **🔞 Interações íntimas:** `arrancarcalcinha`, `blow1`, `blow2`, `caranopeito`, `chuparpeito1`, `chuparpeito2`, `comer1`, `comer2`, `comer3`, `comer4`, `comer5`, `mamar`, `mostrapeito`, `pgpeito`, `sentada1`, `sentada2`, `sentada3`, `sentar1`, `sentar2`, `tapabunda1`, `tapabunda2`, `tesourar`.
- **🎭 Ações e reações:** `atirar1`, `atirar2`, `cartasecreta`, `chutar1`, `chutar2`, `matar1`, `matar2`, `morder`, `risada`.
- **🌙 Beijos e carícias:** `beijogostoso`, `beijolesbico`, `esfregar`, `lambida1`, `lambida2`, `lambidarosto1`, `lambidarosto2`, `rebolar1`, `rebolar2`.

### 💎 Dádivas do Olimpo

- **✨ Personalização VIP:** `alcunha`, `assinatura`, `badge`, `corvip`, `nomecustom`, `temavip`.
- **💎 Concessão de privilégios:** `darvip`, `listavip`.

### 👑 Trono de Hipnos

- **👑 Gestão do reino:** `comunicado`, `diagnostico`, `ia-interativa`, `limpar-chat`, `marcarsugestao`, `nuke`, `off`, `on`, `sairgrupo`, `seradm`, `set-prefix`, `versugestoes`.
- **📚 Catálogo de jogos:** `gartic-add`, `gartic-lista`, `gartic-remover`.

## Colisões preexistentes preservadas

O loader mantém a implementação final de nomes canônicos e o primeiro alias
registrado, salvo quando substituído por um nome canônico posterior. Alterar isso
poderia mudar comandos e permissões, portanto fica fora desta reformulação.

| Entrada disputada | Implementação efetiva |
|---|---|
| `encerrar-enquete` | `comandos/menu-brincadeiras/enquete.js:encerrar-enquete` |
| `morder` | `comandos/menu-adulto/comandos-adulto.js:morder` |
| `mordida` | `comandos/menu-brincadeiras/acoes.js:mordida` |
| `soco` | `comandos/menu-brincadeiras/acoes.js:soco` |
| `tapa` | `comandos/menu-brincadeiras/acoes.js:tapa` |
| `gay` | `comandos/menu-efeitos/efeitos-imagem.js:gay` |
| `flip` | `comandos/menu-brincadeiras/flip.js:flip` |
| `meme` | `comandos/menu-utilitario/meme.js:meme` |
| `meuslembretes` | `comandos/meuslembretes.js:meuslembretes` |

Por isso, `gay` anuncia o efeito arco-íris, e `tapa`/`soco` anunciam as interações
de brincadeiras. `encerrar-enquete` fecha a enquete de opinião; a implementação
administrativa com o mesmo nome continua sombreada, sem correção de lógica aqui.
`morder` e `mordida` continuam podendo levar a categorias distintas. A harmonização
desses nomes é uma melhoria futura que exige revisão própria de compatibilidade.

O menu anterior também anunciava `enquete-admin-ban`, mas o loader não registra
esse nome nem `banir`. A nova apresentação não anuncia essas rotas inexistentes.
O código interno de votação de banimento foi preservado; sua exposição exige
uma correção própria, fora do escopo dos menus.

## Estrutura e validação

`dados/menus-catalogo.js` contém somente conteúdo editorial;
`dados/menus-olimpo.js` lê o registro já carregado, filtra comandos ausentes e monta
mensagens. Os arquivos de menu são pontos de entrada compatíveis com o loader.
Não há varredura de arquivos, chamadas ao WhatsApp ou consultas de permissões ao
montar o catálogo. Apenas a leitura padrão do prefixo é reutilizada.

O inventário reflete o checkout local, inclusive o comando `diagnostico` ainda
não versionado. Se ele estiver ausente em outra instalação, será omitido do menu.
`sfundo` e `bolsonaro` permanecem registrados e são indicados como indisponíveis.
O menu não testa a saúde de APIs externas.

`node scripts/teste-menus-olimpo.js` verifica cobertura integral, comandos reais,
páginas, tamanho das mensagens, três prefixos, aliases, Arcontes, relacionamentos,
colisões e negativas de acesso a VIP e conteúdo adulto. Usa rede e Mongo bloqueados.
As suítes existentes de prefixo, ON/OFF, proteção, loader, Arcontes, histórico,
casamento, VIP e conexão também devem passar. Não há validação de WhatsApp real,
MongoDB de produção ou renderização em aparelho nesta execução.

## Arquivos desta reformulação

- `comandos/admin/menu-admin.js`
- `comandos/menu-adulto/menu-adulto.js`
- `comandos/menu-brincadeiras/menu-brincadeiras.js`
- `comandos/menu-dono/menu-dono.js`
- `comandos/menu-download/menu-download.js`
- `comandos/menu-efeitos/menu-efeitos.js`
- `comandos/menu-fig/menu-figurinhas.js`
- `comandos/menu-utilitario/menu-utilitario.js`
- `comandos/menu-vip/menu-vip.js`
- `comandos/menu.js`
- `comandos/menu-relacionamentos/menu-relacionamentos.js`
- `comandos/rpg/menu-rpg.js`
- `comandos/menu-modificador/menu-modificador.js`
- `dados/menus-catalogo.js`
- `dados/menus-olimpo.js`
- `scripts/teste-menus-olimpo.js`
- `docs/menus-olimpo.md`
