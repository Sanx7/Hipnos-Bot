# Blacklist por número digitado

`addblacklist` e `remblacklist` continuam exclusivos dos donos do bot, usando
a verificação existente de identidade JID/LID. O prefixo abaixo é um exemplo;
o roteador continua aceitando o prefixo configurado.

```text
/addblacklist 55139757976987
/addblacklist +55 (13) 97579-76987
/remblacklist +55 (13) 97579-76987
```

Aceita um único número internacional, com DDI e DDD, de 10–15 dígitos,
começando por 1–9. `+` inicial, espaços, parênteses balanceados em grupos
numéricos e hífens são normalizados. Letras, JIDs digitados, múltiplos números
e entradas malformadas são recusados com orientação. A validação é sintática;
não verifica se a conta existe no WhatsApp nem corrige números por país.

Menções e replies continuam funcionando e têm prioridade sobre o argumento
digitado. A extração usa os helpers existentes, incluindo legendas normalizadas.
O número digitado vira `<digitos>@s.whatsapp.net`; LIDs de menções/replies
continuam sendo resolvidos pelos metadados/mapeamento de sessão existentes.

A blacklist permanece global em `comandos/dados/blacklist.json`, lida pelos
mesmos comandos e pelo monitor de entrada de membros em `bot.js`. Não foi
criada outra lista nem migrado armazenamento para MongoDB. A integração Mongo
da resolução de identidade/sessão permanece intacta.

Pode cadastrar pessoas que ainda não estão no grupo. Nesse caso só grava a
lista: o monitor existente poderá agir numa entrada futura. Para um número
digitado de membro comprovado nos metadados, usa o JID/LID do participante ao
tentar a remoção atual. Não tenta remover em chats privados ou quando o número
digitado não foi identificado como participante. A confirmação informa apenas
o cadastro do número, sem afirmar uma expulsão não confirmada.

Bot e donos permanecem protegidos, inclusive após resolução de um LID via
sessão. Identidade do bot impossível de distinguir bloqueia o cadastro.
Números normalizados não são duplicados; leitura/deduplicação/escrita não têm
`await` entre elas no processo. Não foi adicionada coordenação de arquivos
entre processos. `remblacklist` elimina todas as ocorrências das variantes
que o fluxo existente identifica. JSON inválido ou falha de leitura/escrita
interrompe a operação, sem confirmação de sucesso ou tentativa de remoção.

## Testes offline

- `node scripts/teste-blacklist-numero.js`: 20 cenários, JSON em memória,
  socket e mapeamento de sessão simulados, conexões de rede bloqueadas.
- `node scripts/teste-protecao-bot.js`: 48 testes.
- `node scripts/teste-on-off.js`: 85 testes.
- `node scripts/teste-loader.js`: 597 entradas preservadas.
- `node scripts/teste-compatibilidade-canvas.js`: inicialização e registro
  preservados nos modos normal e de compatibilidade.

Também foram verificados sintaxe e `git diff --check`. Nenhum teste novo usa
o arquivo real de blacklist ou WhatsApp/MongoDB de produção. Não houve
reinstalação de dependências, alteração do `.env` ou do modo Canvas.

## Publicação manual na LatamHost

Revise o diff e faça commit/push somente quando decidir publicar, selecionando
os dois comandos, o menu admin, o helper, o teste e este documento. Não inclua
`.env`, `auth/`, credenciais ou arquivos de dados da hospedagem.

Antes de atualizar, preserve uma cópia do `comandos/dados/blacklist.json` atual
da hospedagem em local privado e mantenha seu armazenamento persistente. Aplique
somente o código desta mudança, sem sobrescrever esse JSON com a cópia do Git.
Reinicie o serviço mantendo suas variáveis, inclusive `DISABLE_CANVAS=true`.
Não é necessário reinstalar dependências. Valide os comandos em grupo de teste
autorizado; adicionar um membro presente pode acionar sua remoção, como já
ocorria antes. Nenhum commit, push ou deploy é executado pelos testes.
