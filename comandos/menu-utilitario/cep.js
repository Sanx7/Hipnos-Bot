// ============================================
// 🏠 CEP — O Endereço nas Névoas do Sono
// ============================================
// Consulta o ENDEREÇO de um CEP brasileiro na BrasilAPI v2
// (https://brasilapi.com.br/api/cep/v2/{cep} — sem key) e responde em
// PT-BR com a temática do Limbo:
//   - rua (logradouro), bairro, cidade e estado;
//   - coordenadas (latitude/longitude) quando a base as traz (a v2
//     devolve location.coordinates em CEPs de rua);
//   - 🪂 FALLBACK: se a BrasilAPI falhar (fora do ar, sem o CEP ou com
//     resposta quebrada), a consulta é repetida na ViaCEP
//     (https://viacep.com.br/ws/{cep}/json/) — também sem key.
//
// Como usar (uso LIVRE, funciona em grupos e no privado):
//   /cep 01310-100   -> com hífen
//   /cep 01310100    -> sem hífen (a máscara é opcional)
//   (também: /consulta-cep e /consultacep)
//
// Tratamento de erros (mesmo padrão do /ddd, /clima e /nasa):
//   - CEP malformado/ausente (≠ 8 dígitos) -> instruções de uso;
//   - CEP inexistente (404 nas duas APIs, ou {"erro": true} na ViaCEP)
//     -> aviso amigável;
//   - as duas APIs fora do ar / sem rede / timeout -> aviso amigável;
//   - logs "[cep] ..." no console; o isolamento do bot.js garante que
//     nada derrube o listener.
// ============================================

// ⏳ Timeout de CADA chamada HTTP (ms) — requisito: 10s (padrão do /ddd)
const TIMEOUT_API_MS = 10000

const URL_BRASILAPI = 'https://brasilapi.com.br/api/cep/v2'
const URL_VIACEP = 'https://viacep.com.br/ws'

// 🧪 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroCep extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroCep'
    this.tipo = tipo // 'api' | 'inexistente'
  }
}

// ─── 🌐 GET com timeout de 10s (mesmo padrão do /ddd, /clima e /nasa) ───
// `origem` é o nome do serviço (BrasilAPI/ViaCEP) para as mensagens de erro.
async function buscarJson(url, origem) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Hipnos-Bot/1.0'
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      if (resposta.status === 404) {
        throw new ErroCep(`a ${origem} não encontrou esse CEP (HTTP 404)`, 'inexistente')
      }
      throw new ErroCep(`a ${origem} respondeu HTTP ${resposta.status}`, 'api')
    }
    return await resposta.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroCep) throw err
    if (err.name === 'AbortError') {
      throw new ErroCep(`a consulta à ${origem} demorou demais (timeout)`, 'api')
    }
    throw new ErroCep(err?.message || String(err), 'api')
  }
}

// ─── 🔢 Extrai e valida o CEP do texto digitado ───
// Aceita com ou sem hífen/máscara ("01310-100", "01310100") e precisa ter
// EXATAMENTE 8 dígitos — caso contrário devolve null (entrada malformada).
function extrairCep(texto) {
  const digitos = String(texto || '')
    .replace(/^\/\S+\s*/, '')   // tira o próprio comando ("/cep")
    .replace(/\D/g, '')         // mantém só os números
  return digitos.length === 8 ? digitos : null
}

// ─── 🎀 Máscara de exibição: 01310100 -> 01310-100 ───
function formatarCep(cep) {
  const digitos = String(cep || '').replace(/\D/g, '')
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : String(cep || '')
}

// ─── 🧭 Normaliza a resposta da BrasilAPI v2 ───
// Campos: street/neighborhood/city/state + location.coordinates (lat/long).
// Formato estranho/sem cidade/UF -> erro de API (o fallback ViaCEP assume).
function normalizarBrasilApi(dados) {
  if (!dados || !dados.city || !dados.state) {
    throw new ErroCep('a BrasilAPI devolveu uma resposta inesperada', 'api')
  }
  const coordenadas = dados.location?.coordinates || {}
  return {
    rua: dados.street,
    bairro: dados.neighborhood,
    cidade: dados.city,
    estado: dados.state,
    latitude: coordenadas.latitude ?? null,
    longitude: coordenadas.longitude ?? null,
    servico: dados.service ? `BrasilAPI (${dados.service})` : 'BrasilAPI'
  }
}

// ─── 🪂 Normaliza a resposta da ViaCEP (fallback) ───
// A ViaCEP responde HTTP 200 com {"erro": true} quando o CEP não existe —
// cobrimos todas as variações conhecidas desse flag.
function normalizarViaCep(dados) {
  const erro = dados?.erro
  if (erro === true || erro === 'true' || erro === 'Erro' || erro === 1) {
    throw new ErroCep('a ViaCEP não conhece esse CEP', 'inexistente')
  }
  if (!dados || !dados.localidade || !dados.uf) {
    throw new ErroCep('a ViaCEP devolveu uma resposta inesperada', 'api')
  }
  return {
    rua: dados.logradouro,
    bairro: dados.bairro,
    cidade: dados.localidade,
    estado: dados.uf,
    latitude: null,
    longitude: null,
    servico: 'ViaCEP'
  }
}

// ─── 🔎 consultarCep(cep): BrasilAPI v2 com fallback ViaCEP ───
// Tenta a BrasilAPI; em QUALQUER falha dela (rede, HTTP, resposta quebrada
// ou 404) repete na ViaCEP. Regras do fallback:
//   - ViaCEP acertou            -> usa a resposta (a fonte sai na mensagem);
//   - ViaCEP diz "não existe"   -> erro 'inexistente';
//   - ViaCEP fora + BrasilAPI 404 -> 'inexistente' (a 404 da BrasilAPI é
//     sinal positivo de que o CEP não existe);
//   - ViaCEP fora + BrasilAPI fora -> erro de API (as duas caíram).
async function consultarCep(cep) {
  try {
    return normalizarBrasilApi(await buscarJson(`${URL_BRASILAPI}/${cep}`, 'BrasilAPI'))
  } catch (erroBrasil) {
    try {
      return normalizarViaCep(await buscarJson(`${URL_VIACEP}/${cep}/json/`, 'ViaCEP'))
    } catch (erroVia) {
      if (erroVia.tipo === 'inexistente') throw erroVia
      if (erroBrasil.tipo === 'inexistente') throw erroBrasil
      throw erroVia
    }
  }
}

// ─── ✉️ Monta a mensagem temática do endereço ───
// Campos vazios viram "—"; a linha de coordenadas só aparece quando a
// base as traz (BrasilAPI v2).
function montarMensagem(cep, dados) {
  const ou = (valor) => {
    const texto = String(valor ?? '').trim()
    return texto || '—'
  }
  const temCoordenadas =
    dados.latitude != null && dados.longitude != null &&
    String(dados.latitude).trim() !== '' && String(dados.longitude).trim() !== ''
  const linhaCoordenadas = temCoordenadas
    ? `🌍 *Coordenadas:* ${dados.latitude}, ${dados.longitude}\n`
    : ''

  return (
    `🏠 *ENDEREÇO DO CEP ${formatarCep(cep)}* ✨\n\n` +
    `🛣️ *Logradouro:* ${ou(dados.rua)}\n` +
    `🏘️ *Bairro:* ${ou(dados.bairro)}\n` +
    `🏙️ *Cidade:* ${ou(dados.cidade)}\n` +
    `🗺️ *Estado (UF):* ${ou(dados.estado)}\n` +
    linhaCoordenadas +
    `\n📜 Fonte: *${dados.servico}*` +
    `\n\n💤 *"Todo CEP guarda um endereço onde o sono descansa."*`
  )
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'cep',
  aliases: ['consulta-cep', 'consultacep'],
  descricao: 'Consulta o endereço (rua, bairro, cidade, estado e coordenadas) de um CEP do Brasil.',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🔢 Extrai e valida o CEP digitado (8 dígitos, com/sem hífen)
      const cep = extrairCep(text)
      if (!cep) {
        return await sock.sendMessage(jid, {
          text: '🏠 *Me diga qual CEP procurar...*\n\n' +
            'Informe o CEP logo após o comando (8 dígitos, com ou sem hífen).\n\n' +
            '🗝️ Exemplos: `/cep 01310-100` • `/cep 01310100`'
        }, { quoted: msg })
      }

      // 2) 🌐 Consulta a BrasilAPI v2 (com fallback ViaCEP embutido)
      const dados = await consultarCep(cep)

      // 3) ✉️ Resposta temática com o endereço completo
      return await sock.sendMessage(jid, { text: montarMensagem(cep, dados) }, { quoted: msg })
    } catch (err) {
      console.error('[cep] erro na consulta:', err)
      const aviso = err?.tipo === 'inexistente'
        ? '🏠 *Esse CEP não existe nos mapas do Brasil...*\n\n' +
          'Confira os 8 dígitos (com ou sem hífen) e tente de novo.\n\n' +
          '🗝️ Exemplos: `/cep 01310-100` • `/cep 22041-011`'
        : '⛔ *As rotas do limbo interromperam a consulta...*\n\n' +
          'A BrasilAPI e a ViaCEP não responderam agora. Tente novamente em instantes.'
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}

