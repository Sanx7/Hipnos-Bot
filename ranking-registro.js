// ============================================================
// 🪪 ranking-registro.js — Gravação e agrupamento do /ranking pelo NÚMERO REAL
// ============================================================
// Por que este módulo existe (3 papéis):
//
//   1) 🪪 GRAVAR PELO NÚMERO REAL (registrarComNumeroReal)
//      O bot.js registrava a mensagem com o `sender` cru do Baileys. Num grupo
//      com LID habilitado esse sender é o LID ("175952680210489@lid"), então o
//      `usuario_id` do documento virava o LID — e a MESMA pessoa podia acabar
//      dividida em dois documentos (um por LID, um pelo telefone), cada um com
//      parte das mensagens. Aqui o LID é resolvido para o telefone ANTES de
//      chamar o database.js. Sem resolução, grava o que veio (sem regressão) e
//      marca o documento com o campo auxiliar `lid` (ver o item 3).
//
//   2) 📊 AGRUPAR PARA EXIBIÇÃO (agruparPorNumero)
//      Mesmo com a gravação corrigida, o banco ainda tem documentos antigos sob
//      chave-LID (ver scripts/migrar-ranking-lid.js). O /ranking e o /procurado
//      agrupam as linhas pelo NÚMERO RESOLVIDO: a pessoa aparece UMA vez, com a
//      SOMA. Por isso os comandos buscam mais linhas do que as 7 exibidas
//      (LIMITE_BUSCA_AGRUPAMENTO) e só cortam o top DEPOIS de agrupar: cortar
//      antes jogaria fora o documento-telefone (que pode estar na 11ª posição)
//      e a soma sairia errada.
//
//   3) 🔎 RESOLVER OS IDENTIFICADORES DO BANCO (resolverNumeros)
//      O `usuario_id` pode ser LID cru; o documento de VIP é gravado pelo
//      NÚMERO REAL (/darvip, /nomecustom, /corvip). Sem resolver, o VIP nunca é
//      encontrado (nome do banco + cor padrão). Mesmo código para os dois
//      comandos — antes era só do /ranking.
//
// ⚠️ AQUI NÃO SE USA METADADO DE GRUPO. O registrarComNumeroReal roda a CADA
//    mensagem (messages.upsert) e a Baileys 7.x NÃO cacheia o metadado do
//    grupo: cada consulta seria um IQ de rede. Por isso a resolução usa
//    `lid.resolverNumeroAlvo([], sender)` — lista de participantes VAZIA de
//    propósito, o que deixa o caminho "metadados" fora do jogo e usa só o
//    lid-mapping da sessão (1 findOne por _id, com cache em memória no lid.js).
//
// ✳️ Nada aqui lança: falha de resolução grava o identificador bruto (como
//    sempre foi) e falha do banco é só logada — o fluxo do bot nunca para.
// ============================================================

const lid = require('./lid')
const database = require('./database')

// Quantas linhas do banco os comandos devem buscar ANTES de agrupar por
// número. O top exibido é 7; buscamos 40 para que o agrupamento (LID +
// telefone da MESMA pessoa) consiga somar mesmo quando um dos documentos está
// fora das 7 primeiras posições.
const LIMITE_BUSCA_AGRUPAMENTO = 40

// -------------------------------------------------------------------
// 🪪 registrarComNumeroReal(grupoId, sender, nome): grava a mensagem no
// documento do NÚMERO REAL do remetente.
//
//   - Resolve o sender com `lid.resolverNumeroAlvo([], sender)` (SÓ o
//     lid-mapping da sessão — ver o aviso sobre metadados no cabeçalho);
//   - Resolveu (@lid → telefone)? Grava no telefone.
//   - Não resolveu? Grava o que veio (o LID, como antes) e MARCA o documento
//     com o campo auxiliar `lid` (os dígitos do LID). É esse campo que permite
//     uma migração futura achar o registro mesmo depois que o par sair da
//     sessão — o campo é comum e NÃO faz parte do índice único
//     (grupo_id, usuario_id), então não muda índice nenhum.
//   - NUNCA lança: devolve o resultado do database.js ou null.
// -------------------------------------------------------------------
async function registrarComNumeroReal (grupoId, sender, nome) {
  try {
    const bruto = String(sender || '').trim()
    if (!bruto) return null

    // `via` é o que diz se a resolução deu certo: 'direto' (o sender já era o
    // número real), 'mapeamento' (lid-mapping da sessão) ou null (o LID não
    // tem par conhecido — a função devolve o próprio LID como `numero`).
    let numero = ''
    let via = null
    try {
      const resolucao = await lid.resolverNumeroAlvo([], bruto)
      numero = resolucao?.numero || ''
      via = resolucao?.via || null
    } catch (errResolucao) {
      console.error(
        '⚠️ [ranking-registro] falha ao resolver o LID (gravando o identificador bruto):',
        errResolucao?.message || errResolucao
      )
    }

    const extras = {}
    const digitosBrutos = database.normalizarId(bruto)
    if (lid.ehLid(bruto) && !via) {
      extras.lid = digitosBrutos
    }

    // 🪪 Grava SEMPRE em dígitos (o database.js também normaliza, mas gravar
    //    já normalizado evita depender dessa etapa e mantém o `usuario_id` do
    //    documento igual ao que o ranking-registro calcula).
    return await database.registrarMensagem(grupoId, via ? numero : digitosBrutos, nome, extras)
  } catch (err) {
    console.error('❌ Erro ao registrar mensagem no ranking:', err?.message || err)
    return null
  }
}

// -------------------------------------------------------------------
// 🪪 resolverNumeros(participantes, ids): mapa idCruDoBanco → número REAL.
// (movido do comandos/ranking.js para o /procurado usar o MESMO código)
//
//   ⚠️ O `usuario_id` do banco é o que o bot.js gravou a partir do `sender`
//   cru e o `normalizarId` do database.js só guarda os dígitos — num grupo com
//   LID habilitado isso é o LID, NÃO o telefone. Como o /darvip, o /nomecustom
//   e o /corvip gravam o documento de VIP pelo NÚMERO REAL, consultar o VIP com
//   o LID nunca encontra nada: o nome sai do banco e a cor some.
//   `resolverNumeroDeDigitos` NUNCA lança; id vazio/sem resposta cai no bruto.
//   `participantes` pode ser [] (nenhum metadado consultado).
// -------------------------------------------------------------------
async function resolverNumeros (participantes, ids) {
  const mapa = new Map()
  for (const id of ids) {
    const alvo = database.normalizarId(id)
    if (!alvo || mapa.has(alvo)) continue
    try {
      const { numero } = await lid.resolverNumeroDeDigitos(participantes, alvo)
      mapa.set(alvo, numero || alvo)
    } catch (err) {
      // Falhou a resolução? Segue com o identificador do banco (nome padrão).
      console.error('[ranking-registro] ⚠️ falha ao resolver identificador:', alvo, err?.message || err)
      mapa.set(alvo, alvo)
    }
  }
  return mapa
}

// -------------------------------------------------------------------
// 📊 agruparPorNumero(itens, numeros): funde as linhas da MESMA pessoa.
//
//   - `itens`  : linhas do banco ({ usuario_id, nome, total, ultimaMensagem }).
//   - `numeros` : mapa do `resolverNumeros` (idCru → número resolvido).
//   - `ids`     : TODOS os identificadores crus que caíram no grupo — é o que
//                 permite ao /ranking e ao /procurado responder "ainda está no
//                 grupo?" comparando qualquer um deles com os participantes.
//
//   Devolve [{ usuario_id (a chave/NÚMERO), nome, total (soma),
//              ultimaMensagem (a mais nova), ids }] ordenado do MAIOR total
//   para o menor. O nome exibido é o do registro MAIS RECENTE (pushName mais
//   novo); em empate de data (ou banco antigo sem o campo), vale o último que
//   apareceu.
// -------------------------------------------------------------------
function agruparPorNumero (itens, numeros) {
  const grupos = new Map()

  for (const item of itens || []) {
    if (!item) continue
    const idCru = database.normalizarId(item.usuario_id)
    if (!idCru) continue

    // 🔑 A chave do agrupamento é o NÚMERO RESOLVIDO (o próprio idCru quando
    //    não há o que resolver): LID e telefone da mesma pessoa caem no mesmo
    //    balde e a contagem sai somada.
    const chave = (numeros && numeros.get(idCru)) || idCru
    const total = Number(item.total) || 0
    const ultima = Number(item.ultimaMensagem) || 0

    const atual = grupos.get(chave)
    if (!atual) {
      grupos.set(chave, {
        usuario_id: chave,
        nome: item.nome || null,
        total,
        ultimaMensagem: ultima,
        ids: [idCru]
      })
      continue
    }

    atual.total += total
    if (!atual.ids.includes(idCru)) atual.ids.push(idCru)
    if (ultima >= atual.ultimaMensagem) {
      atual.ultimaMensagem = Math.max(atual.ultimaMensagem, ultima)
      if (item.nome) atual.nome = item.nome
    }
  }

  // Do maior total para o menor. Empate: mantém a ordem em que o banco mandou
  // (o `sort` do V8 é estável).
  return [...grupos.values()].sort((a, b) => b.total - a.total)
}

module.exports = {
  LIMITE_BUSCA_AGRUPAMENTO,
  registrarComNumeroReal,
  resolverNumeros,
  agruparPorNumero
}

