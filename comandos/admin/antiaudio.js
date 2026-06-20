const fs = require('fs');
const path = require('path');

// Banco onde fica salvo quais grupos ativaram a restrição
const BANCO_CONFIG = path.join(__dirname, '..', 'dados', 'antias.json');

function lerConfiguracoes() {
  try {
    const pastaDados = path.dirname(BANCO_CONFIG);
    if (!fs.existsSync(pastaDados)) {
      fs.mkdirSync(pastaDados, { recursive: true });
    }
    if (!fs.existsSync(BANCO_CONFIG)) {
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify({ antiAudio: [] }, null, 2));
      return { antiAudio: [] };
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    return JSON.parse(dados);
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [] };
  }
}

function salvarConfiguracoes(config) {
  try {
    fs.writeFileSync(BANCO_CONFIG, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Erro ao salvar antias.json:", err);
  }
}

module.exports = {
  nome: "anti-audio",
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não desperdiça feitiços fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre as frequências do silêncio.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para impor o silêncio absoluto ou 0 para libertar as vozes.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.antiAudio.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 O manto do silêncio já está estendido sobre este recinto. Nenhuma voz profana passará.' 
          }, { quoted: msg });
        }
        
        configs.antiAudio.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ RITUAL DE SILÊNCIO\n\n⚙️ Hipnos ativou a vigilância sombria.\n🎧 Qualquer mensagem de áudio enviada por meros mortais será imediatamente consumida pelo limbo.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.antiAudio.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ As vozes já vagam livremente por aqui. Não há barreira para ser desfeita.' 
          }, { quoted: msg });
        }
        
        configs.antiAudio = configs.antiAudio.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ A restrição foi desfeita. Hipnos recolhe suas sombras e permite que os sussurros ecoem novamente.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para selar os áudios ou 0 para libertá-los.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando anti-audio:', err);
    }
  }
};