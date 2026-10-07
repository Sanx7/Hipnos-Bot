// Testes offline: normalização real do Baileys, download/socket simulados.
// Uso: node scripts/teste-totag.js
process.env.OWNER_NUMBERS = '5511999990009';
process.env.MONGODB_URI = '';

const assert = require('node:assert/strict');
const baileys = require('@whiskeysockets/baileys');
const lid = require('../lid');
const GRUPO = '120363000000000000@g.us';
const ADMIN = '5511777766665@s.whatsapp.net';
const DONO = '5511999990009@s.whatsapp.net';
const COMUM = '5511888880008@s.whatsapp.net';
const LID_ADMIN = '175952680210500@lid';
const LID_DONO = '175952680210600@lid';
const LID_COMUM = '175952680210700@lid';
const PARTICIPANTES = [
  { id: LID_ADMIN, phoneNumber: ADMIN, admin: 'admin' },
  { id: LID_DONO, phoneNumber: DONO },
  { id: LID_COMUM, phoneNumber: COMUM }
];
const BYTES = Buffer.from('mídia simulada');
let baixadas = [];
let erroDownload = null;
const entrada = require.resolve('@whiskeysockets/baileys');
const cacheOriginal = require.cache[entrada];
require.cache[entrada] = {
  id: entrada, filename: entrada, loaded: true,
  exports: {
    ...baileys,
    downloadMediaMessage: async (...args) => {
      baixadas.push(args);
      if (erroDownload) throw erroDownload;
      return BYTES;
    }
  }
};
const cmd = require('../comandos/admin/totag');

function msg(quoted, sender = LID_ADMIN) {
  return {
    key: { remoteJid: GRUPO, participant: sender, id: 'COMANDO' },
    message: { extendedTextMessage: {
      text: '/totag', contextInfo: {
        quotedMessage: quoted, stanzaId: 'ORIGINAL', participant: COMUM
      }
    } }
  };
}

async function executar(message, opcoes = {}) {
  const enviadas = [];
  baixadas = [];
  erroDownload = opcoes.erroDownload || null;
  const sock = {
    async groupMetadata() {
      if (opcoes.erroMetadata) throw new Error('metadata indisponível');
      return { participants: opcoes.participantes || PARTICIPANTES };
    },
    async sendMessage(jid, conteudo, extra) {
      if (opcoes.erroEnvio) throw new Error('envio indisponível');
      enviadas.push({ jid, conteudo, extra });
      return { key: { id: 'REENVIO' } };
    }
  };
  await cmd.executar(sock, opcoes.jid || GRUPO, message, opcoes.text);
  return enviadas;
}

function reenvio(enviadas) {
  assert.equal(enviadas.length, 1, 'sem mensagens extras');
  assert.equal(enviadas[0].extra, undefined, 'reenvio sem quote do comando');
  const conteudo = enviadas[0].conteudo;
  const ids = PARTICIPANTES.map((p) => p.id);
  assert.deepEqual(conteudo.mentions, ids);
  assert.deepEqual(conteudo.contextInfo, { mentionedJid: ids });
  assert.equal(conteudo.react, undefined);
  return conteudo;
}

function recusa(enviadas, regex) {
  assert.equal(enviadas.length, 1);
  assert.match(enviadas[0].conteudo.text, regex);
  assert.equal(enviadas[0].conteudo.mentions, undefined);
  assert.equal(baixadas.length, 0);
}

const VIDEO = { videoMessage: { caption: 'Legenda original 🎬', mimetype: 'video/mp4' } };
let falhas = 0;
let passou = 0;
async function testar(nome, fn) {
  lid.__definirConsultaSessaoTeste(async () => null);
  try { await fn(); passou += 1; console.log(`✅ ${nome}`); }
  catch (err) { falhas += 1; console.error(`❌ ${nome}:`, err); }
}

async function main() {
  await testar('nome/alias: totag e notag2, sem reservar notag', () => {
    assert.equal(cmd.nome, 'totag');
    assert.deepEqual(cmd.aliases, ['notag2']);
  });
  for (const [comando, texto] of [
    ['/totag', 'teste'],
    ['/totag', 'coloca a vivi no grupo tropa'],
    ['/notag2', 'teste'],
    ['/notag2', 'reunião às 20h'],
    ['/totag', 'Linha 1\nLinha 2  com espaços 🎉']
  ]) {
    await testar(`${comando} texto direto preservado, sem comando ou @ visíveis`, async () => {
      const message = msg(undefined);
      message.message = { conversation: `${comando} ${texto}` };
      const c = reenvio(await executar(message));
      assert.equal(c.text, texto);
      assert.ok(!c.text.includes(comando));
      assert.ok(!c.text.includes('@'));
      assert.equal(baixadas.length, 0);
    });
  }
  await testar('texto direto tem prioridade sobre reply de vídeo sem baixar mídia', async () => {
    const message = msg(VIDEO);
    message.message.extendedTextMessage.text = '/totag use este texto';
    const c = reenvio(await executar(message));
    assert.equal(c.text, 'use este texto');
    assert.equal(c.video, undefined);
    assert.equal(baixadas.length, 0);
  });
  await testar('texto passado pelo roteador aceita prefixo configurado', async () => {
    const c = reenvio(await executar(msg(undefined), { text: '!notag2 teste do roteador' }));
    assert.equal(c.text, 'teste do roteador');
  });
  await testar('membro comum por LID não pode usar texto direto', async () => {
    const message = msg(undefined, LID_COMUM);
    message.message.extendedTextMessage.text = '/totag teste';
    recusa(await executar(message), /Só administradores/);
  });
  await testar('comando com espaços mas sem texto ainda utiliza reply', async () => {
    const message = msg({ conversation: 'Texto citado' });
    message.message.extendedTextMessage.text = '/totag   ';
    assert.equal(reenvio(await executar(message)).text, 'Texto citado');
  });
  await testar('texto com mentions e sem texto extra', async () => {
    const original = { conversation: 'Texto original\nSegunda linha' };
    const copia = JSON.stringify(original);
    const conteudo = reenvio(await executar(msg(original)));
    assert.equal(conteudo.text, original.conversation);
    assert.equal(JSON.stringify(original), copia, 'não modifica o quoted');
    assert.equal(baixadas.length, 0);
  });
  await testar('texto e comando embrulhados em ephemeralMessage', async () => {
    const message = msg({ ephemeralMessage: { message: { extendedTextMessage: { text: 'Texto temporário' } } } });
    message.message = { ephemeralMessage: { message: message.message } };
    assert.equal(reenvio(await executar(message)).text, 'Texto temporário');
  });
  await testar('vídeo preserva buffer, legenda e mentions', async () => {
    const conteudo = reenvio(await executar(msg(VIDEO)));
    assert.equal(conteudo.video, BYTES);
    assert.equal(conteudo.caption, VIDEO.videoMessage.caption);
    assert.equal(conteudo.mimetype, 'video/mp4');
    assert.equal(conteudo.text, undefined);
    assert.equal(baixadas.length, 1);
    assert.equal(baixadas[0][0].message, VIDEO);
    assert.deepEqual(baixadas[0][0].key, {
      remoteJid: GRUPO, id: 'ORIGINAL', participant: COMUM, fromMe: false
    });
    assert.equal(baixadas[0][1], 'buffer');
  });
  await testar('vídeo sem legenda não recebe texto novo', async () => {
    const c = reenvio(await executar(msg({ videoMessage: { mimetype: 'video/mp4' } })));
    assert.equal(c.caption, undefined);
    assert.equal(c.text, undefined);
  });
  for (const ptt of [true, false]) {
    await testar(`áudio ptt=${ptt} preserva mimetype e mentions`, async () => {
      const c = reenvio(await executar(msg({ audioMessage: { ptt, mimetype: 'audio/ogg; codecs=opus' } })));
      assert.equal(c.audio, BYTES);
      assert.equal(c.ptt, ptt);
      assert.equal(c.mimetype, 'audio/ogg; codecs=opus');
      assert.equal(c.text, undefined);
      assert.equal(c.caption, undefined);
      // Verifica que o protocolo aceita contextInfo no áudio; não prova
      // a exibição de notificação nos aplicativos WhatsApp.
      const proto = baileys.proto.Message;
      const wire = proto.decode(proto.encode(proto.fromObject({
        audioMessage: { ptt: c.ptt, mimetype: c.mimetype, contextInfo: c.contextInfo }
      })).finish());
      assert.deepEqual(wire.audioMessage.contextInfo.mentionedJid, c.mentions);
    });
  }
  await testar('sem reply avisa uso', async () => recusa(await executar(msg(undefined)), /Responda.*texto, vídeo ou áudio/));
  for (const tipo of ['imageMessage', 'stickerMessage']) {
    await testar(`${tipo} recusado sem download`, async () => recusa(await executar(msg({ [tipo]: {} })), /só funciona.*texto, vídeo ou áudio/));
  }
  await testar('não-admin/não-dono por LID recusado, mesmo respondendo a ADM', async () => {
    const message = msg(VIDEO, LID_COMUM);
    message.message.extendedTextMessage.contextInfo.participant = LID_ADMIN;
    recusa(await executar(message), /Só administradores/);
  });
  await testar('dono por LID permitido sem ser admin', async () => {
    assert.equal(reenvio(await executar(msg({ conversation: 'Dono' }, LID_DONO))).text, 'Dono');
  });
  await testar('ADM por telefone com metadata em LID permitido', async () => {
    reenvio(await executar(msg({ conversation: 'ADM' }, ADMIN)));
  });
  await testar('ADM por LID resolvido pelo mapeamento da sessão', async () => {
    lid.__definirConsultaSessaoTeste(async (id) => id === '175952680210500' ? ADMIN.split('@')[0] : null);
    const participantes = [{ id: ADMIN, admin: 'admin' }, { id: COMUM }];
    const envios = await executar(msg({ conversation: 'Sessão' }), { participantes });
    assert.equal(envios[0].conteudo.text, 'Sessão');
    assert.deepEqual(envios[0].conteudo.mentions, participantes.map((p) => p.id));
  });
  await testar('LID sem resolução recusado', async () => {
    recusa(await executar(msg(VIDEO, '999999999@lid')), /Só administradores/);
  });
  await testar('fora de grupo avisa sem download', async () => {
    recusa(await executar(msg(VIDEO), { jid: COMUM }), /em um grupo/);
  });
  await testar('falha de metadata recusa mesmo dono', async () => {
    recusa(await executar(msg(VIDEO, DONO), { erroMetadata: true }), /ler os membros/);
  });
  await testar('falha de download tratada sem reenviar mídia', async () => {
    const envios = await executar(msg(VIDEO), { erroDownload: new Error('download falhou') });
    assert.equal(envios.length, 1);
    assert.match(envios[0].conteudo.text, /Não consegui reenviar/);
    assert.equal(envios[0].conteudo.video, undefined);
  });
  await testar('falha de envio não escapa do comando', async () => {
    assert.deepEqual(await executar(msg(VIDEO), { erroEnvio: true }), []);
  });
  lid.__definirConsultaSessaoTeste(null);
  require.cache[entrada] = cacheOriginal;
  console.log(`\n${passou} passaram, ${falhas} falharam.`);
  process.exitCode = falhas ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
