# Reações automáticas por palavras

Cada grupo tem seu próprio cadastro, identificado pelo JID completo do grupo.
O prefixo abaixo é um exemplo; os comandos seguem o prefixo configurado no bot.

```text
/emojiregistrar ana ❤️
/emojiregistrar bom dia ☀️
/emojiregistrar ana 👋
/emojiremover bom dia
/emojilista
```

O terceiro exemplo atualiza o emoji de `ana`. Qualquer membro do grupo pode
cadastrar um termo novo. Somente seu criador, administradores ou donos do bot
podem atualizar/remover um registro existente, usando a identificação PN/LID já
adotada pelo projeto. Falha de metadados ou identidade sem comprovação não
autoriza alterações. A lista é pública dentro do grupo. Os comandos também
aparecem no menu admin; os controles globais ON/OFF e somente-admin do roteador
permanecem inalterados.

Cada registro novo armazena `criador` como `pn:<numero comprovado>` ou, quando
o membro só tem LID identificado nos metadados, `lid:<identificador>`. A autoria
original não muda quando um administrador ou dono atualiza o emoji. Aliases
comprovados nos metadados permitem reconhecer o criador entre PN e LID; números
iguais em namespaces diferentes ou aliases ambíguos não comprovam autoria.
Registros antigos sem criador (ou com identificador inválido) só podem ser
alterados/removidos por administradores ou donos, sem atribuição retroativa.

Termos: 1–60 caracteres, até cinco palavras, letras/números, espaços, hífen e
apóstrofo. Sem regex fornecida pelo usuário. Aceita um único emoji, incluindo
bandeiras, tons de pele e sequências com ZWJ. Limite de 50 termos por grupo;
atualizar um cadastro continua permitido quando o limite está preenchido.

O texto é normalizado em Unicode NFC, sem distinguir maiúsculas/minúsculas.
Acentos continuam significativos: `joão` não é `joao`. `ana` não corresponde a
`banana`, `anabela` ou `ana1`. Nomes compostos aceitam espaços/quebras de linha.
Havendo vários termos, vence o primeiro no texto; na mesma posição, o termo mais
longo. A reação usa `sendMessage(jid, { react: { text: emoji, key: msg.key } })`.

A integração segue o caminho de texto livre do roteador existente de `bot.js`:
depois de moderação, mute, manutenção e prefixo, antes de palpites/IA. Não
consome a mensagem nem aguarda a consulta/envio; jogos e IA seguem normalmente.
Mantém o roteamento existente da primeira mensagem do lote, sem refatorar o
processamento dos demais sistemas. Mensagens consumidas antes desse caminho,
como votos de VOUC e a consulta `prefixo`, não recebem a reação adicional.
OFF segue a autorização já existente: bloqueia interações de membros comuns;
donos continuam autorizados. Nenhum comportamento anterior de OFF foi alterado.

Ignora mensagens do bot, comandos (inclusive prefixo vazio/comando desconhecido),
histórico `append`, mensagens sem texto, eventos de protocolo e mensagens com
mais de dois minutos. Legendas extraídas pelo roteador também contam como texto.
Mensagens acima de 4096 unidades UTF-16 são ignoradas por este recurso.

## Armazenamento e limites

Reutiliza a conexão e a coleção de `configuracoes-grupo.js`, respeitando
`MONGODB_URI`, `MONGODB_DB` e `MONGODB_COLLECTION_CONFIG_GRUPO` existentes.
Não cria outro MongoClient, novas dependências ou índices. No documento existente
com `grupo_id`, grava somente `reacoes_palavras: [{ termo, emoji, criador }]` e
`reacoes_versao`. Welcome, IA, banner e demais campos não são sobrescritos.
Atualizações usam comparação de versão (CAS), até cinco tentativas, preservando
o limite mesmo em cadastros simultâneos. A autorização é reavaliada sobre o
registro atual a cada tentativa, sem depender do cache. Documento inválido não
é substituído. Não há migração automática de autoria dos registros antigos.

O cache dura 30 segundos e contém até 500 grupos, incluindo resultados vazios.
Consultas simultâneas do mesmo grupo são agrupadas; falhas recebem espera de
10 segundos. Alterações invalidam o cache local; outro processo percebe em
até 30 segundos. Uma leitura já em andamento pode usar o cadastro anterior.

Para evitar sobrecarga, há uma operação de reação em andamento por grupo,
até 16 grupos simultâneos, intervalo de um segundo por grupo entre tentativas
de envio e nenhum backlog. Mensagens que chegam enquanto o grupo está ocupado
podem ficar sem reação. A automação é um recurso acessório de melhor esforço.

Cada chave `grupo:mensagem` é reservada antes do envio, em memória, por dez
minutos (até 5000 chaves). Reconexões no mesmo processo não limpam esse estado;
erros ou resultados incertos não são reenviados automaticamente. Reinícios,
expiração ou expulsão da chave pelo limite do cache encerram essa proteção;
não há promessa de envio exatamente uma vez entre processos/reinícios.
Os logs novos usam mensagens fixas, sem texto, termos, JIDs ou erros crus.

## Validação e publicação

```sh
node scripts/teste-reacoes-palavras.js
node scripts/teste-on-off.js
node scripts/teste-loader.js
node scripts/teste-compatibilidade-canvas.js
node scripts/teste-npm-shell-sem-canvas.js
```

Os scripts usam URIs Mongo vazias e injeção de coleções/socket; o teste do novo
módulo bloqueia conexões de rede. Os testes de compatibilidade que incluem o
modo normal precisam do Canvas já instalado localmente, sem reinstalação.
Não houve conexão com WhatsApp/MongoDB reais nem validação na LatamHost.

Resultados offline: 23 cenários do módulo, 85 testes ON/OFF, loader com 597
entradas, compatibilidade Canvas nos dois modos e 16 verificações do shell.
Regressões adicionais: 82 verificações de conexões MongoDB, 78 de antiflood,
116 de limite de caracteres e 178 de antigolpe. A comparação com HEAD no teste
Mongo permite somente as três linhas de integração das reações em `bot.js`;
todo o restante do arquivo continua sujeito à comparação integral.

Para publicar: revise o diff e os resultados offline, selecione somente os
arquivos desta alteração e confirme que `.env` e `auth/` continuam fora do Git.
Faça commit/push apenas quando decidir publicar. Na LatamHost, aplique o código
e reinicie em uma janela de manutenção, preservando as variáveis atuais,
inclusive `DISABLE_CANVAS=true`, e o armazenamento Mongo existente. Esta mudança
não exige reinstalação de dependências. Depois, valide os três comandos em um
grupo de teste autorizado. Nenhum commit/push ou deploy é feito por estes testes.
