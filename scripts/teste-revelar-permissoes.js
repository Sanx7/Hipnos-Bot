// Teste offline: helpers reais, Mongo fake e download simulado.
// Uso: node scripts/teste-revelar-permissoes.js
process.env.MONGODB_URI = '';
process.env.OWNER_NUMBERS = '5511900000099';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const baileys = require('@whiskeysockets/baileys');
const vip = require('../vip');
const lid = require('../lid');
const { getDonos, limparNumero } = require('../config');

const GRUPO = '120363000000000000@g.us';
const COMUM = '5511900000001@s.whatsapp.net';
const ADMIN = '5511900000002@s.whatsapp.net';
const VIP = '5511900000003@s.whatsapp.net';
const DONO = `${getDonos()[0]}@s.whatsapp.net`;
const LID_COMUM = '900000001@lid';
const LID_ADMIN = '900000002@lid';
const LID_VIP = '900000003@lid';
const LID_DONO = '900000099@lid';
const participantes = [
  { id: COMUM }, { id: ADMIN, admin: 'admin' }, { id: VIP }, { id: DONO },
  { id: LID_COMUM, phoneNumber: COMUM },
  { id: LID_ADMIN, phoneNumber: ADMIN, admin: 'superadmin' },
  { id: LID_VIP, phoneNumber: VIP },
  { id: LID_DONO, phoneNumber: DONO }
];

let downloads = 0;
let normalizacoes = 0;
let consultasVip = 0;
let video;
const entradaBaileys = require.resolve('@whiskeysockets/baileys');
const cacheOriginal = require.cache[entradaBaileys];
require.cache[entradaBaileys] = {
  id: entradaBaileys, filename: entradaBaileys, loaded: true,
  exports: {
    ...baileys,
    normalizeMessageContent: (...args) => {
      normalizacoes += 1;
      return baileys.normalizeMessageContent(...args);
    },
    downloadMediaMessage: async () => { downloads += 1; return video; }
  }
};
const revelar = require('../comandos/admin/revelar');

function mensagem(sender, reply = true) {
  return {
    key: { remoteJid: GRUPO, participant: sender, id: 'TESTE', fromMe: false },
    message: reply ? {
      extendedTextMessage: {
        text: '/revelar',
        contextInfo: {
          // Responder a um dono não concede a permissão dele ao autor.
          participant: DONO,
          quotedMessage: { viewOnceMessageV2: { message: {
            videoMessage: { url: 'https://fake/video', mimetype: 'video/mp4', viewOnce: true }
          } } }
        }
      }
    } : { conversation: '/revelar' }
  };
}

async function testar(nome, sender, permitido, opcoes = {}) {
  downloads = normalizacoes = consultasVip = 0;
  lid.__definirConsultaSessaoTeste(async (id) => {
    if (opcoes.erroLid) throw new Error('sessão indisponível');
    return opcoes.mapeamento?.[id] || null;
  });
  vip.__definirColecaoTeste({
    async findOne({ numero }) {
      consultasVip += 1;
      if (opcoes.erroVip) throw new Error('VIP indisponível');
      return numero === limparNumero(VIP)
        ? { numero, expira_em: Date.now() + (opcoes.expirado ? -60000 : 60000) }
        : null;
    },
    async deleteOne() {}
  });
  const enviadas = [];
  const sock = {
    async groupMetadata() {
      if (opcoes.erroMetadata) throw new Error('metadata indisponível');
      return { participants: opcoes.participantes || participantes };
    },
    async sendMessage(jid, conteudo) { enviadas.push(conteudo); return { key: { id: 'ENVIO' } }; }
  };
  await revelar.executar(sock, GRUPO, mensagem(sender, opcoes.reply !== false), '/revelar');
  if (permitido) {
    assert.equal(downloads, 1, 'autorizado deve baixar a mídia');
    assert.ok(enviadas.some((m) => Buffer.isBuffer(m.video) && m.video.length > 0), 'deve reenviar vídeo');
    assert.ok(enviadas.some((m) => m.react?.text === '✅'), 'deve terminar com sucesso');
    if (opcoes.semConsultaVip) assert.equal(consultasVip, 0, 'ADM/dono independem de VIP');
  } else {
    assert.equal(downloads, 0, 'bloqueado não pode baixar');
    assert.equal(normalizacoes, 0, 'bloqueado não pode acessar a mídia');
    assert.equal(enviadas.length, 1, 'deve enviar somente a recusa');
    assert.match(enviadas[0].text, /exclusivo/);
    assert.ok(!enviadas.some((m) => m.react || m.video || m.image));
  }
  console.log(`✅ ${nome}`);
}

async function main() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'hipnos-revelar-permissoes-'));
  const amostra = path.join(pasta, 'amostra.mp4');
  try {
    execFileSync(require('@ffmpeg-installer/ffmpeg').path, [
      '-y', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.2',
      '-pix_fmt', 'yuv420p', amostra
    ], { stdio: 'pipe' });
    video = fs.readFileSync(amostra);
    await testar('membro comum sem reply → BLOQUEADO', COMUM, false, { reply: false });
    await testar('administrador → PERMITIDO', ADMIN, true, { semConsultaVip: true });
    await testar('VIP → PERMITIDO', VIP, true);
    await testar('dono → PERMITIDO', DONO, true, { semConsultaVip: true });
    await testar('membro comum respondendo a dono → BLOQUEADO', COMUM, false);
    await testar('membro comum por LID → BLOQUEADO', LID_COMUM, false);
    await testar('administrador por LID → PERMITIDO', LID_ADMIN, true);
    await testar('VIP por LID → PERMITIDO', LID_VIP, true);
    await testar('dono por LID → PERMITIDO', LID_DONO, true);
    await testar('telefone do ADM com metadata em LID → PERMITIDO', ADMIN, true, { participantes: participantes.slice(4) });
    await testar('metadata indisponível, comum → BLOQUEADO', COMUM, false, { erroMetadata: true });
    await testar('VIP indisponível, comum → BLOQUEADO', COMUM, false, { erroVip: true });
    await testar('metadata e VIP indisponíveis → BLOQUEADO', COMUM, false, { erroMetadata: true, erroVip: true });
    await testar('LID sem resolução e metadata indisponível → BLOQUEADO', LID_COMUM, false, { erroMetadata: true, erroLid: true });
    await testar('VIP expirado → BLOQUEADO', VIP, false, { expirado: true });
    await testar('metadata indisponível, VIP comprovado → PERMITIDO', VIP, true, { erroMetadata: true });
    await testar('metadata/VIP indisponíveis, dono comprovado → PERMITIDO', DONO, true, { erroMetadata: true, erroVip: true, semConsultaVip: true });
    await testar('dono por mapeamento da sessão → PERMITIDO', LID_DONO, true, {
      erroMetadata: true, mapeamento: { '900000099': limparNumero(DONO) }
    });
    console.log('\n18 testes de permissão passaram; vídeo convertido e reenviado nos casos permitidos.');
  } finally {
    lid.__definirConsultaSessaoTeste(null);
    require.cache[entradaBaileys] = cacheOriginal;
    if (fs.existsSync(amostra)) fs.unlinkSync(amostra);
    fs.rmdirSync(pasta);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
