// TESTE-MODIFICADOR-VOZ parte 1: base + mocks
const fs = require('fs');
const os = require('os');
const path = require('path');
const voz = require('../comandos/menu-modificador/modificador-voz');

const JID = 'teste-voz@g.us';
const NOMES = ['esquilo', 'gigante', 'robo', 'demonio', 'rapido', 'lento', 'reverso', 'estourar'];

function sockFalso(reg) {
  return {
    sendMessage: async (jid, conteudo) => {
      reg.push({ jid, conteudo });
      return { ok: true };
    }
  };
}

function msgReplyAudio(ptt, seconds) {
  return {
    key: { id: 'K1', remoteJid: JID, participant: '5511900000001@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: '/efeito',
        contextInfo: {
          quotedMessage: { audioMessage: { ptt, seconds: seconds !== undefined ? seconds : 10, mimetype: 'audio/ogg; codecs=opus' } }
        }
      }
    }
  };
}

function msgSemReply() {
  return { key: { id: 'K2', remoteJid: JID }, message: { conversation: '/esquilo' } };
}

function msgReplyNaoAudio() {
  return {
    key: { id: 'K3', remoteJid: JID },
    message: {
      extendedTextMessage: {
        text: '/esquilo',
        contextInfo: { quotedMessage: { imageMessage: { caption: 'foto' } } }
      }
    }
  };
}

const porNome = (n) => voz.find((c) => c.nome === n);
const ultimoTexto = (reg) => {
  const e = [...reg].reverse().find((x) => typeof x.conteudo.text === 'string');
  return e ? e.conteudo.text : null;
};

let falhas = 0;
async function testar(titulo, fn) {
  try {
    await fn();
    console.log('PASSOU: ' + titulo);
  } catch (err) {
    falhas++;
    console.log('FALHOU: ' + titulo + ' :: ' + (err && err.message ? err.message : err));
  }
}
function exigir(cond, detalhe) {
  if (!cond) throw new Error(detalhe || 'condicao falsa');
}

async function main() {
  console.log('Teste offline do modificador de voz');
  const audioFalso = Buffer.from('AUDIO-FAKE-' + 'x'.repeat(100));

  await testar('modulo exporta os 8 comandos com nome/executar/filtro', async () => {
    for (const n of NOMES) {
      const c = porNome(n);
      if (!c || typeof c.executar !== 'function') throw new Error('falta /' + n);
      if (typeof c._filtro !== 'string' || !c._filtro) throw new Error('sem filtro /' + n);
    }
  });

  for (const nome of NOMES) {
    await testar('/' + nome + ' reply ptt preserva ptt:true', async () => {
      const reg = [];
      voz._injetar({
        baixarMidia: async () => audioFalso,
        rodarFfmpeg: async (args) => { fs.writeFileSync(args[args.length - 1], Buffer.from('SAIDA-' + nome)); }
      });
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyAudio(true));
      const envio = reg.find((x) => x.conteudo.audio);
      if (!envio) throw new Error('nao enviou audio');
      if (envio.conteudo.ptt !== true) throw new Error('ptt true nao preservado');
    });
    await testar('/' + nome + ' reply nao-ptt preserva ptt:false', async () => {
      const reg = [];
      voz._injetar({
        baixarMidia: async () => audioFalso,
        rodarFfmpeg: async (args) => { fs.writeFileSync(args[args.length - 1], Buffer.from('SAIDA-' + nome)); }
      });
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyAudio(false));
      const envio = reg.find((x) => x.conteudo.audio);
      if (!envio) throw new Error('nao enviou audio');
      if (envio.conteudo.ptt !== false) throw new Error('ptt false nao preservado');
    });
  }

  for (const nome of NOMES) {
    await testar('/' + nome + ' sem reply avisa uso', async () => {
      const reg = [];
      voz._injetar({ baixarMidia: async () => { throw new Error('nao devia baixar'); } });
      await porNome(nome).executar(sockFalso(reg), JID, msgSemReply());
      if (reg.some((x) => x.conteudo.audio)) throw new Error('enviou audio sem reply');
      if (!ultimoTexto(reg) || ultimoTexto(reg).indexOf('/' + nome) === -1) throw new Error('aviso sem nome');
    });
    await testar('/' + nome + ' reply nao-audio avisa', async () => {
      const reg = [];
      voz._injetar({ baixarMidia: async () => { throw new Error('nao devia baixar'); } });
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyNaoAudio());
      if (reg.some((x) => x.conteudo.audio)) throw new Error('enviou audio indevido');
      if (!ultimoTexto(reg)) throw new Error('sem aviso');
    });
    await testar('/' + nome + ' falha do ffmpeg vira aviso generico', async () => {
      const reg = [];
      voz._injetar({
        baixarMidia: async () => audioFalso,
        rodarFfmpeg: async () => { const e = new Error('ffmpeg quebrou'); e.mensagemFfmpeg = 'boom'; throw e; }
      });
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyAudio(true));
      if (reg.some((x) => x.conteudo.audio)) throw new Error('enviou audio apos falha');
      if (ultimoTexto(reg) !== voz.AVISO_GENERICO) throw new Error('aviso generico diferente');
    });
    await testar('/' + nome + ' audio grande demais recusado', async () => {
      const reg = [];
      voz._injetar({ baixarMidia: async () => Buffer.alloc(voz.LIMITE_BYTES + 1) });
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyAudio(true));
      if (reg.some((x) => x.conteudo.audio)) throw new Error('enviou audio grande');
      if (ultimoTexto(reg) !== voz.AVISO_GRANDE) throw new Error('aviso de limite diferente');
    });
  }

  await testar('duracao recusada sem baixar', async () => {
    const reg = [];
    let baixou = false;
    voz._injetar({ baixarMidia: async () => { baixou = true; return audioFalso; } });
    await porNome('esquilo').executar(sockFalso(reg), JID, msgReplyAudio(true, 999));
    if (baixou) throw new Error('baixou audio longo');
    if (ultimoTexto(reg) !== voz.AVISO_GRANDE) throw new Error('aviso de limite diferente');
  });

  await testar('ffmpeg via processo filho com array', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-modificador', 'modificador-voz.js'), 'utf8');
    if (src.indexOf('execFile') === -1) throw new Error('sem execFile');
    for (const nome of NOMES) {
      if (src.indexOf(porNome(nome)._filtro) === -1) throw new Error('filtro fora: /' + nome);
    }
  });

  await testar('limpeza de temporarios no sucesso', async () => {
    const antes = new Set(fs.readdirSync(os.tmpdir()));
    const reg = [];
    voz._injetar({
      baixarMidia: async () => audioFalso,
      rodarFfmpeg: async (args) => { fs.writeFileSync(args[args.length - 1], Buffer.from('OUT')); }
    });
    await porNome('rapido').executar(sockFalso(reg), JID, msgReplyAudio(true));
    const sobrou = fs.readdirSync(os.tmpdir()).filter((f) => f.indexOf('rapido-') === 0 && !antes.has(f));
    if (sobrou.length) throw new Error('sobrou temp: ' + sobrou.join(','));
  });

  await testar('limpeza de temporarios no erro do ffmpeg', async () => {
    const antes = new Set(fs.readdirSync(os.tmpdir()));
    const reg = [];
    voz._injetar({
      baixarMidia: async () => audioFalso,
      rodarFfmpeg: async () => { throw new Error('ffmpeg fail'); }
    });
    await porNome('lento').executar(sockFalso(reg), JID, msgReplyAudio(true));
    const sobrou = fs.readdirSync(os.tmpdir()).filter((f) => f.indexOf('lento-') === 0 && !antes.has(f));
    if (sobrou.length) throw new Error('sobrou temp no erro: ' + sobrou.join(','));
  });

  await testar('menu-efeitos lista os 8 comandos de voz', async () => {
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-efeitos', 'menu-efeitos.js'), 'utf8');
    if (menu.indexOf('MODIFICADOR DE VOZ') === -1) throw new Error('sem secao de voz');
    for (const nome of NOMES) {
      if (menu.indexOf('/' + nome) === -1) throw new Error('menu sem /' + nome);
    }
  });

  await testar('changelog cita a nova categoria', async () => {
    const log = fs.readFileSync(path.join(__dirname, '..', 'dados', 'changelog.js'), 'utf8');
    for (const nome of NOMES) {
      if (log.indexOf('/' + nome) === -1) throw new Error('changelog sem /' + nome);
    }
  });

  console.log(falhas === 0 ? 'TODOS PASSARAM' : falhas + ' FALHARAM');
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });