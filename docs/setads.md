# Anúncios automáticos do Hipnos

Comando exclusivo de grupos. Administradores, dono comprovado do grupo e donos do bot podem gerenciar e visualizar prévias. A identidade usa os helpers existentes de JID/LID; falhas de metadados ou resolução não autorizam. Os exemplos usam `/`; o prefixo atual e os aliases `ads`, `anuncios`, `anuncioauto` também funcionam.

| Comando | Efeito |
| --- | --- |
| `/setads` | Ajuda |
| `/setads criar Regras do grupo` | Cria texto pausado |
| `/setads criar` respondendo a foto/vídeo | Guarda mídia comum e legenda citada |
| `/setads criar Nova legenda` respondendo a mídia | Guarda mídia com legenda substituída |
| `/setads listar` ou `status` | IDs, tipo, estado, agenda, próxima/última execução e falhas |
| `/setads ver 1` | Envia prévia somente neste grupo, sem ativar agenda |
| `/setads intervalo 1 60` | Configura intervalo e pausa; substitui horário diário |
| `/setads horario 1 09:30` | Configura horário diário e pausa; substitui intervalo |
| `/setads retomar 1` | Valida agenda e calcula ocorrência futura |
| `/setads pausar 1` | Cancela futuras execuções |
| `/setads excluir 1` | Solicita código de confirmação, válido por 60 segundos |
| `/setads excluir 1 <codigo>` | Consome confirmação e apaga anúncio/mídia |

O código fica vinculado ao administrador, grupo, anúncio, geração e revisão; alteração, expiração, uso anterior ou troca de autor invalidam a confirmação. Uma execução já consumida para envio pode terminar após a pausa/exclusão; não há transação que permita cancelar simultaneamente a chamada ao WhatsApp.

## Persistência

Usa `MONGODB_URI` e `MONGODB_DB` (padrão `whatsapp`), sem novas dependências. Collection `anunciosAutomaticos`: `_id` composto por grupo e posição 1–5, `id`, `grupo`, `geracao` UUID, `revisao`, `estado` (criando/pronto/excluindo), `ativo`, `tipo`, `texto`, `midia`, `modo`, `minutos`, `horario`, `proximo`, `ultimo`, `criado`, `atualizado`, `autor`, `falhas`, `lease`, `leaseAte`, `execucao`, `entrega`. Datas de agenda são timestamps UTC; `autor` é apenas o número comprovado necessário à auditoria de configuração. Não se guarda histórico de conteúdos nem de destinatários.

Cinco posições fixas reservadas com insert atômico impedem ultrapassar cinco anúncios mesmo com criações concorrentes. IDs só têm significado dentro do grupo e podem ser reutilizados após exclusão; UUID distingue gerações. Buffers não ficam no documento. Fotos/vídeos ficam no bucket GridFS `anunciosMidias` (collections `.files` e `.chunks`) e a referência ObjectId fica no anúncio. Sem URLs temporárias do WhatsApp nem arquivos locais como armazenamento definitivo. Índice de consulta: estado/ativo/próximo. `anunciosControles` contém confirmações com TTL e espaçamento global/por grupo.

Upload aborta em 120 segundos. Reservas de criação abandonadas após 15 minutos e tombstones de exclusão são recolhidos em lotes pelo agendador. A limpeza reserva lease, apaga arquivo/chunks (inclusive uploads incompletos) e só então libera a posição. Falha de limpeza conserva tombstone para tentar novamente após expirar o lease. Enquanto desconectado, a limpeza aguarda reconexão ou outra operação de exclusão/criação. A quota de mídia consome o mesmo banco que a sessão do bot; avalie o espaço disponível.

## Agenda e entrega

Timer único por processo, a cada 5 segundos, aberto somente no evento Baileys `connection=open`; fechado no `close` e na substituição do socket. Reconexões atualizam socket sem duplicar timer. Rotinas de um mesmo processo não se sobrepõem; Mongo coordena múltiplos processos. Nenhuma dependência do OFF: anúncios ativos continuam, enquanto os comandos de configuração permanecem atrás da barreira existente (não donos são bloqueados durante OFF). Mensagens próprias continuam ignoradas pelas proteções e pelo ranking existentes.

Intervalo: 15–1440 minutos a partir de ativação/última tentativa. Diário: `HH:MM` no fuso IANA `America/Sao_Paulo`, calculado com `Intl`, calendário local e conversão de fuso, sem fixar UTC-3 ou depender do fuso do Render. Horário já passado avança ao próximo dia. Novos anúncios estão pausados e sem agenda. Alterar agenda exige retomar explicitamente.

Em boot/reconexão, todas as ocorrências vencidas são avançadas para o futuro antes de habilitar envio. Nunca se recupera uma fila de anúncios antigos. Durante operação, ocorrência atrasada mais de 60 segundos também é descartada. Ocorrências simultâneas são espaçadas: pelo menos 10 segundos entre tentativas globais, 30 segundos por grupo, por reservas atômicas persistentes; colisões são adiadas por 30 segundos. Em grande volume, a hora efetiva pode atrasar e não há garantia de justiça entre grupos. Tempo consumido pelo preparo de mídia também afeta a entrega.

Cada ocorrência tem identificação geração + timestamp e lease de 120 segundos. O worker revalida estado/revisão/lease/conexão depois do preparo. Antes de chamar WhatsApp, uma atualização atômica consome a ocorrência, avança `proximo` e registra entrega `incerta`. Outro worker com lease expirado não reenvia essa ocorrência. Uma preparação abandonada pode ser retomada dentro da janela; fora dela é descartada. Grupos são validados pelo JID e pelos metadados antes do envio. Não há envio privado, troca de grupo ou menções; somente texto/foto/vídeo e legenda, com miniatura vazia para evitar conversões nativas.

**Não existe garantia exactly-once entre Mongo e WhatsApp.** Registrar a ocorrência antes do envio favorece evitar duplicatas: queda antes da chamada pode perder a ocorrência. Queda após aceitação e antes da confirmação deixa entrega incerta, sem reenvio. Sucesso do `sendMessage` confirma apenas a chamada, não leitura/recebimento em aparelhos. O identificador de execução fica no documento, sem criar histórico ilimitado.

## Limites e falhas

- Até 5 anúncios por grupo, incluindo reservas/tombstones ainda não liberados.
- Texto/legenda: 3000 pontos de código Unicode; fotos até 8 MiB, vídeos até 16 MiB.
- Fotos JPEG/PNG e vídeos com assinatura MP4 e marca reconhecida; validação de assinatura não substitui decodificação completa ou antivírus. Outros formatos não são convertidos.
- Citações são normalizadas (ephemeral, documentWithCaption, edited/associatedChild e envelopes suportados pelo Baileys). Visualização única é recusada **antes** da normalização e após eventual renovação.
- Download limitado por bytes recebidos, não só `fileLength`; mídia 404/410 pode pedir uma renovação via `updateMediaMessage`. Falha exige cópia recente. Buffers limitados em memória antes de persistir.
- Metadados: prazo de 15s; leitura/preparo: 30s; download: até 30s para obter stream e mais 30s para consumi-lo; envio: 60s. O fetch interno do Baileys rc14 não aceita cancelamento nesse helper; stream que chegar após o prazo é descartado. Timeout de envio é ambíguo e não cancela uma chamada já aceita; sucesso tardio não provoca retry da ocorrência. Operações Mongo usam timeout de socket de 30s.
- Falhas de preparo/envio/confirmação: avanço da agenda e backoff de pelo menos 15min, depois 30min; terceira falha consecutiva pausa. `retomar` reinicia o contador. Não há retry imediato da mesma ocorrência.
- Falha Mongo impede reservar/consumir e enviar. Logs contêm apenas etapas fixas, sem JIDs, conteúdo, códigos, URLs, buffers ou erros externos. `status` mostra falhas; comandos respondem com erros amigáveis. Não se envia aviso automático repetido ao grupo em cada falha.
- Falhas do ciclo/banco usam backoff local de 5s até 5min, em vez de repetir consultas/logs em todo tick. Reconexão permite uma nova tentativa imediata.

## Verificação offline

`node scripts/teste-setads.js`: 135 verificações de conteúdo, envelopes, limites, armazenamento simulado, fuso/calendário, permissões, leases, concorrência, falhas e recuperação; também passou com `TZ=Asia/Tokyo`. `node scripts/teste-setads-storage.js`: 28 verificações do contrato Mongo/GridFS com mocks do driver. `node scripts/teste-setads-conexao.js`: 9 verificações do listener de conexão real em VM.

`scripts/teste-on-off.js`: 76 testes do listener real em VM, incluindo prefixo/aliases/OFF, criação de fotos/vídeos e isolamento de mensagens próprias. Loader: 580 entradas. Também passaram as suítes existentes de lembrete, meuslembretes, prefixo, totag, proteção do bot, antigolpe, limitecaractere, antiflood, antilinkhard, moderação de figurinhas, adv, advertencias-evolucao, comunicado e enquetes-nativas. Sintaxe de 15 arquivos JavaScript e `git diff --check` aprovados. O `npm test` do projeto continua sendo um placeholder; foram usados os scripts de teste existentes.

Não houve conexão real com Mongo/GridFS, WhatsApp, aparelhos ou Render; nenhuma mensagem real ou deploy. Os testes de armazenamento simulam o contrato do driver, sem comprovar conexão, quota, permissões do cluster ou entrega real.

## Arquivos desta implementação

Criados: `anuncios.js`, `comandos/admin/setads.js`, `dados/ads-tempo.js`, `dados/ads-storage.js`, `dados/ads-midia.js`, `dados/ads-erro.js`, `dados/ads-prazo.js`, `scripts/helpers/ads-fake.js`, `scripts/teste-setads.js`, `scripts/teste-setads-storage.js`, `scripts/teste-setads-conexao.js` e este documento.

Modificados: `bot.js` (somente lifecycle do socket), `comandos/admin/menu-admin.js`, `scripts/teste-loader.js` e `scripts/teste-on-off.js`. Sem alterações de dependências, de `/comunicado` ou de sistemas de moderação.
