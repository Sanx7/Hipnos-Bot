const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const P = require('pino')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const path = require('path')
const Jimp = require('jimp') // 🚀 Biblioteca gráfica importada com sucesso

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

  // 🚨 MONITOR AUTOMÁTICO DE ENTRADAS, SAÍDAS E ANTI-BLACKLIST (GRÁFICO & DINÂMICO)
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

      // --- PARTE 2: SISTEMA GRÁFICO DINÂMICO DE BOAS-VINDAS / DESPEDIDAS ---
      if (configs.welcome?.includes(grupoId)) {
        for (const participante of participants) {
          const numeroMembro = participante.split('@')[0];
          const pastaTemp = path.join(__dirname, 'comandos', 'dados', 'temp');
          if (!fs.existsSync(pastaTemp)) fs.mkdirSync(pastaTemp, { recursive: true });

          let nomeGrupo = "Recinto";
          let contagemMembros = "—";
          
          try {
            const metadados = await sock.groupMetadata(grupoId);
            nomeGrupo = metadados.subject || "Recinto";
            contagemMembros = metadados.participants.length;
          } catch (e) {
            console.error("Erro ao obter metadados do grupo:", e);
          }

          // 📥 PORTAL DE ENTRADA (WELCOME)
          if (action === 'add') {
            const textoEntrada = `👁️‍🗨️ **NOVA ALMA NO RECINTO** 👁️‍🗨️\n\n🪐 Seja bem-vindo ao domínio de Hipnos, @${numeroMembro}.\n\n"Mantenha o silêncio e respeite o sono dos justos no grupo ${nomeGrupo}, ou as sombras cuidarão de você." 🥱💤`;
            const caminhoFundo = path.join(__dirname, 'comandos', 'dados', 'welcome.jpg');
            const caminhoSaidaTemp = path.join(pastaTemp, `welcome_${numeroMembro}.jpg`);

            if (fs.existsSync(caminhoFundo)) {
              try {
                let urlFotoPerfil;
                try {
                  urlFotoPerfil = await sock.profilePictureUrl(participante, 'image');
                } catch (e) {
                  urlFotoPerfil = 'https://i.imgur.com/6VB8Hz0.png'; 
                }

                let urlFotoGrupo;
                try {
                  urlFotoGrupo = await sock.profilePictureUrl(grupoId, 'image');
                } catch (e) {
                  urlFotoGrupo = 'https://i.imgur.com/6VB8Hz0.png'; 
                }

                const imagemFundo = await Jimp.read(caminhoFundo);
                const imagemPerfil = await Jimp.read(urlFotoPerfil);
                const imagemGrupo = await Jimp.read(urlFotoGrupo);

                imagemFundo.resize(1000, 500);

                // Foto do participante (Esquerda)
                imagemPerfil.resize(260, 260);
                imagemPerfil.circle();
                imagemFundo.composite(imagemPerfil, 74, 115);

                // Foto do grupo (Canto Superior Direito)
                imagemGrupo.resize(110, 110);
                imagemGrupo.circle();
                imagemFundo.composite(imagemGrupo, 840, 32);

                // Escrevendo os Textos no Fundo Limpo
                const fonteTitulo = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
                const fonteSubtitulo = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

                imagemFundo.print(fonteTitulo, 430, 150, "BEM VINDO(A)!");
                imagemFundo.print(fonteSubtitulo, 430, 240, `Ao grupo: ${nomeGrupo}`);
                imagemFundo.print(fonteSubtitulo, 430, 300, `Você é o membro nº ${contagemMembros}`);

                await imagemFundo.writeAsync(caminhoSaidaTemp);

                await sock.sendMessage(grupoId, {
                  image: fs.readFileSync(caminhoSaidaTemp),
                  caption: textoEntrada,
                  mentions: [participante]
                });

                if (fs.existsSync(caminhoSaidaTemp)) fs.unlinkSync(caminhoSaidaTemp);

              } catch (erroGrafico) {
                console.error("Erro ao gerar imagem de entrada:", erroGrafico);
                await sock.sendMessage(grupoId, { text: textoEntrada, mentions: [participante] });
              }
            } else {
              await sock.sendMessage(grupoId, { text: textoEntrada, mentions: [participante] });
            }

          // 📤 PORTAL DE SAÍDA / BANIMENTO (GOODBYE)
          } else if (action === 'remove') {
            const textoSaida = `🌑 **DESCENSO AO ESQUECIMENTO** 🌑\n\n@${numeroMembro} deixou nosso território e retornou para o mundo desperto. Que o limbo ignore seus passos. 🪐`;
            const caminhoFundoSaida = path.join(__dirname, 'comandos', 'dados', 'goodbye.jpg');
            const caminhoSaidaTemp = path.join(pastaTemp, `goodbye_${numeroMembro}.jpg`);

            if (fs.existsSync(caminhoFundoSaida)) {
              try {
                let urlFotoPerfil;
                try {
                  urlFotoPerfil = await sock.profilePictureUrl(participante, 'image');
                } catch (e) {
                  urlFotoPerfil = 'https://i.imgur.com/6VB8Hz0.png'; 
                }

                let urlFotoGrupo;
                try {
                  urlFotoGrupo = await sock.profilePictureUrl(grupoId, 'image');
                } catch (e) {
                  urlFotoGrupo = 'https://i.imgur.com/6VB8Hz0.png'; 
                }

                const imagemFundo = await Jimp.read(caminhoFundoSaida);
                const imagemPerfil = await Jimp.read(urlFotoPerfil);
                const imagemGrupo = await Jimp.read(urlFotoGrupo);

                imagemFundo.resize(1000, 500);
                
                // Foto do participante (Esquerda) - Alinhado à mesma métrica do Welcome
                imagemPerfil.resize(260, 260);
                imagemPerfil.circle();
                imagemFundo.composite(imagemPerfil, 74, 115);

                // Foto do grupo (Canto Superior Direito)
                imagemGrupo.resize(110, 110);
                imagemGrupo.circle();
                imagemFundo.composite(imagemGrupo, 840, 32);

                // Textos dinâmicos do Banimento sincronizados com as posições certas
                const fonteTitulo = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
                const fonteSubtitulo = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

                imagemFundo.print(fonteTitulo, 430, 140, "USUÁRIO BANIDO");
                imagemFundo.print(fonteSubtitulo, 430, 230, `Alvo: @${numeroMembro}`); 
                imagemFundo.print(fonteSubtitulo, 430, 280, `Motivo: Violação das regras`);

                await imagemFundo.writeAsync(caminhoSaidaTemp);

                await sock.sendMessage(grupoId, {
                  image: fs.readFileSync(caminhoSaidaTemp),
                  caption: textoSaida,
                  mentions: [participante]
                });

                if (fs.existsSync(caminhoSaidaTemp)) fs.unlinkSync(caminhoSaidaTemp);

              } catch (erroGrafico) {
                console.error("Erro ao gerar imagem de saída:", erroGrafico);
                await sock.sendMessage(grupoId, { text: textoSaida, mentions: [participante] });
              }
            } else {
              await sock.sendMessage(grupoId, { text: textoSaida, mentions: [participante] });
            }
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
          
          if (configs.antiAudio?.includes(jid)) {
            const ehAudio = msg.message.audioMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
            if (ehAudio) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }

          if (configs.antiDocument?.includes(jid)) {
            const ehDocumento = msg.message.documentMessage || msg.message.documentWithCaptionMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
            if (ehDocumento) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }

          if (configs.antiEvent?.includes(jid)) {
            const ehEvento = msg.message.eventMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.eventMessage;
            if (ehEvento) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }
       
          if (configs.antiLink?.includes(jid)) {
            const conteudoTexto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const temLink = /(https?:\/\/[^\s]+|www\.[^\s]+|wa\.me\/[^\s]+)/i.test(conteudoTexto);
            
            if (temLink) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              return; 
            }
          }

          if (configs.antiPayment?.includes(jid)) {
            const ehPagamentoNormal = msg.message.paymentInviteMessage;
            const ehPagamentoStealth = msg.messageStubType === 63 || msg.messageStubType === 40 || msg.messageStubType === 41;

            if (ehPagamentoNormal || ehPagamentoStealth) {
              await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender } });
              await sock.groupSettingUpdate(jid, 'announcement');
              await sock.groupParticipantsUpdate(jid, [sender], 'remove');
              await sock.sendMessage(jid, {
                text: '💀⚖️ ANATEMA PROIBIDO\n\nUma transação profana tentou se manifestar. O autor foi banido para os confins do limbo e as portas do recinto foram seladas temporariamente para purificação.'
              });
              return;
            }
          }

          if (configs.antiStatus?.includes(jid)) {
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
      qrcode.generate(qr, { small: true })
      console.log('📱 Scan the QR Code above')
    }

    if (connection === 'open') {
      console.log('🌙 Hipnos Bot connected successfully!')
    }

    if (connection === 'close') {
      console.log('🔄 Reconnecting...')

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) startBot()
    }
  })
}

startBot()