const fs = require('fs');
const path = require('path');

const BANCO_CONFIG = path.join(__dirname, '..', 'dados', 'antias.json');

function lerConfiguracoes() {
  try {
    const pastaDados = path.dirname(BANCO_CONFIG);
    if (!fs.existsSync(pastaDados)) {
      fs.mkdirSync(pastaDados, { recursive: true });
    }
    if (!fs.existsSync(BANCO_CONFIG)) {
      const padrao = { antiAudio: [], antiDocument: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.antiDocument) json.antiDocument = [];
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [] };
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
  nome: "antidoc", // Alterado para o nome que você escolheu!
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não desperdiça feitiços fora de um territory coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre os pergaminhos deste reino.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para barrar arquivos e documentos ou 0 para permiti-los.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.antiDocument.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 A barreira contra documentos e arquivos já está erguida. Nada passará.' 
          }, { quoted: msg });
        }
        
        configs.antiDocument.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ REFEITURA DO LIMBO\n\n⚙️ Hipnos ativou o bloqueio de pergaminhos.\n📂 Qualquer arquivo ou documento enviado por meros mortais será banido da realidade.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.antiDocument.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ Os documentos já transitam livremente por aqui. Não há selo para quebrar.' 
          }, { quoted: msg });
        }
        
        configs.antiDocument = configs.antiDocument.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ O selo foi desfeito. Hipnos permite que arquivos e papéis materiais voltem a circular.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para selar os documentos ou 0 para liberá-los.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando antidoc:', err);
    }
  }
};