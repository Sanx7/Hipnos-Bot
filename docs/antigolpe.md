# Antigolpe

Configuração por grupo: desligado, modo `alerta`, sensibilidade `media`, sem exceções. Administradores e donos usam `antigolpe`, `antiscam` ou `antifraude` com o prefixo atual.

```
/antigolpe on
/antigolpe off
/antigolpe status
/antigolpe modo alerta|apagar|adv
/antigolpe sensibilidade baixa|media|alta
/antigolpe permitir sorteio oficial
/antigolpe remover sorteio oficial
/antigolpe excecoes
```

## Pontuação e calibração

Normalização NFKD, remoção de marcas de acento e pontuação, minúsculas e espaços uniformes. São reconhecidas expressões completas, não palavras genéricas isoladas. Cada categoria pontua no máximo uma vez por mensagem:

| Categoria | Peso | Exemplo de evidência |
| --- | ---: | --- |
| Credenciais | 4 | Pedido de senha ou código de verificação/SMS |
| Identidade | 3 | Identificação como equipe de suporte/WhatsApp/administração |
| Financeiro | 3 | Dinheiro fácil, lucro absurdo ou retorno garantido |
| Premiação | 3 | Resgate de prêmio, seleção ou saque liberado |
| Pagamento | 3 | Taxa/Pix antecipado para liberar ou resgatar |
| Dados | 3 | Pedido de CPF, dados pessoais/bancários ou cartão |
| Verificação | 3 | Ordem para verificar, validar ou atualizar sua conta |
| Urgência | 2 | Conta será bloqueada, clique agora ou prazo artificial |
| Link | 2 | Link reconhecido pelo detector existente junto a um sinal específico |

| Sensibilidade | Médio | Alto |
| --- | ---: | ---: |
| baixa | 8 | 11 |
| media | 5 | 8 |
| alta | 4 | 7 |

É obrigatório haver pelo menos duas categorias e pelo menos um sinal específico (credenciais, financeiro, premiação, pagamento, dados ou verificação). Identidade, urgência e links sozinhos não bastam. Um link não indica reputação: não há consulta de URL, lista fixa de domínios, OCR ou download.

Calibração inicial no corpus sintético de `scripts/teste-antigolpe.js`: os exemplos legítimos do pedido permanecem baixos nas três sensibilidades. Prêmio + link soma 5 (baixo em baixa, médio nas demais); promessa financeira + urgência + link soma 7 (alto somente em alta); pedido de código + falsa identidade + urgência + link soma 11 (alto em todas). Esses testes não estimam precisão no tráfego real.

Frases de negação, relatos e avisos educativos reconhecidos são ignorados localmente; citações entre aspas precedidas por marcadores educativos reconhecidos são omitidas. Outra frase perigosa na mesma mensagem continua sendo analisada. Conteúdo de `quotedMessage` não é analisado. Negar ser um golpe não libera uma solicitação perigosa.

## Exceções

Até 20 expressões de 8–80 caracteres, com ao menos duas palavras de três caracteres e um termo não genérico. Só letras, espaços, apóstrofos e hífens; números, expressões regex, termos genéricos e referências a credenciais/dados sensíveis são recusados. Inclusão atômica no Mongo evita ultrapassar o limite em comandos concorrentes.

A correspondência é literal, normalizada, com limites de palavras e na mesma frase da premiação. `sorteio oficial` não corresponde a `sorteio oficialissimo`. Uma exceção remove exclusivamente o sinal de premiação quando não existe sinal de credenciais, dados, pagamento, financeiro ou verificação em nenhuma frase analisada. Não funciona como permissão geral para a mensagem. Não altera outras proteções.

## Ações, prioridade e persistência

Risco baixo não gera efeito. Risco médio solicita revisão dos administradores, sem exclusão/advertência. Alto em `alerta` também só solicita revisão. Alto em `apagar` tenta excluir; alto em `adv` tenta excluir e registra uma advertência central. O limite de `/setlimiteadv` e a rotina de ban/blacklist/arquivo são os existentes; status 200 é exigido antes de confirmar expulsão. Bot, administradores e donos identificados são ignorados nesta versão, inclusive para alertas.

Ordem: antilinkhard → antiflood → limite de caracteres → figurinhas → antigolpe → demais processamentos. Eventos tratados por regras anteriores são ignorados. Alto em modo punitivo, com bot administrador, não chega ao roteador, jogos ou IA, inclusive se a tentativa de exclusão falhar. Alerta e risco médio retornam ao fluxo normal, incluindo as demais proteções. Ranking permanece ativo. A automação roda durante OFF; o gate existente bloqueia configuração para não donos.

Cooldown compartilhado de 60 segundos por telefone comprovado e grupo para avisos/advertências; durante esse período, novas mensagens de alto risco em modo punitivo continuam sendo apagadas, sem nova advertência ou expulsão. Um alerta médio também ocupa o cooldown: uma mensagem alta subsequente pode ser apagada, mas não receber nova advertência até expirar. Grupos/usuários diferentes são independentes.

MongoDB: `configAntigolpe` mantém estado, modo, sensibilidade, termos confiáveis e auditoria da configuração; `ocorrenciasAntigolpe` guarda identificador e decisão de bloqueio com TTL de 24h; `cooldownsAntigolpe` guarda grupo/telefone e vencimento com TTL de 60s. A comparação atômica de vencimento não depende da execução do coletor TTL. Não são armazenados texto analisado, senhas, códigos, imagens, URLs ou dados bancários. Logs usam somente mensagens fixas. Avisos não citam o original nem identificam o autor; mencionam apenas administradores humanos.

A fila limitada e a deduplicação em memória são compartilhadas com limitecaractere, com até 10000 eventos e retenção de dois minutos. Reservas Mongo evitam repetir efeitos após reinícios ou entre processos. Apenas eventos `notify` recentes, com identificador, participante e timestamp válidos, são analisados; atraso superior a 60s é ignorado. Falhas de configuração/identidade/Mongo não concedem permissão nem interrompem o listener.

## Limitações

Heurística inicial para português, sujeita a falsos positivos e evasões por paráfrases, obfuscação e contexto educativo ambíguo. Não verifica a verdade de uma premiação ou identidade de suporte, reputação de domínios, conteúdo de anexos ou autoria de citações. Alertas usam categorias e precisam de revisão humana. Se não houver administrador humano identificável, não há destinatário para o aviso; o evento/cooldown continua reservado para impedir repetição. Aceitação do pedido de exclusão pelo socket não comprova a exibição em cada aparelho. Testes são offline com mocks, sem WhatsApp/Render/Mongo reais e sem deploy.
