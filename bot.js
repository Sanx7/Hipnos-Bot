const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const P = require('pino')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const path = require('path')

// ====================
// CONFIGURAÇÃO DO EXPRESS (PARA O RENDER)
// ====================
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

let linkDoQrCode = '';

// Rota web onde você vai abrir no navegador para ler o QR Code
app.get('/', (req, res) => {
  if (linkDoQrCode) {
    res.send(`
      <div style="text-align: center; font-family: sans-serif; margin-top: 50px;">
        <h1>🌌 Hipnos Bot - Escaneie o QR Code</h1>
        <img src="${linkDoQrCode}" style="border: 4px solid #000; padding: 10px; background: white;" />
        <p style="color: #555;">Atualize a página se o código expirar no seu celular.</p>
      </div>
    `);
  } else {
    res.send(`
      <div style="text-align: center; font-family: sans-serif; margin-top: 50px;">
        <h1>🌙 Hipnos Bot</h1>
        <p>O bot já está conectado ou o QR Code ainda não foi gerado pelo servidor.</p>
      </div>
    `);
  }
});

// Inicializa o servidor web exigido pelo Render
app.listen(port, () => {
  console.log(`🌐 Servidor de autenticação online na porta ${port}`);
});

// ====================
// CARREGAR COMANDOS
// ====================

const comandos = new Map()

function carregarComandos(pasta) {
  const arquivos = fs.readdirSync(pasta)

  for (const arquivo of arquivos) {
    const caminho = path.join(pasta, arquivo)

    if (fs.statSync(caminho).isDirectory()) {
      carregarComandos(caminho)
    } else if (arquivo.endsWith('.js')) {
      try {
        const comando = require(caminho)

        if (comando.nome && comando.executar) {
          comandos.set(comando.nome, comando)
          console.log(`✅ Comando carregado: ${comando.nome}`)
        }
      } catch (err) {
        console.log(`❌ Erro ao carregar ${arquivo}`)
        console.log(err)
      }
    }
  }
}

const pastaComandos = path.join(__dirname, 'comandos')

if (fs.existsSync(pastaComandos)) {
  carregarComandos(pastaComandos)
}

// ====================
// BOT
// ====================

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' })
  })

  sock.ev.on('creds.update', saveCreds)

  // 🚨 MONITOR AUTOMÁTICO DE ENTRADAS, SAÍDAS E ANTI-BLACKLIST
  sock.ev.on('group-participants.update', async (atualizacao) => {
    const { id: grupoId, participants, action } = atualizacao;

    if (!participants) return;

    try {
      const caminhoConfigs = path.join(__dirname, 'comandos', 'dados', 'antias.json');
      let configs = { welcome: [] };
      if (fs.existsSync(caminhoConfigs)) {
        configs = JSON.parse(fs.readFileSync(caminhoConfigs, 'utf-8'));
      }

      // --- PARTE 1: ANTI-BLACKLIST ---
      if (action === 'add') {
        const caminhoBL = path.join(__dirname, 'comandos', 'dados', 'blacklist.json');
        if (fs.existsSync(caminhoBL)) {
          const listaNegra = JSON.parse(fs.readFileSync(caminhoBL, 'utf-8'));

          const normalizar = (p) => {
            if (!p) return '';
            const idStr = typeof p === 'object' ? (p.id || p.jid || '') : String(p);
            return idStr.split('@')[0].split(':')[0].replace(/\D/g, '');
          };

          const intrusos = participants.filter(p => {
            const clean = normalizar(p);
            return clean && listaNegra.includes(clean);
          });

          if (intrusos.length > 0) {
            const jidsParaRemover = intrusos.map(p => typeof p === 'object' ? (p.id || p.jid) : p);
            await sock.groupParticipantsUpdate(grupoId, jidsParaRemover, 'remove');
            await sock.sendMessage(grupoId, {
              text: '💀 Hipnos rejected an outcasted soul. The limbo does not forget.'
            });
            return; 
          }
        }
      }

      // --- PARTE 2: SISTEMA DE BOAS-VINDAS / DESPEDIDAS (APENAS TEXTO) ---
      if (configs.welcome?.includes(grupoId)) {

        console.log('Atualização recebida:', participants)

        for (const participante of participants) {

          const participanteId =
            typeof participante === 'object'
              ? (participante.phoneNumber || participante.id || participante.jid)
              : participante

          if (!participanteId) continue

          const numeroMembro = participanteId.split('@')[0]

          let nomeGrupo = "Recinto"
          let contagemMembros = "—"
          try {
            const metadados = await sock.groupMetadata(grupoId)
            nomeGrupo = metadados.subject || "Recinto"
            contagemMembros = metadados.participants.length
          } catch (e) {
            console.error("Erro ao obter metadados do grupo:", e)
          }

          // 📥 PORTAL DE ENTRADA (WELCOME)
          if (action === 'add') {
            const textoEntrada = `👁️‍🗨️ *NOVA ALMA NO RECINTO* 👁️‍🗨️\n\n🪐 Seja bem-vindo ao domínio de Hipnos, @${numeroMembro}.\n\n"Mantenha o silêncio e respeite o sono dos justos no grupo *${nomeGrupo}*, ou as sombras cuidarão de você." 🥱💤\n\n*Membro nº ${contagemMembros}*`;
            
            await sock.sendMessage(grupoId, { 
              text: textoEntrada, 
              mentions: [participanteId] 
            });

          // 📤 PORTAL DE SAÍDA / DESPEDIDA (GOODBYE)
          } else if (action === 'remove') {
            const textoSaida = `🌑 *DESCENSO AO ESQUECIMENTO* 🌑\n\n@${numeroMembro} deixou nosso território e retornou para o mundo desperto. Que o limbo ignore seus passos. 🪐`;
            
            await sock.sendMessage(grupoId, { 
              text: textoSaida, 
              mentions: [participanteId] 
            });
          }
        }
      }

    } catch (err) {
      console.error("Erro no monitor de participantes:", err);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages[0]

      if (!msg.message) return
      if (msg.key.fromMe) return

      const jid = msg.key.remoteJid
      const sender = msg.key.participant || msg.key.remoteJid

      // 🪐 GUARDIÕES DO LIMBO (MONITORES DE GRUPO)
      if (jid.endsWith('@g.us')) {
        const caminhoConfigs = path.join(__dirname, 'comandos', 'dados', 'antias.json');
        if (fs.existsSync(caminhoConfigs)) {
          const configs = JSON.parse(fs.readFileSync(caminhoConfigs, 'utf-8'));
          
          if (configs.antiaudio?.includes(jid)) {
            const ehAudio = msg.message.audioMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
            if (ehAudio) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }

          if (configs.antidoc?.includes(jid)) {
            const ehDocumento = msg.message.documentMessage || msg.message.documentWithCaptionMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
            if (ehDocumento) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }

          if (configs.antievento?.includes(jid)) {
            const ehEvento = msg.message.eventMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.eventMessage;
            if (ehEvento) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }
       
          if (configs.antilink?.includes(jid)) {
            const conteudoTexto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const temLink = /(https?:\/\/[^\s]+|www\.[^\s]+|wa\.me\/[^\s]+)/i.test(conteudoTexto);
            
            if (temLink) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }

          if (configs.antipay?.includes(jid)) {
            const ehPagamentoNormal = msg.message.paymentInviteMessage;
            const ehPagamentoStealth = msg.messageStubType === 63 || msg.messageStubType === 40 || msg.messageStubType === 41;

            if (ehPagamentoNormal || ehPagamentoStealth) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              await sock.groupSettingUpdate(jid, 'announcement');
              await sock.groupParticipantsUpdate(jid, [sender], 'remove');
              await sock.sendMessage(jid, {
                text: '💀⚖️ ANATEMA PROIBIDO\n\ Uma transação profana tentou se manifestar. O autor foi banido para os confins do limbo e as portas do recinto foram seladas temporariamente para purificação.'
              });
              return;
            }
          }

          if (configs.antistatus?.includes(jid)) {
            const contextInfo = msg.message.extendedTextMessage?.contextInfo || msg.message[Object.keys(msg.message)[0]]?.contextInfo;
            const marcouStatus = contextInfo?.remoteJid === 'status@broadcast';

            if (marcouStatus) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              await sock.groupParticipantsUpdate(jid, [sender], 'remove');
              await sock.sendMessage(jid, {
                text: '💀⚖️ VISÃO CEGADA\n\nA tentativa de projetar histórias ou status externos dentro deste território foi interceptada. O autor foi enviado para o esquecimento.'
              });
              return;
            }
          }
        }
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''

      const muteCmd = comandos.get("mute")
      const mutedUsers = muteCmd?.mutedUsers

      if (mutedUsers?.has(sender)) {
        return
      }
      if (!text.startsWith('/')) return

      const nomeComando = text
        .slice(1)
        .split(' ')[0]
        .toLowerCase()

      const comando = comandos.get(nomeComando)

      if (!comando) return

      if (jid.endsWith('@g.us')) {
        const caminhoConfigs = path.join(__dirname, 'comandos', 'dados', 'antias.json');
        if (fs.existsSync(caminhoConfigs)) {
          const configs = JSON.parse(fs.readFileSync(caminhoConfigs, 'utf-8'));
          
          if (configs.onlyAdmin?.includes(jid)) {
            const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
            if (numeroDoSender !== '177060848861240') {
              const metadados = await sock.groupMetadata(jid);
              const usuarioGrupo = metadados.participants.find(p => p.id === sender);
              const ehAdmin = usuarioGrupo?.admin === 'admin' || usuarioGrupo?.admin === 'superadmin';

              if (!ehAdmin) {
                return; 
              }
            }
          }
        }
      }

      await comando.executar(sock, jid, msg, text)

    } catch (err) {
      console.log('❌ Erro:')
      console.log(err)
    }
  })

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {

    if (qr) {
      // Mantém no terminal caso precise
      qrcode.generate(qr, { small: true })
      console.log('📱 Scan the QR Code above')
      
      // GERA A URL DA IMAGEM PARA O SEU NAVEGADOR
      linkDoQrCode = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    }

    if (connection === 'open') {
      console.log('🌙 Hipnos Bot connected successfully!')
      linkDoQrCode = ''; // Limpa o QR Code quando conectar
    }

    if (connection === 'close') {
      console.log('❌ Conexão fechada')
      console.log('lastDisconnect:')
      console.log(lastDisconnect)

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      console.log('Reconectar?', shouldReconnect)

      if (shouldReconnect) {
        console.log('🔄 Reconnecting...')
        startBot()
      }
    }
  })
}

startBot();