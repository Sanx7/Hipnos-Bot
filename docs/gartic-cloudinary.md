# Gartic com catálogo próprio

O `/gartic` consulta `garticImagens` no MongoDB e baixa apenas a imagem escolhida no Cloudinary. Não usa mais Pixabay, nem como fallback. Continua no registro compartilhado dos jogos: acerto por texto livre ignorando acentos, dica de categoria, desistência/cancelamento e prazo de três minutos. Rodadas já registradas não são substituídas. A contagem de atividade e o ranking permanecem no handler existente; o comando não inventa um contador próprio de pontos.

## Configuração e primeira imagem

Use o `MONGODB_URI` e o `MONGODB_DB` existentes (banco padrão `whatsapp`). Configure no ambiente:

```dotenv
CLOUDINARY_CLOUD_NAME=seu_cloud_name
CLOUDINARY_API_KEY=sua_api_key
CLOUDINARY_API_SECRET=seu_api_secret
```

As credenciais reais de `.env` não foram modificadas. `.env.example` contém apenas o modelo. O SDK oficial `cloudinary@2.11.0` usa as três variáveis explicitamente, sem expor segredo em mensagens ou logs.

1. Como dono do bot, envie uma foto comum JPEG ou PNG no WhatsApp.
2. Responda à foto com `/gartic-add cachorro`.
3. Confira a confirmação e consulte `/gartic-lista`.
4. Use `/gartic` no grupo. Para adicionar outra imagem de cachorro, responda à nova foto com o mesmo comando.

Os exemplos usam `/`; o prefixo configurado também funciona. Uploads, listagem e remoção exigem dono comprovado. O modo OFF segue o contrato existente: membros não interagem, donos continuam autorizados. Grupo com LID exige associação única nos metadados; identidades ambíguas não autorizam uploads.

## Cadastro e armazenamento

- Fotos: JPEG/PNG comuns, até 8 MB, no máximo 8192 pixels por lado e 16 megapixels. Rejeita vídeos, documentos, visualização única, formatos falsos e imagens que não podem ser decodificadas.
- Faz download Baileys em stream com limites e prazo; tenta uma renovação em 404/410. Reutiliza `ads-midia` para essa etapa.
- Decodifica com o Jimp existente, reduz para até 1280 × 1280 preservando proporção e reencoda JPEG. Isso evita transportar metadados/nomes originais no jogo.
- Preserva acentos na resposta exibida, mas usa chave normalizada sem acentos para agrupar as palavras. Aceita letras, espaços e hífens compatíveis com o comparador original.
- Categoria vem da lista atual de anagrama quando a palavra é conhecida; palavras novas usam `catálogo`. Continua aceitando `/gartic animais`, outras categorias existentes e `/gartic catalogo`.
- IDs de assets são UUIDs em `hipnos/gartic/`, sem a resposta no nome. Usa `asset_folder` para o modo dinâmico do Cloudinary e caminho completo no `public_id` para o modo fixo.

Cada registro guarda `_id`/hash SHA-256 dos bytes originais, palavra, chave normalizada, categoria, UUID do cadastro, `publicId`, conta Cloudinary, URL HTTPS, versão do Cloudinary, data de cadastro, dimensões, `ativo` e `estado`. A reserva inativa é gravada **antes** do upload; só fica ativa depois da confirmação do upload e da escrita no MongoDB. A exclusão é bloqueada se a conta configurada não corresponder à conta do cadastro.

O `_id` impede duplicar os mesmos bytes em qualquer palavra. Existem índices de busca por palavra/estado/categoria e índice único de `publicId`. Não há alteração de índices de ranking ou de outras coleções. Uma palavra pode ter várias imagens diferentes.

O sorteio agrupa palavras ativas, escolhe uma palavra e só então uma das suas imagens: palavras com mais fotos não ganham mais chance. Projeções e agregações retornam apenas metadados. Não há carga completa de imagens na inicialização. O download CDN usa JPEG otimizado, HTTPS do Cloudinary, sem redirecionamentos, limite de 8 MB e timeout de 20 segundos. Consultas MongoDB têm limite de cinco segundos. A thumbnail continua no helper ffmpeg existente e os arquivos temporários são apagados ao terminar o envio.

## Listagem e exclusão

`/gartic-lista [página]` mostra totais de palavras, imagens, ativas, pendentes/inativas e dez palavras por página, com contagens por palavra.

`/gartic-remover cachorro` gera uma prévia, sem apagar nada. Ela mostra palavra e contagem de imagens e fornece:

```text
/gartic-remover confirmar <código>
/gartic-remover cancelar
```

A confirmação vale por dois minutos e só funciona para o mesmo dono na mesma conversa. É consumida uma única vez. Um resumo criptográfico dos registros é reconferido: se o catálogo mudou, exige nova prévia.

Após confirmar, todos os registros da palavra ficam inativos antes de excluir qualquer asset. Para cada registro, confirma a exclusão Cloudinary antes de remover o registro MongoDB. Falhas ficam inativas e são informadas como pendências. Peça uma nova prévia e confirme novamente para tentar concluir uma remoção parcial. Não exclui IDs fora de `hipnos/gartic/<UUID>`.

## Falhas e limites conhecidos

- MongoDB e Cloudinary não compartilham uma transação. Se o upload foi confirmado e a gravação final falhar, tenta desativar o registro, destruir o asset e apagar a reserva. Se não puder confirmar a desativação, preserva o asset e a reserva para revisão, em vez de apagar algo que pode estar ativo.
- Upload com timeout é incerto. A reserva fica inativa, com o ID planejado preservado. Se uma tentativa de limpeza desse upload retornar `not found`, a reserva **não** é apagada: o upload pode terminar depois. Um operador deve revisar esse caso no Cloudinary/MongoDB; não há promessa de limpeza automática de toda operação ambígua.
- Mutação do catálogo é serializada no processo e por trava única em `garticControles`. A trava não expira automaticamente para não sobrepor um upload/exclusão em voo. Se um processo morrer ou não conseguir liberar a trava, um operador deve confirmar que não há operação ativa, revisar os registros/assets pendentes e remover somente a trava abandonada correspondente. Não existe comando que roube essa trava automaticamente.
- Confirmações são temporárias, em memória. Reiniciar o bot exige nova prévia. Exclusões já iniciadas podem deixar registros inativos que precisam de outra tentativa confirmada.
- SHA-256 detecta bytes idênticos. A mesma foto recomprimida, recortada ou com metadados diferentes pode ter outro hash.
- A validação é técnica de imagem; não verifica automaticamente se a foto corresponde à palavra cadastrada. Cabe ao dono fazer a curadoria.
- Exclusão com `invalidate` pode levar tempo para se refletir em caches CDN. Partidas que já possuem a imagem baixada continuam com sua resposta original.
- Custos, cotas e política de transformações do Cloudinary dependem da conta. Os testes não validam a configuração real, uploads, MongoDB remoto ou dispositivos WhatsApp.

## Testes offline

```powershell
node scripts/teste-gartic-catalogo.js
node scripts/teste-gartic.js
node scripts/teste-on-off.js
node scripts/teste-loader.js
git diff --check
```

Usam coleções, SDK e HTTP falsos, imagens JPEG/PNG decodificadas de verdade e o helper real de thumbnail. Não iniciar `bot.js` para rodar esses testes. Não foi feito upload real, commit ou deploy.

Resultado: 36 testes do catálogo, 20 do jogo e 81 de ON/OFF passaram, além do loader com 584 entradas e das verificações de sintaxe/diff.

## Arquivos desta integração

Criados: `gartic-catalogo.js`, `dados/gartic-cloudinary.js`, `dados/gartic-midia.js`, `dados/gartic-mongo.js`, `comandos/menu-dono/gartic-catalogo.js`, `scripts/teste-gartic-catalogo.js`, `scripts/helpers/gartic-fake.js` e este documento.

Alterados: `comandos/menu-brincadeiras/gartic.js`, `comandos/menu-brincadeiras/menu-brincadeiras.js`, `comandos/menu-dono/menu-dono.js`, `scripts/teste-gartic.js`, `scripts/teste-on-off.js`, `.env.example`, `package.json` e `package-lock.json`. Alterações anteriores de Verdade ou Consequência foram preservadas.

Referências oficiais: [upload com SDK Node.js](https://cloudinary.com/documentation/node_image_and_video_upload), [Upload API e destroy](https://cloudinary.com/documentation/image_upload_api_reference), [transformações](https://cloudinary.com/documentation/transformation_reference).
