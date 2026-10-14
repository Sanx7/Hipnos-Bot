# RPG Fase 3 — faculdade gratuita

RPG de simulação de vida real. Todas as graduações são gratuitas: não há cobrança de matrícula, mensalidade, inscrição, material nem emissão de diploma. A educação não modifica carteira, banco, salário ou XP profissional. Não foram executadas migrações, conexões reais, commit, push ou deploy nesta etapa.

## Cursos e profissões

As durações são fictícias para balanceamento do jogo. Uma sessão consome 10 de energia e exige intervalo mínimo de uma hora desde o último estudo, independentemente do grupo.

| ID permanente | Curso | Sessões | Cargos habilitados pelo diploma |
|---|---|---:|---|
| medicina | Medicina | 35 | Médico, Cirurgião, Chefe de Cirurgia, Pediatra, Chefe da Pediatria |
| direito | Direito | 25 | Advogado, Juiz, Mestre |
| engenharia | Engenharia | 25 | Engenheiro Júnior, Engenheiro, Engenheiro Chefe |
| enfermagem | Enfermagem | 20 | Enfermeiro, Chefe de Enfermagem |
| ciencia_computacao | Ciência da Computação | 20 | Desenvolvedor de Apps |
| fisica | Física | 20 | Físico, Astrofísico |
| administracao | Administração | 20 | Marketing, Chefe de Marketing, Bancário |
| economia | Economia | 20 | Corretor da Bolsa de Valores |
| pedagogia | Pedagogia | 20 | Professor, Subdiretor, Diretor |
| medicina_veterinaria | Medicina Veterinária | 20 | Veterinária, Veterinária Chefe |

O diploma não substitui os requisitos profissionais: carreiras de nível 3 continuam exigindo 1.500 XP total, e promoções continuam exigindo 100/300 XP na carreira. Técnico de Enfermagem permanece sem exigência de diploma; Enfermagem exige 500 XP total e seus cargos 2/3 exigem diploma específico. Dev Júnior/Dev/Dev Pro não passaram a exigir graduação.

**Futebol:** após revisão explícita, o usuário escolheu retirar a exigência de faculdade da carreira Jogador de Base → Jogador Profissional → Ídolo do Clube. Os 1.500 XP para contratação e os requisitos de promoção permanecem. Nenhuma outra exceção foi introduzida.

## Comandos

| Comando | Uso e resultado |
|---|---|
| /faculdades | Lista cursos, sessões, IDs, gratuidade e cargos associados. |
| /matricular <curso> | Matrícula grátis por ID ou nome completo, com ou sem acentos. Ex.: /matricular Ciência da Computação. |
| /estudar | Uma sessão com custo de energia e cooldown. Última sessão emite diploma. |
| /faculdade | Curso atual, status, progresso, sessões restantes e tempo mínimo estimado. |
| /diplomas | Todas as graduações concluídas e suas datas. |
| /trancar | Suspende o curso sem perder progresso ou alterar cooldown. |
| /retomar | Retoma o curso trancado. |

Uma única matrícula, ativa ou trancada, por jogador. Trancar não libera outro curso. A conclusão libera nova matrícula; um curso já concluído não pode ser cursado novamente. Os comandos de alteração exigem personagem registrado. Consulta e catálogo usam as regras gerais existentes do bot, inclusive privado, prefixo dinâmico, modo OFF e modo somente administradores. OFF continua com a exceção existente para donos; nenhuma permissão global mudou.

O primeiro estudo pode ocorrer logo após a matrícula. A previsão é um limite mínimo, considerando cooldown, energia suficiente e execução pontual de cada sessão; não promete conclusão automática. Cursos trancados não têm previsão ativa.

/ficha mantém as informações anteriores e acrescenta escolaridade, quantidade de diplomas e curso/progresso atual. Energia exibida é a última persistida; a recuperação é calculada nas atividades, sem timers.

## Persistência e compatibilidade

As coleções de jogadores e operações são as mesmas do RPG dedicado da Fase 1. Nenhuma coleção paralela ou dependência nova. Dados acadêmicos só surgem quando o jogador inicia o fluxo; não há atualização em massa.

O documento do jogador ganha academico:

- versao: 1.
- matricula: null ou objeto com id (operação original), cursoId, status (ativa/trancada), matriculadaEm, totalSessoes e sessoesConcluidas.
- diplomas: lista permanente de id, cursoId, concluidaEm e comprovacaoId.
- historico: trancamentos, retomadas e matrículas concluídas, com referências às respectivas operações.

A duração fica registrada na matrícula e é conferida contra a operação original, permitindo mudanças futuras no catálogo sem diminuir silenciosamente a duração de cursos existentes. IDs de cursos devem permanecer estáveis; cursos antigos não devem ser removidos sem planejamento de compatibilidade.

O identificador do diploma é o ID da operação da última sessão. Contratação, promoção e trabalho verificam curso específico, data não futura e operação de estudo concluída que emitiu exatamente esse diploma para a identidade canônica. Não basta um booleano ou um comprovacaoId arbitrário. Matrículas também exigem comprovação da operação original antes de estudo/trancamento/retomada.

escolaridade.faculdade da Fase 2 é preservado, mas seu contrato genérico não contém curso nem evidência suficiente para liberar profissões. Não foi convertido em diplomas retroativos. Jogadores com emprego acadêmico avançado e somente esse registro genérico podem consultar a ficha, mas contratação/promoção/trabalho exigirão a graduação correspondente. Dados acadêmicos incompatíveis ficam bloqueados para revisão, sem apagamento ou mesclagem.

Campos desconhecidos do jogador e do bloco acadêmico são preservados. Apenas academico, energia, energiaAtualizadaEm e cooldowns necessários são atualizados com $set; não se salva um documento inteiro. Saldos antigos, inclusive de formatos incompatíveis com a economia, não são convertidos pelas operações gratuitas.

**Backup:** preservar jogadores e auditoria juntos. Apagar a operação que comprova uma matrícula ou diploma fará a validação bloquear o uso. Nenhum TTL ou limpeza automática foi introduzido.

## Transações, identidade e falhas

Matrícula, estudo, trancamento e retomada reutilizam executarOperacaoAuditada: reserva persistente e resultado/auditoria na mesma transação do jogador. A chave da mensagem é compartilhada com a economia e empregos; reutilizar a mesma mensagem para outra ação é recusado. Replay devolve o resultado original e não executa outro estudo, cobrança ou diploma.

As transações exigem MongoDB com suporte a transações, snapshot e majority. Sem esse suporte, alterações são recusadas, sem fallback em memória. Atualizações concorrentes do mesmo jogador podem ser recusadas por conflito e nunca somam energia/progresso parcialmente. Uma recusa conhecida não é reexecutada pela mesma mensagem; após uma recusa confirmada por conflito, o jogador pode fazer uma nova tentativa com nova mensagem, respeitando cooldown e estado atual.

Commit ambíguo só é tratado como concluído quando a auditoria persistida confirma o resultado. Caso contrário permanece pendente para revisão; não repetir cegamente com outra mensagem, não apagar pendências e não emitir diploma por suposição. Falha na confirmação WhatsApp não desfaz nem repete a operação.

Estudo e trabalho usam a mesma recuperação de energia: um ponto a cada seis minutos, máximo 100, com uma única referência temporal persistida. Têm cooldowns separados, mas disputam atomicamente a mesma energia. Matrícula sem referência temporal cria uma referência no momento da matrícula sem repor energia ou presumir recuperação histórica.

JID/PN/LID são resolvidos pela camada da Fase 1; apenas associações comprovadas entram no filtro. Não se equiparam dígitos iguais de namespaces distintos. Fichas conflitantes detectadas pelo conjunto de identidades comprovadas são bloqueadas e não mescladas.

## Arquivos desta fase

Criados:

- rpg/faculdades-catalogo.js: dez cursos e associações profissionais.
- rpg/faculdade.js: serviço transacional e comprovação de diplomas/matrículas.
- rpg/energia.js: consumo/recuperação compartilhados com o trabalho.
- rpg/faculdade-comandos.js: respostas, consultas e fábrica dos comandos.
- comandos/rpg/faculdades.js, matricular.js, estudar.js, faculdade.js, diplomas.js, trancar.js e retomar.js.
- scripts/teste-rpg-faculdade.js e esta documentação.

Alterados sobre a implementação da Fase 2 já presente:

- rpg/empregos.js: validação específica contra auditoria e energia compartilhada.
- rpg/empregos-catalogo.js: exceção de futebol autorizada pelo usuário.
- rpg/economia.js: disponibiliza coleção de operações ao callback transacional; fórmulas financeiras permanecem.
- rpg/comandos.js: mensagens acadêmicas e prefixo dos sete novos comandos.
- comandos/rpg/ficha.js, carreira.js e empregos.js: escolaridade e requisitos por curso.
- scripts/teste-rpg-empregos.js: provas de diplomas por curso nos fixtures offline e exceção de futebol.
- scripts/teste-on-off.js: sete comandos adicionais no handler simulado e matrícula/estudo com prefixo dinâmico.
- docs/rpg-fase2-empregos.md: esclarecimento do contrato substituído nesta fase.

Não foram alterados .env, .env.example, credenciais, permissões globais ou sessões Baileys. Nenhuma dependência adicionada.

## Validação executada

Todos os testes abaixo usam mocks, documentos fictícios e nenhuma mensagem real:

- node scripts/teste-rpg-faculdade.js — 20 cenários: matrícula grátis/duplicada/inválida; energia; cooldown; persistência/replay; conclusão dos dez cursos; diplomas únicos/sequenciais; trancamento/retomada; simultaneidade; última sessão duplicada; prova de matrícula; estudo/trabalho; rollback; commits ambíguos; ausência de transações; todos os cursos/cargos; curso incorreto; diploma sem auditoria; futebol; legados; JID/LID; comandos/ficha/prefixo; confirmação perdida.
- node scripts/teste-rpg-empregos.js — 14 cenários, incluindo todas as 34 contratações e promoções.
- node scripts/teste-rpg-seguranca.js — 23 cenários de economia/identidade/auditoria.
- node scripts/teste-rpg-fase1.js — cadastro e ficha.
- node scripts/teste-rpg-fase2.js — economia e conservação de recursos.
- node scripts/teste-rpg-lid.js — identidade e reconciliação bloqueada.
- node scripts/teste-on-off.js — 83 cenários, incluindo os novos comandos no handler real em VM.
- node scripts/teste-loader.js — 594 entradas de comandos e aliases, sem erros de carregamento.

## Limitações e recomendação

Os mocks MVCC demonstram comportamento offline, não certificam rede real, failover MongoDB ou entrega WhatsApp. Esta Fase 3 ainda precisa de homologação com MongoDB replica set/cluster exclusivo de testes, usando somente RPG_TEST_MONGO_URI com isolamento validado. Nenhuma integração real foi executada nesta etapa.

Preservar auditoria junto dos jogadores, revisar registros acadêmicos genéricos/incompatíveis e homologar em ambiente isolado antes de implantação. Não executar migração, restauração parcial ou limpeza de operações pendentes automaticamente. Expansão de cursos deve conservar os IDs existentes e definir explicitamente as carreiras associadas.
