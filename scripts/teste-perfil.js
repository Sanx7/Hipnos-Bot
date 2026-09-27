// ============================================================
// 🧪 teste-perfil.js — Testes OFFLINE do selo VIP no /perfil (+ /badge)
// ============================================================
// Cobre o selo 💠 VIP AUTÁTICO do card:
//   ✅ VIP ativo               → o /perfil imprime "💠 VIP" ao lado do nome;
//   ✅ VIP vencido/inexistente → o card sai SEM selo (e o vencido é limpo);
//   ✅ /badge                  → informa os DOIS casos (ativo e inativo) e
//                                explica que o selo aparece automaticamente
//                                no /perfil enquanto o VIP durar;
//   ✅ /menu-vip e changelog   → citam o benefício automático / a entrada.
// RODA SEM WhatsApp e SEM MongoDB de verdade:
//   🗄️ collection FAKE de VIPs injetada no vip.js (__definirColecaoTeste);
//   💬 sock mockado — só registra o que seria enviado;
//   🗄️ database do /perfil com estatísticas FAKE (instalado ANTES do
//      require do comando, que faz destructuring);
//   👤 /perfil rodando de VERDADE (avatar padrão embutido + ffmpeg do
//      projeto) — mesmo padrão do scripts/teste-nomecustom.js.
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
// 🗣️ Os avisos de [vip]/[perfil] no console são ESPERADOS.
// Uso: node scripts/teste-perfil.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const path = require('path')
const fs = require('fs')

const vip = require('../vip')
const { limparNumero } = require('../config')

// ─── 🗄️ Collection FAKE de VIPs (contrato mínimo do driver MongoDB) ───
function criarColecaoFake() {
  const documentos = new Map()
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const casa = (d, filtro) =>
    Object.entries(filtro || {}).every(([campo, valor]) => {
      if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        if (Array.isArray(valor.$in)) return valor.$in.includes(d[campo])
        if (valor.$lte !== undefined) return d[campo] <= valor.$lte
        if (valor.$gt !== undefined) return d[campo] > valor.$gt
      }
      return d[campo] === valor
    })

  return {
    _mapa: documentos, // acesso direto p/ os testes conferirem o que foi gravado
    async findOne(filtro) {
      for (const d of documentos.values()) if (casa(d, filtro)) return clone(d)
      return null
    },
    async updateOne(filtro, atualizacao, opcoes = {}) {
      for (const [, d] of documentos) {
        if (casa(d, filtro)) {
          if (atualizacao.$set) Object.assign(d, atualizacao.$set)
          if (atualizacao.$unset) for (const campo of Object.keys(atualizacao.$unset)) delete d[campo]
          return { matchedCount: 1 }
        }
      }
      if (opcoes.upsert) {
        const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) }
        documentos.set(novo.numero, novo)
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    },
    async deleteOne(filtro) {
      for (const [chave, d] of documentos) {
        if (casa(d, filtro)) { documentos.delete(chave); return { deletedCount: 1 } }
      }
      return { deletedCount: 0 }
    },
    async deleteMany(filtro) {
      let removidos = 0
      const teto = filtro?.expira_em?.$lte
      if (teto !== undefined) {
        for (const [chave, d] of documentos) {
          if (d.expira_em <= teto) { documentos.delete(chave); removidos += 1 }
        }
      }
      return { deletedCount: removidos }
    },
    find(filtro) {
      return {
        sort() { return this },
        async toArray() { return [...documentos.values()].filter((d) => casa(d, filtro)).map(clone) }
      }
    }
  }
}

const colecaoFake = criarColecaoFake()
vip.__definirColecaoTeste(colecaoFake)

// ─── 🗄️ database FAKE — instalado ANTES do require do /perfil ───
// (o perfil.js faz destructuring de buscarEstatisticasUsuario no require)
const database = require('../database')
database.buscarEstatisticasUsuario = async () => ({ total: 0, posicao: null, totalUsuarios: 0, nome: null })

const perfil = require('../comandos/perfil')
const badge = require('../comandos/menu-vip/badge')

// ─── 👥 Cenário ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_VIP = '5511900000001@s.whatsapp.net'
const JID_COMUM = '5511900000002@s.whatsapp.net'
const NUM_VIP = limparNumero(JID_VIP)
const NUM_COMUM = limparNumero(JID_COMUM)
const LID_VIP = '999888777@lid' // VIP que chega como LID nos metadados
const DOIS_DIAS = 2 * vip.DIA_EM_MS
const PARTICIPANTES = [
  { id: JID_VIP },
  { id: JID_COMUM },
  { id: LID_VIP, phoneNumber: JID_VIP } // metadados entregam o número real
]

// ─── 💬 Mocks ───
function criarSock() {
  const enviadas = []
  const sock = {
    enviadas, // 🔎 os helpers do teste leem daqui (textoUnico/legendaImagem)
    groupMetadata: async () => ({ subject: 'Recinto de Teste', participants: PARTICIPANTES }),
    profilePictureUrl: async () => { throw Object.assign(new Error('item-not-found'), { statusCode: 404 }) },
    fetchStatus: async () => ({ list: [] }),
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: `fake-${enviadas.length}` } }
    }
  }
  return { enviadas, sock }
}

function mensagem(texto, autor, pushName) {
  return {
    key: {
      remoteJid: JID_GRUPO,
      participant: autor || JID_VIP,
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    pushName,
    message: { conversation: texto }
  }
}

const enviadasDe = (alvo) => (Array.isArray(alvo?.enviadas) ? alvo.enviadas : (alvo?.sock?.enviadas || []))
const textosDe = (alvo) =>
  enviadasDe(alvo).filter((e) => typeof e.conteudo?.text === 'string').map((e) => e.conteudo.text)
const textoUnico = (alvo) => textosDe(alvo).join(' | ')
const legendaImagem = (alvo) => enviadasDe(alvo).find((e) => e.conteudo?.image)?.conteudo?.caption || ''
const vips = () => colecaoFake._mapa

// 🏅 O card (legenda da imagem) da execução do /perfil — falha se não vier imagem
async function cardDoPerfil(autor, pushName) {
  const { sock, enviadas } = criarSock()
  await perfil.executar(sock, JID_GRUPO, mensagem('/perfil', autor, pushName))
  const legenda = legendaImagem({ enviadas })
  if (!legenda) {
    throw new Error('o /perfil não enviou imagem com card na legenda: ' + textoUnico({ enviadas }))
  }
  return legenda
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------
async function main() {
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

  await testar('exports do /badge: nome/aliases/executar + registro do loader', async () => {
    if (badge.nome !== 'badge') throw new Error('nome: ' + badge.nome)
    if (!Array.isArray(badge.aliases) || !badge.aliases.includes('selovip')) {
      throw new Error('aliases: ' + JSON.stringify(badge.aliases))
    }
    if (typeof badge.executar !== 'function') throw new Error('sem executar')
    if (!badge.descricao) throw new Error('sem descricao')
    if (badge.categoria !== 'vip') throw new Error('categoria: ' + badge.categoria)

    // Simula o registro do loader do bot.js (nome + aliases no mesmo Map)
    const registro = new Map()
    registro.set(badge.nome, badge)
    for (const apelido of badge.aliases) registro.set(apelido, badge)
    if (registro.get('badge') !== badge) throw new Error('/badge não aponta para o comando')
    if (registro.get('selovip') !== badge) throw new Error('/selovip não aponta para o comando')
  })

  await testar('helper linhaNomeComSelo: selo SÓ quando VIP', async () => {
    if (perfil.SELO_VIP !== '💠 VIP') throw new Error('SELO_VIP: ' + perfil.SELO_VIP)
    const comSelo = perfil.linhaNomeComSelo('Fulano', true)
    const semSelo = perfil.linhaNomeComSelo('Fulano', false)
    if (!comSelo.includes('Fulano ' + perfil.SELO_VIP)) throw new Error('com VIP deveria ter o selo: ' + comSelo)
    if (semSelo.includes(perfil.SELO_VIP)) throw new Error('sem VIP não deveria ter o selo: ' + semSelo)
    if (semSelo !== '🪪 *Nome:* Fulano') throw new Error('linha sem VIP mudou: ' + semSelo)
  })

  await testar('/perfil com VIP ativo: imprime o selo ao lado do nome', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const legenda = await cardDoPerfil(JID_VIP, 'PushNameVip')
    if (!/\*Nome:\* PushNameVip 💠 VIP/.test(legenda)) {
      throw new Error('selo ausente na linha do nome: ' + (legenda.match(/.*Nome.*/) || [])[0])
    }
  })

  await testar('/perfil de VIP que chega como LID: o selo também aparece', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const legenda = await cardDoPerfil(LID_VIP, 'NomeLid')
    if (!/\*Nome:\* NomeLid 💠 VIP/.test(legenda)) {
      throw new Error('selo ausente para o remetente LID: ' + (legenda.match(/.*Nome.*/) || [])[0])
    }
  })

  await testar('/perfil sem VIP (nunca teve): card sai SEM selo', async () => {
    vips().clear()
    const legenda = await cardDoPerfil(JID_COMUM, 'MortalComum')
    if (!/\*Nome:\* MortalComum/.test(legenda)) throw new Error('o nome do card mudou: ' + (legenda.match(/.*Nome.*/) || [])[0])
    if (legenda.includes(perfil.SELO_VIP)) throw new Error('selo vazou para quem não é VIP')
  })

  await testar('/perfil de VIP vencido: SEM selo (e o registro vencido é limpo)', async () => {
    vips().clear()
    vips().set(NUM_COMUM, {
      numero: NUM_COMUM,
      adicionado_em: Date.now() - 10 * vip.DIA_EM_MS,
      expira_em: Date.now() - 1000
    })
    const legenda = await cardDoPerfil(JID_COMUM, 'ExVip')
    if (!/\*Nome:\* ExVip/.test(legenda)) throw new Error('linha do nome inesperada: ' + (legenda.match(/.*Nome.*/) || [])[0])
    if (legenda.includes(perfil.SELO_VIP)) throw new Error('selo de VIP vencido vazou para o card')
    if (vips().has(NUM_COMUM)) throw new Error('o registro vencido deveria ter sido apagado do banco')
  })

  await testar('/badge com VIP ativo: informa selo aceso + comportamento automático', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock } = criarSock()
    await badge.executar(sock, JID_GRUPO, mensagem('/badge', JID_VIP))
    const t = textoUnico(sock)
    if (!/SELO VIP ATIVO/.test(t)) throw new Error('não informou o selo ativo: ' + t)
    if (/INATIVO/.test(t)) throw new Error('estado errado: ' + t)
    if (!/\/perfil/.test(t)) throw new Error('não explica que o selo aparece no /perfil: ' + t)
    if (!/autom/i.test(t)) throw new Error('não explica que é automático: ' + t)
    if (!/expira|expirar/.test(t)) throw new Error('não explica a expiração junto com o VIP: ' + t)
  })

  await testar('/badge sem VIP: informa selo inativo + como ativar (uso livre, sem recusa)', async () => {
    vips().clear()
    const { sock } = criarSock()
    await badge.executar(sock, JID_GRUPO, mensagem('/badge', JID_COMUM))
    const t = textoUnico(sock)
    if (!/SELO VIP INATIVO/.test(t)) throw new Error('não informou o selo inativo: ' + t)
    if (/exclusivo/i.test(t)) throw new Error('o /badge deveria ser de uso livre, não recusar: ' + t)
    if (!/\/perfil/.test(t)) throw new Error('não explica o comportamento no /perfil: ' + t)
    if (!/autom/i.test(t)) throw new Error('não explica que é automático: ' + t)
    if (!/\/menu-vip/.test(t)) throw new Error('não aponta como virar VIP: ' + t)
  })

  await testar('/badge com VIP vencido: informa como inativo (e limpa o vencido)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() - 1000 })
    const { sock } = criarSock()
    await badge.executar(sock, JID_GRUPO, mensagem('/badge', JID_VIP))
    const t = textoUnico(sock)
    if (!/SELO VIP INATIVO/.test(t)) throw new Error('VIP vencido deveria constar como inativo: ' + t)
    if (vips().has(NUM_VIP)) throw new Error('o registro vencido deveria ter sido apagado')
  })

  await testar('/menu-vip cita o selo automático e o changelog tem a entrada do pacote', async () => {
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-vip', 'menu-vip.js'), 'utf8')
    if (!/\/badge/.test(menu)) throw new Error('o /menu-vip não cita o /badge')
    if (!/\/selovip/.test(menu)) throw new Error('o /menu-vip não cita o alias /selovip')
    if (!/AUTOMÁTICO/i.test(menu)) throw new Error('o /menu-vip não anuncia o selo como automático')
    if (!/selo 💠 VIP aparece sozinho ao lado do seu nome no \/perfil/i.test(menu)) {
      throw new Error('o /menu-vip não descreve o selo no /perfil')
    }

    const changelog = require('../dados/changelog')
    if (!Array.isArray(changelog) || !changelog.length) throw new Error('changelog vazio')
    if (!changelog.some((entrada) => /\/badge/.test(entrada.titulo))) {
      throw new Error('o changelog não tem entrada para o /badge')
    }
    // Mesma regra dos outros testes do projeto (assinatura/corvip/nomecustom):
    // a entrada precisa EXISTIR; o topo do changelog é do lançamento mais
    // novo e muda a cada comando novo (hoje: /set-prefix).
    if (!changelog.some((entrada) => /\/temavip/.test(entrada.titulo))) {
      throw new Error('o changelog não tem entrada para o /temavip')
    }
  })

  await testar('fonte do /perfil: checagem em tempo real via vip.isVip', async () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'perfil.js'), 'utf8')
    if (!/vip\.isVip\(/.test(fonte)) throw new Error('o /perfil não checa o VIP em tempo real')
    if (!/linhaNomeComSelo\(nombreExhibicion, ehVipDoCard\)/.test(fonte)) {
      throw new Error('a linha do nome não usa o helper do selo')
    }
    if (!/const SELO_VIP = '💠 VIP'/.test(fonte)) throw new Error('constante do selo ausente')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal no harness:', err)
  process.exit(1)
})