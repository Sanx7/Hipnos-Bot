# Exceção restrita de links TikTok — 25/10/2026

## Causa e escopo

Os registros de produção fornecidos pelo proprietário identificaram `antilinkhard/bloqueado` antes do handler TikTok, em lote único. A causa desse incidente é a classificação genérica de links: `dados/moderacao-antilinkhard.js` examinava o texto antes do roteamento e não distinguia links usados como argumento de um comando de download. O antilink básico em `bot.js` também pode bloquear a mesma mensagem posteriormente.

A identificação PN/LID e o tamanho do grupo não são critérios da exceção. A investigação anterior do processamento de lotes foi preservada, mas não é a explicação desses registros específicos de produção.

Outros downloads também recebem URLs externas: Instagram/Reels, Facebook, Twitter e Pinterest, por exemplo. Eles passam pelas mesmas barreiras e podem apresentar incompatibilidade semelhante. Foram relatados antes de ampliar o escopo; **não receberam exceção**. `/play` usado somente com termos de busca não precisa de exceção de URL.

## Política implementada

O helper compartilhado `dados/links-download-autorizados.js` valida localmente o texto atual extraído pelo mesmo módulo do roteador. A mensagem inteira deve conter o comando e exatamente uma URL, separados por espaços ou tabulação. Texto adicional, outra URL, quebra de linha ou controle não recebe exceção.

O prefixo é obtido pelo módulo existente e o nome é reconhecido pelo resolvedor real. A rota precisa existir no registro, apontar para `tiktok` ou `tiktok-audio`, ter função `executar` e ser o próprio nome ou um alias declarado desse mesmo objeto. Nenhum comando inexistente, nome semelhante ou rota de outra plataforma é autorizado.

Comandos e aliases atuais contemplados:

| Comando | Aliases |
| --- | --- |
| `tiktok` | `tt`, `ttk`, `tik-tok`, `tiktokdl` |
| `tiktok-audio` | `tiktok-aud`, `tiktok-mp3`, `tt-audio`, `tk-audio` |

A política usa o prefixo atual, incluindo a compatibilidade com barra legada quando já habilitada pelo projeto. Não existe liberação genérica para texto iniciado por `/`.

Formatos autorizados:

- Somente **HTTPS**.
- Hosts exatos: `tiktok.com`, `www.tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com`.
- Em `tiktok.com`/`www`, caminhos `/@usuario/video/ID` ou `/t/CODIGO`, com barra final opcional. IDs de vídeo têm de 10 a 25 dígitos; nomes e códigos usam apenas os caracteres ASCII previstos no helper.
- Em `vm`/`vt`, somente `/CODIGO`, com barra final opcional.
- Parâmetros de compartilhamento/rastreamento explicitamente permitidos: `_t`, `_r`, `is_from_webapp`, `sender_device`, `web_id`, `is_copy_url`, `share_app_id`, `share_item_id`, `share_link_id`, `timestamp`, `u_code`, `checksum`, `utm_source`, `utm_medium`, `utm_campaign`. Valores têm formato e tamanho limitados; nomes repetidos, URLs embutidas e escapes não são aceitos.

A autoridade bruta e a URL interpretada são verificadas. São rejeitados credenciais, portas explícitas (inclusive `:443`), fragmentos, barras invertidas, domínios semelhantes/sufixos falsos, Unicode no endereço e normalização suspeita de caminho como `..`. Não é utilizado `includes('tiktok.com')` como autorização.

Esses formatos são uma lista restrita para **exceção de moderação**, não um validador universal de toda URL existente na plataforma. Perfil, login, rotas desconhecidas, formatos de foto não previstos ou parâmetros novos **não recebem exceção**. Em um grupo com antilinkhard ativo, isso conserva a política normal de bloqueio/punição; por isso é importante usar um link suportado no teste real e revisar exemplos legítimos de formatos novos antes de ampliar a lista.

## Integração e permissões

No antilinkhard, uma mensagem elegível retorna como **não tratada por essa regra**, antes de reservar uma infração ou participante. As mensagens fora do contrato continuam no fluxo original de configuração, identidade, proteção de donos/admins/bot, reservas, remoção confirmada e auditoria.

O antilink básico consulta a mesma política antes de apagar a mensagem por ser link. Sua configuração e detecção original foram preservadas. A validação compartilhada evita que o hard permita e o básico bloqueie o mesmo argumento legítimo.

A exceção autoriza somente a **classificação de link**, não a execução do comando. Antiflood, antigolpe, limite de caracteres, figurinhas, antipagamento, blacklist, mute, OFF, somente admin e controles de Arcontes permanecem nos seus pontos e contratos existentes. Membro comum pode executar o download onde o comando já é permitido. Metadados ausentes não criam privilégio em grupo restrito. Os testes verificam que uma mensagem elegível não chega ao handler quando outra barreira a consome ou nega acesso.

Nenhuma configuração de grupo, coleção MongoDB, autorização real ou mecanismo de punição foi alterado. Não há consulta a nome de grupo ou identificadores de participantes na política da exceção.

## Encurtadores e limites de segurança

Foi inspecionada a biblioteca instalada `@tobyg74/tiktok-api-dl`: a versão v1 faz HEAD e usa o endereço final para extrair o ID; as alternativas v2/v3 usam provedores externos. A moderação **não faz HTTP, DNS, HEAD nem resolução de redirecionamentos**, evitando introduzir uma nova superfície de requisições a links recebidos. Os encurtadores admitidos são rotas estritas nos hosts oficiais citados, sem parâmetros de redirecionamento.

O comportamento de redirecionamento dos provedores/downloaders existentes não foi modificado. Esta correção valida a URL inicial para fins de moderação; **não comprova a cadeia real de redirects, o conteúdo remoto nem a segurança de URLs de mídia retornadas por terceiros**. Esses comportamentos preexistentes continuam dependentes da biblioteca/provedores e não foram testados em rede. Não se deve interpretar a exceção como garantia sobre o conteúdo de qualquer vídeo.

O envio repetido de comandos válidos continua dependendo das proteções de spam configuradas no projeto. A exceção não substitui antiflood nem acrescenta direitos de administrador ao remetente.

## Diagnóstico preservado

`HIPNOS_DIAG_TIKTOK` continua desativado por padrão, com os limites e dados seguros da investigação anterior. O módulo usa uma associação fraca entre mensagem e rastro para registrar a decisão do hard, que ocorre antes do contexto individual de execução.

- `excecao_antilinkhard/ok`: o formato/registro recebeu exceção na classificação do hard.
- `excecao_antilink_basico/ok`: recebeu exceção na classificação do básico.
- `antilinkhard/bloqueado` ou `antilink_basico/bloqueado`: a regra consumiu a mensagem.
- `reconhecido`, `handler`, `fonte`, `download`, `envio_midia`: os estágios da execução permanecem disponíveis.

Uma exceção não significa que o handler executou: confira os eventos seguintes. Nenhum desses registros inclui URL, argumentos, números, LIDs, nomes de grupos, tokens ou credenciais. A associação fraca não cria um cadastro permanente de participantes.

## Testes

`scripts/teste-links-download-autorizados.js` adiciona **130 casos offline**. São utilizados o registro real dos comandos, o listener extraído de produção em VM e o módulo real do antilinkhard, com coleções e transporte fictícios. A remoção simulada retorna status `200`; o teste impede gravação de blacklist por esse fluxo.

| Cenários obrigatórios | Cobertura |
| --- | --- |
| Hard, básico, ambos ou nenhum | Download permitido, sem exclusão/remoção nem reservas de infração. |
| Aliases e prefixos | Dez nomes/aliases com `/`, `!`, `#` e `$`; rota inexistente, alias não declarado e prefixo divergente recusados. |
| Links comuns e comandos inexistentes | Mantêm classificação/punição fictícia pelo hard. |
| Domínios falsificados/semelhantes, credenciais, portas e Unicode | Não recebem exceção. |
| Duas URLs, outra plataforma, texto extra e linhas ocultas | Não recebem exceção. |
| Membro comum PN/LID e metadados incompletos | Download público continua permitido; grupo restrito sem prova continua negando. |
| Outra proteção ativa | OFF, mute e mensagens marcadas por flood/golpe/limite/figurinhas não chegam ao handler. As suítes próprias exercitam essas implementações. |
| Lote misto | Controle e download autorizado continuam processados. |
| Logs seguros | Exceção e bloqueio distinguíveis sem conteúdo ou identificadores privados. |

No desenvolvimento, uma expectativa de punição do hard usava o TLD reservado `.invalid`, que o detector preexistente não classifica como domínio público. A fixture foi corrigida para um subdomínio de `example.com`, igualmente fictício para o teste, sem fazer requisições. Não se alterou o detector nem a punição para fazer esse caso passar. A recusa de exceção para URLs suspeitas é verificada separadamente da classificação original de domínios do hard.

Os testes anteriores de contexto foram atualizados somente para o novo contrato: o caso que exigia bloquear um TikTok válido passa a exigir o bloqueio de uma mensagem com link adicional. Suas verificações de lote, PV, grupos, falhas e demais barreiras permanecem. O helper de fixture pode ser reutilizado sem executar a suíte ao ser importado.

Resultado final da bateria completa: **149 suítes encontradas; 143 executadas e aprovadas; zero reprovadas e zero timeouts**. Foram registrados **4.212 casos/verificações individuais aprovados**, além de cinco suítes integradas aprovadas sem contagem individual. O total não soma repetições feitas durante o desenvolvimento. A compilação dos **528 arquivos JavaScript** e `git diff --check` passaram.

Entre as regressões aprovadas: exceção de links (130), contexto TikTok (51), diagnóstico (10), antilinkhard (97), antilink básico (8), ON/OFF (86), proteção do bot (48), donos (72), Arcontes (98), antiflood (78), antigolpe (198), limite de caracteres (167), TikTok (18), downloads extras (39), menus (54), aliases (33) e loader integrado. As demais suítes offline também foram executadas pelo auditor isolado.

As seis integrações reais históricas não foram executadas: `teste-acoes`, `teste-play`, `teste-nasa-integracao`, `teste-mongo-conexoes-real`, `teste-jornal-mongo-real` e `teste-rpg-integracao-mongo`. Essa exclusão impede tratar a bateria como validação de WhatsApp, provedores ou banco reais.

## Arquivos desta correção

| Arquivo | Alteração |
| --- | --- |
| `dados/links-download-autorizados.js` | Novo helper compartilhado de validação. |
| `dados/moderacao-antilinkhard.js` | Exceção restrita antes da classificação/punição. |
| `bot.js` | Mesma exceção no antilink básico; processamento de lotes preservado. |
| `dados/diagnostico-tiktok.js` | Eventos seguros e associação fraca por mensagem. |
| `scripts/teste-links-download-autorizados.js` | Nova suíte de 130 casos. |
| `scripts/teste-tiktok-contexto.js` | Fixture compartilhada e expectativas do novo contrato. |
| `docs/correcao-antilink-downloads-2026-10-25.md` | Este relatório. |

Todas as alterações locais anteriores permanecem presentes. Nenhum commit, push, deploy, reinício, acesso a WhatsApp/MongoDB real ou migração real foi executado. `.env`, `auth/` e dados privados não foram alterados.

## Envio manual e validação no Swag

Enviar juntos os quatro arquivos de produção desta correção: `bot.js`, `dados/moderacao-antilinkhard.js`, `dados/links-download-autorizados.js` e `dados/diagnostico-tiktok.js`. O helper novo é obrigatório. Manter também as versões de `comandos/menu-download/tiktok.js` e `tiktok-audio.js` da investigação anterior; se elas ainda não tiverem sido aplicadas, incluir esses dois arquivos no pacote. Testes e documentação não são necessários para executar o bot.

O operador deve seguir seu procedimento de carregamento/reinício, fora desta tarefa. Com **antilinkhard mantido ativo**, testar no Swag um link HTTPS suportado usando `/tiktok`, `/tt` e `/tiktok-audio`, respeitando o prefixo e as permissões atuais. Confirmar mídia no aplicativo e repetir no PV. Se o básico também estiver ativo, mantê-lo ativo durante a verificação.

Se necessário, habilitar temporariamente `HIPNOS_DIAG_TIKTOK=true` pelo painel, sem editar `.env`. Fazer uma tentativa isolada e procurar `excecao_antilinkhard/ok`, depois reconhecimento, handler, download e `envio_midia/ok`. Com o básico ativo, procurar também `excecao_antilink_basico/ok`. Conferir se outra barreira bloqueou a execução e não desativá-la automaticamente. Encerrar a coleta desativando a variável conforme o procedimento do painel.

**Não testar links maliciosos, links extras ou comandos inexistentes no grupo real:** a punição do hard continua ativa. Esses cenários foram testados com participantes fictícios. Compartilhar somente os registros seguros necessários, sem logs de autenticação/sessão.

**A confirmação da correção depende desse teste real no Swag. Testes offline aprovados não comprovam entrega em produção.**

## Validação de produção informada pelo proprietário

Após a aplicação manual na LatamHost, o proprietário confirmou `/tiktok` no PV e no Swag, `/tiktok-audio` no Swag, a exceção do antilinkhard e o download/envio de mídia concluídos. Informou também `HIPNOS_DIAG_TIKTOK=false` em produção. Essas confirmações foram fornecidas pelo proprietário; o agente não acessou a hospedagem nem executou os comandos reais.

Permanece pendente a validação específica, em produção, da proteção contra links comuns. O sucesso dos downloads não substitui essa verificação. O backup no GitHub não implica novo deploy ou reinício do bot.
