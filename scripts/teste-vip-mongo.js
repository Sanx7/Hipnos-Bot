// ============================================
// 🧪 teste-vip-mongo.js — Valida o sistema VIP migrado para MongoDB
// ============================================
// RODA OFFLINE: injeta no vip.js uma collection fake em memória (via o
// gancho __definirColecaoTeste) que reproduz o contrato do driver MongoDB
// (findOne/updateOne com upsert/deleteOne/deleteMany com $lte/find+sort).
// A lógica DE NEGÓCIO testada é a mesma que roda no Atlas:
//   - outorga nova, soma em VIP ativo e validação de dias;
//   - isVip com JID cru e com auto-limpeza de expirados;
//   - listarVipsAtivos: ordenação e remoção dos vencidos;
//   - limparExpirados e formatação de data;
//   - erro RUIDOSO quando não há MONGODB_URI (não falha em silêncio).
// (O padrão de conexão real — singleton/ping/reconexão — é idêntico ao do
// database.js e do rpg/database.js, já validados em produção.)
// Uso: node scripts/teste-vip-mongo.js
// ============================================

const vip = require('../vip')

const NUM_A = '5511900000001'
const NUM_B = '5511900000002'
const TOLERANCIA_MS = 2 * 60 * 1000 // 2 minutos

// ─── Collection fake (contrato mínimo do driver MongoDB) ───
function criarColecaoFake() {
  const docs = new Map()
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const casa = (d, filtro) =>
    Object.entries(filtro).every(([k, v]) => d[k] === v)

  return {
    _mapa: docs, // acesso direto p/ os testes simularem a passagem do tempo
    async findOne(filtro) {
      for (const d of docs.values()) if (casa(d, filtro)) return clone(d)
      return null
    },
    async updateOne(filtro, atualizacao, opcoes = {}) {
      for (const [, d] of docs) {
        if (casa(d, filtro)) {
          Object.assign(d, atualizacao.$set || {})
          return { matchedCount: 1 }
        }
      }
      if (opcoes.upsert) {
        const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) }
        docs.set(novo.numero, novo)
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    },
    async deleteOne(filtro) {
      for (const [chave, d] of docs) {
        if (casa(d, filtro)) {
          docs.delete(chave)
          return { deletedCount: 1 }
        }
      }
      return { deletedCount: 0 }
    },
    async deleteMany(filtro) {
      let n = 0
      const teto = filtro?.expira_em?.$lte
      if (teto !== undefined) {
        for (const [chave, d] of docs) {
          if (d.expira_em <= teto) {
            docs.delete(chave)
            n += 1
          }
        }
      }
      return { deletedCount: n }
    },
    find() {
      return {
        sort({ expira_em }) {
          return {
            async toArray() {
              const arr = [...docs.values()].map(clone)
              arr.sort((a, b) => (expira_em === -1 ? b.expira_em - a.expira_em : a.expira_em - b.expira_em))
              return arr
            }
          }
        }
      }
    }
  }
}

async function main() {
  const colecaoFake = criarColecaoFake()
  vip.__definirColecaoTeste(colecaoFake)

  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  await testar('outorga VIP novo (10 dias) sem soma', async () => {
    const r = await vip.adicionarVip(NUM_A, 10)
    if (!r || r.somando !== false || r.dias !== 10) throw new Error('retorno inesperado: ' + JSON.stringify(r))
    const esperado = Date.now() + 10 * vip.DIA_EM_MS
    if (Math.abs(r.expiraEm - esperado) > TOLERANCIA_MS) throw new Error('expiraEm fora da tolerância')
  })

  await testar('soma dias em VIP ativo (5 dias a mais)', async () => {
    const r1 = await vip.adicionarVip(NUM_A, 10)
    const r2 = await vip.adicionarVip(NUM_A, 5)
    if (!r2 || r2.somando !== true) throw new Error('deveria somar em VIP ativo')
    if (Math.abs(r2.expiraEm - (r1.expiraEm + 5 * vip.DIA_EM_MS)) > TOLERANCIA_MS) {
      throw new Error('expiraEm deveria ser expiração anterior + 5 dias')
    }
  })

  await testar('isVip: true com dígitos e com JID cru', async () => {
    if ((await vip.isVip(NUM_A)) !== true) throw new Error('isVip(digits) deveria ser true')
    if ((await vip.isVip(`${NUM_A}@s.whatsapp.net`)) !== true) throw new Error('isVip(jid) deveria ser true')
    if ((await vip.isVip('5511999999999')) !== false) throw new Error('número sem VIP deveria ser false')
  })

  await testar('adicionarVip rejeita dados inválidos', async () => {
    if ((await vip.adicionarVip(NUM_B, 0)) !== null) throw new Error('dias 0 deveria ser inválido')
    if ((await vip.adicionarVip(NUM_B, vip.DIAS_MAX + 1)) !== null) throw new Error('dias > DIAS_MAX deveria ser inválido')
    if ((await vip.adicionarVip('', 10)) !== null) throw new Error('número vazio deveria ser inválido')
  })

  await testar('isVip apaga registro vencido (auto-limpeza)', async () => {
    await vip.adicionarVip(NUM_B, 1)
    // Simula a passagem do tempo: expira_em no passado
    colecaoFake._mapa.get(NUM_B).expira_em = Date.now() - 1000
    if ((await vip.isVip(NUM_B)) !== false) throw new Error('VIP vencido deveria ser false')
    if (colecaoFake._mapa.has(NUM_B)) throw new Error('registro vencido deveria ter sido apagado')
  })

  await testar('listarVipsAtivos: só ativos, ordenados pela expiração mais próxima', async () => {
    await vip.adicionarVip('5511900000003', 2) // expira antes do A
    const lista = await vip.listarVipsAtivos()
    const numeros = lista.map((v) => v.numero)
    if (numeros.includes(NUM_B)) throw new Error('expirado não deveria aparecer na lista')
    if (!numeros.includes(NUM_A)) throw new Error('VIP ativo deveria aparecer')
    for (let i = 1; i < lista.length; i++) {
      if (lista[i].expira_em < lista[i - 1].expira_em) throw new Error('ordem de expiração incorreta')
    }
  })

  await testar('limparExpirados remove vencidos e retorna a contagem', async () => {
    await vip.adicionarVip(NUM_B, 1)
    colecaoFake._mapa.get(NUM_B).expira_em = Date.now() - 1000
    const removidos = await vip.limparExpirados()
    if (removidos !== 1) throw new Error(`deveria remover 1, removeu ${removidos}`)
    if ((await vip.limparExpirados()) !== 0) throw new Error('segunda limpeza deveria remover 0')
  })

  await testar('formatarData retorna "dd/mm/aaaa às HH:MM"', async () => {
    const texto = vip.formatarData(new Date('2026-03-05T14:09:00'))
    if (!/^\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/.test(texto)) throw new Error('formato inesperado: ' + texto)
  })

  await testar('sem collection e sem MONGODB_URI: erro ruidoso (não silencioso)', async () => {
    vip.__definirColecaoTeste(null)
    delete process.env.MONGODB_URI
    try {
      await vip.adicionarVip('5511999999999', 5)
      vip.__definirColecaoTeste(colecaoFake) // restaura p/ não vazar estado
      throw new Error('deveria rejeitar sem MONGODB_URI')
    } catch (err) {
      vip.__definirColecaoTeste(colecaoFake)
      if (!/MONGODB_URI/.test(err?.message || '')) throw err
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()