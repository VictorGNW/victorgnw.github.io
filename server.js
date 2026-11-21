/* Servidor do Achados do Lourdes  (VERSÃO PARA HOSPEDAGEM)
   - Serve o site (index.html, style.css, script.js...)
   - Guarda os itens e pedidos em  dados/banco.json
   - Guarda as fotos em            dados/fotos/
   - Faz cópia de segurança em     dados/backups/
   Não precisa instalar nada: basta ter o Node.js (versão 18 ou mais nova).

   CONFIGURAÇÃO (variáveis de ambiente):
     SENHA_COORDENACAO   senha da coordenação (OBRIGATÓRIA; o servidor não liga sem ela). É a conta "coordenacao"
     CONTAS_COORDENACAO  (opcional) contas extras para o registro de atividades saber quem fez cada ação.
                         Formato:  usuario:senha;outro:senha2   (usuário com 2 a 30 letras minúsculas, números, . _ -;
                         senha com 8+ caracteres e sem ";"). Quem não preencher o usuário no login entra como "coordenacao".
     PORT               porta do servidor (padrão 3000)
     HOST                endereço de escuta (padrão 0.0.0.0, necessário no Render)
     DATA_DIR            pasta persistente dos dados (no Render: /var/data)
     CONFIAR_PROXY       "sim" quando há Caddy/Cloudflare na frente (usa o IP real do visitante)
     BACKUPS_MANTER      quantos backups guardar (padrão 14)
     HTTPS_CERT          caminho do certificado (.pem/.crt) para o servidor falar HTTPS sozinho
     HTTPS_KEY           caminho da chave privada (.pem/.key); precisa vir junto com HTTPS_CERT
     PORTA_HTTP          (com HTTPS) porta extra que só redireciona para HTTPS
     FORCAR_HTTPS        "sim" para redirecionar HTTP para HTTPS (com proxy, exige CONFIAR_PROXY=sim)
     HSTS_SEGUNDOS       validade do HSTS em segundos (padrão 31536000; 0 desliga)
     ORIGENS_PERMITIDAS  outras origens autorizadas a chamar a API, separadas por vírgula

   Exemplo:  SENHA_COORDENACAO="uma-senha-forte" CONFIAR_PROXY=sim node server.js     */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const BancoAlunos = require("./banco.js");

const HTTPS_CERT = process.env.HTTPS_CERT || "";
const HTTPS_KEY = process.env.HTTPS_KEY || "";
const USAR_HTTPS = !!(HTTPS_CERT && HTTPS_KEY);
if (!!HTTPS_CERT !== !!HTTPS_KEY) {
  console.error("\nERRO: para usar HTTPS defina HTTPS_CERT e HTTPS_KEY juntos.\n");
  process.exit(1);
}
const PORTA = process.env.PORT || (USAR_HTTPS ? 3443 : 3000);
const PORTA_HTTP = process.env.PORTA_HTTP || "";
const FORCAR_HTTPS = process.env.FORCAR_HTTPS === "sim";
const HSTS_SEGUNDOS = process.env.HSTS_SEGUNDOS === undefined ? 31536000 : Math.max(0, Number(process.env.HSTS_SEGUNDOS) || 0);
const ORIGENS_PERMITIDAS = (process.env.ORIGENS_PERMITIDAS || "").split(",").map(x => x.trim()).filter(Boolean);
const LIMITE_RA_ERROS = Math.max(3, Number(process.env.LIMITE_RA_ERROS) || 15); // erros de RA por IP a cada 15 min
const CATEGORIAS = ["Roupas", "Material escolar", "Eletrônicos", "Garrafas e lancheiras", "Documentos", "Outros"]; // iguais às do site
const LOCAIS = ["Pátio", "Cantina", "Biblioteca", "Laboratório de informática", "Quadra", "Salas de aula"];
const MAX_ITENS = 2000;    // teto de itens guardados (evita encher o disco)
const MAX_PEDIDOS = 10000; // teto de pedidos guardados
const HOST = process.env.HOST || "0.0.0.0";
const CONFIAR_PROXY = process.env.CONFIAR_PROXY === "sim";
const BACKUPS_MANTER = Number(process.env.BACKUPS_MANTER) || 14;
const RAIZ = __dirname;
const PASTA_DADOS = path.resolve(process.env.DATA_DIR || path.join(RAIZ, "dados"));
const PASTA_FOTOS = path.join(PASTA_DADOS, "fotos");
const ARQ_BANCO = path.join(PASTA_DADOS, "banco.json");
const PASTA_BACKUPS = path.join(PASTA_DADOS, "backups");
const SENHA = process.env.SENHA_COORDENACAO || "";
if (SENHA.length < 8) {
  console.error("\nERRO: defina a senha da coordenação com pelo menos 8 caracteres.");
  console.error('Exemplo:  SENHA_COORDENACAO="troque-esta-senha" node server.js\n');
  process.exit(1);
}
const SENHAS_FRACAS = ["lourdes", "12345678", "password", "senha123"];
if (SENHAS_FRACAS.includes(SENHA.toLowerCase())) {
  console.error("\nERRO: essa senha é fraca demais para ficar na internet. Escolha outra.\n");
  process.exit(1);
}

/* Contas da coordenação: "coordenacao" (SENHA_COORDENACAO) e as extras de CONTAS_COORDENACAO.
   Cada ação administrativa fica registrada com o nome da conta que a fez. */
const CONTA_PADRAO = "coordenacao";
const CONTAS = new Map([[CONTA_PADRAO, SENHA]]); // usuário -> senha
for (const parte of (process.env.CONTAS_COORDENACAO || "").split(";")) {
  if (!parte.trim()) continue;
  const pos = parte.indexOf(":");
  const usuario = (pos < 0 ? parte : parte.slice(0, pos)).trim().toLowerCase();
  const senhaConta = pos < 0 ? "" : parte.slice(pos + 1);
  if (!/^[a-z0-9._-]{2,30}$/.test(usuario) || CONTAS.has(usuario)) {
    console.error('\nERRO em CONTAS_COORDENACAO: usuário inválido, repetido ou reservado ("' + usuario.slice(0, 30) + '"). Use o formato usuario:senha;outro:senha2\n');
    process.exit(1);
  }
  if (senhaConta.length < 8 || SENHAS_FRACAS.includes(senhaConta.toLowerCase())) {
    console.error('\nERRO em CONTAS_COORDENACAO: a senha da conta "' + usuario + '" é curta (mínimo 8 caracteres) ou fraca demais.\n');
    process.exit(1);
  }
  CONTAS.set(usuario, senhaConta);
}
const LIMITE_CORPO = 2 * 1024 * 1024; // 2 MB por requisição (as fotos já chegam reduzidas a 640 px)

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

/* ---------- Banco de dados (arquivo JSON) ---------- */

const dia = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const exemplos = () => ({
  itens: [
    { id: 1, nome: "Garrafa azul", cat: "Garrafas e lancheiras", local: "Quadra", data: dia(1), desc: "Garrafa térmica azul com adesivo na tampa.", status: "disponivel" },
    { id: 2, nome: "Casaco cinza do uniforme", cat: "Roupas", local: "Pátio", data: dia(2), desc: "Tamanho M, com um nome bordado na manga.", status: "disponivel" },
    { id: 3, nome: "Fone de ouvido preto", cat: "Eletrônicos", local: "Laboratório de informática", data: dia(3), desc: "Fone com fio, encontrado embaixo de uma bancada.", status: "disponivel" },
    { id: 4, nome: "Caderno de Matemática", cat: "Material escolar", local: "Salas de aula", data: dia(4), desc: "Capa verde, folhas soltas dentro.", status: "disponivel" },
    { id: 5, nome: "Carteirinha escolar", cat: "Documentos", local: "Cantina", data: dia(5), desc: "Carteirinha de estudante, foto de aluno do turno da manhã.", status: "disponivel" },
    { id: 6, nome: "Estojo vermelho", cat: "Material escolar", local: "Biblioteca", data: dia(6), desc: "Estojo com canetas coloridas e uma calculadora.", status: "disponivel" }
  ],
  pedidos: [],
  prox: 7,
  atividades: [], proxAtiv: 1,     // registro de ações da coordenação
  notificacoes: [], proxNotif: 1,  // avisos para a coordenação e para os alunos
  perdidos: [], proxPerd: 1        // avisos de "perdi um objeto" feitos pelos alunos
});

function garantirPastas() {
  fs.mkdirSync(PASTA_FOTOS, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(PASTA_DADOS, 0o700); fs.chmodSync(PASTA_FOTOS, 0o700); } catch (e) { /* Windows ignora */ }
}

function gravarBanco(banco) {
  garantirPastas();
  // grava num arquivo temporário e renomeia, para nunca deixar o banco pela metade
  const tmp = ARQ_BANCO + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(banco, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ARQ_BANCO);
}

function lerBanco() {
  garantirPastas();
  if (!fs.existsSync(ARQ_BANCO)) {
    const novo = exemplos();
    gravarBanco(novo);
    return novo;
  }

  let b;
  try {
    b = JSON.parse(fs.readFileSync(ARQ_BANCO, "utf8"));
  } catch (e) {
    throw new Error("O banco de dados existe, mas não pôde ser lido. Os dados foram preservados em " + ARQ_BANCO + "; restaure uma cópia de segurança antes de reiniciar.", { cause: e });
  }

  if (!b || !Array.isArray(b.itens) || !Array.isArray(b.pedidos) || !Number.isInteger(b.prox)) {
    throw new Error("O banco de dados existe, mas tem formato inválido. Os dados foram preservados em " + ARQ_BANCO + "; restaure uma cópia de segurança antes de reiniciar.");
  }

  let migrado = false;
  for (const pedido of b.pedidos) {
    if (!pedido.alunoRa && Number.isInteger(pedido.alunoId)) {
      const aluno = BancoAlunos.porId(pedido.alunoId);
      if (aluno) { pedido.alunoRa = aluno.codigo; migrado = true; }
    }
    if (pedido.status === "liberado") {
      const item = b.itens.find(i => i.id === pedido.itemId);
      if (item && item.status === "disponivel") { item.status = "retirada_liberada"; migrado = true; }
    }
  }
  // bancos criados antes do registro de atividades e das notificações ganham os campos novos
  if (!Array.isArray(b.atividades)) { b.atividades = []; migrado = true; }
  if (!Array.isArray(b.notificacoes)) { b.notificacoes = []; migrado = true; }
  const maiorId = lista => lista.reduce((m, x) => Math.max(m, Number(x && x.id) || 0), 0);
  if (!Number.isInteger(b.proxAtiv)) { b.proxAtiv = maiorId(b.atividades) + 1; migrado = true; }
  if (!Number.isInteger(b.proxNotif)) { b.proxNotif = maiorId(b.notificacoes) + 1; migrado = true; }
  // bancos criados antes dos avisos de objeto perdido ganham os campos novos
  if (!Array.isArray(b.perdidos)) { b.perdidos = []; migrado = true; }
  if (!Number.isInteger(b.proxPerd)) { b.proxPerd = maiorId(b.perdidos) + 1; migrado = true; }
  if (migrado) gravarBanco(b);
  return b;
}

function apagarFotos() {
  garantirPastas();
  for (const nome of fs.readdirSync(PASTA_FOTOS)) {
    try { fs.unlinkSync(path.join(PASTA_FOTOS, nome)); } catch (e) { /* ignora */ }
  }
}

function apagarFotoDoItem(item) {
  if (!item || !item.foto) return;
  const nome = path.basename(item.foto); // basename impede sair da pasta de fotos
  try { fs.unlinkSync(path.join(PASTA_FOTOS, nome)); } catch (e) { /* ignora */ }
}

/* ---------- IP do visitante e limites de uso ---------- */

/* Atrás de um proxy todo acesso chega como 127.0.0.1. Só confiamos no cabeçalho do proxy
   quando CONFIAR_PROXY=sim, senão qualquer pessoa poderia forjá-lo e escapar dos limites. */
function ipDe(req) {
  if (CONFIAR_PROXY) {
    const cf = req.headers["cf-connecting-ip"];           // Cloudflare
    if (cf) return String(cf).trim();
    const xff = req.headers["x-forwarded-for"];           // Caddy / outros
    if (xff) return String(xff).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "desconhecido";
}

/* Limitador simples: no máximo "max" ações a cada "janelaMs" por IP (fica só na memória) */
function criarLimite(max, janelaMs) {
  const usos = new Map(); // ip -> [instantes]
  const limpar = setInterval(() => {
    const agora = Date.now();
    for (const [ip, lista] of usos) {
      const recentes = lista.filter(t => agora - t < janelaMs);
      recentes.length ? usos.set(ip, recentes) : usos.delete(ip);
    }
  }, 60 * 1000);
  limpar.unref(); // não impede o servidor de desligar
  return {
    // devolve true se ainda pode; registra o uso
    permitir(ip) {
      const agora = Date.now();
      const recentes = (usos.get(ip) || []).filter(t => agora - t < janelaMs);
      if (recentes.length >= max) { usos.set(ip, recentes); return false; }
      recentes.push(agora);
      usos.set(ip, recentes);
      return true;
    },
    // só consulta, sem registrar
    bloqueado(ip) {
      const agora = Date.now();
      return (usos.get(ip) || []).filter(t => agora - t < janelaMs).length >= max;
    },
    registrar(ip) {
      const agora = Date.now();
      const recentes = (usos.get(ip) || []).filter(t => agora - t < janelaMs);
      recentes.push(agora);
      usos.set(ip, recentes);
    },
    zerar(ip) { usos.delete(ip); }
  };
}

const limiteLogin = criarLimite(5, 15 * 60 * 1000);   // 5 erros de senha a cada 15 min por IP
const limitePedidos = criarLimite(60, 60 * 60 * 1000);       // 60 pedidos por hora por IP (a escola toda pode compartilhar o mesmo IP)
const limitePedidosAluno = criarLimite(8, 60 * 60 * 1000);   // 8 pedidos por hora por aluno
const limiteRA = criarLimite(LIMITE_RA_ERROS, 15 * 60 * 1000); // erros de RA por IP (impede ficar adivinhando RAs)
const limitePerdidos = criarLimite(60, 60 * 60 * 1000);      // 60 avisos de objeto perdido por hora por IP (a escola pode compartilhar o IP)
const limitePerdidosAluno = criarLimite(5, 60 * 60 * 1000);  // 5 avisos por hora por aluno
const limiteGeral = criarLimite(300, 60 * 1000);      // 300 chamadas à API por minuto por IP

/* Compara senhas sem vazar informação pelo tempo de resposta */
function senhaConfere(informada, esperada = SENHA) {
  const a = crypto.createHash("sha256").update(String(informada || "")).digest();
  const b = crypto.createHash("sha256").update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------- Backup ---------- */

/* Copia o banco.json para dados/backups/banco-AAAA-MM-DD.json (1 por dia) e apaga os mais antigos.
   As fotos NÃO entram: são arquivos já guardados em dados/fotos/. Para uma cópia completa, copie a pasta dados/. */
function fazerBackup() {
  try {
    if (!fs.existsSync(ARQ_BANCO)) return;
    fs.mkdirSync(PASTA_BACKUPS, { recursive: true });
    const hoje = new Date().toISOString().slice(0, 10);
    const destino = path.join(PASTA_BACKUPS, "banco-" + hoje + ".json");
    fs.copyFileSync(ARQ_BANCO, destino);
    const antigos = fs.readdirSync(PASTA_BACKUPS).filter(n => /^banco-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    while (antigos.length > BACKUPS_MANTER) fs.unlinkSync(path.join(PASTA_BACKUPS, antigos.shift()));
  } catch (e) {
    console.error("Aviso: não foi possível fazer o backup:", e.message);
  }
}

/* ---------- Registro de eventos de segurança ---------- */

/* Anota em dados/seguranca.log (e no terminal) logins, bloqueios e resets, com o IP de quem fez.
   Nunca grava senhas. O arquivo é limitado: passando de 1 MB vira seguranca.log.1 (e o antigo .1 é apagado). */
const ARQ_LOG = path.join(PASTA_DADOS, "seguranca.log");
function registrarSeguranca(evento, ip, detalhe) {
  const linha = new Date().toISOString() + " " + evento + " ip=" + String(ip || "?").slice(0, 64) + (detalhe ? " " + String(detalhe).replace(/[\r\n]+/g, " ").slice(0, 200) : "");
  console.log("[seguranca] " + linha);
  try {
    garantirPastas();
    try { if (fs.statSync(ARQ_LOG).size > 1024 * 1024) fs.renameSync(ARQ_LOG, ARQ_LOG + ".1"); } catch (e) { /* ainda não existe */ }
    fs.appendFileSync(ARQ_LOG, linha + "\n", { mode: 0o600 });
  } catch (e) { /* o log nunca pode derrubar o site */ }
}

/* ---------- Sessão da coordenação ---------- */

const VALIDADE_SESSAO = 8 * 60 * 60 * 1000; // 8 horas
const MAX_SESSOES = 50;
const sessoes = new Map(); // token -> { expira, conta } (fica só na memória)
setInterval(() => { // limpa sessões vencidas que ninguém usou mais
  const agora = Date.now();
  for (const [t, sess] of sessoes) if (agora > sess.expira) sessoes.delete(t);
  for (const [t, sess] of sessoesAluno) if (agora > sess.expira) sessoesAluno.delete(t);
}, 10 * 60 * 1000).unref();

/* Sessão do ALUNO: o servidor confere o RA e entrega um token. O token vai no cabeçalho X-Aluno-Token
   (separado do Authorization da coordenação). Quem manda o pedido é sempre o aluno da sessão,
   nunca o nome/RA enviado pelo navegador. */
const VALIDADE_SESSAO_ALUNO = 8 * 60 * 60 * 1000;
const MAX_SESSOES_ALUNO = 5000;
const sessoesAluno = new Map(); // token -> { id, expira }

function alunoDaSessao(req) {
  const token = String(req.headers["x-aluno-token"] || "");
  const sess = sessoesAluno.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expira) { sessoesAluno.delete(token); return null; }
  return BancoAlunos.porId(sess.id);
}

/* Nome da conta da coordenação dona da sessão (ou null se não estiver logada) */
function contaDaSessao(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const sess = sessoes.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expira) { sessoes.delete(token); return null; }
  return sess.conta;
}

function coordenacaoLogada(req) {
  return !!contaDaSessao(req);
}

/* ---------- Utilidades de HTTP ---------- */

function responderJSON(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...cabecalhosSeguranca(res)
  });
  res.end(dados);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on("data", parte => {
      total += parte.length;
      if (total > LIMITE_CORPO) {
        reject(new Error("grande"));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on("end", () => {
      try {
        const txt = Buffer.concat(partes).toString("utf8");
        resolve(txt ? JSON.parse(txt) : {});
      } catch (e) { reject(new Error("json")); }
    });
    req.on("error", reject);
  });
}

/* data AAAA-MM-DD que existe de verdade (recusa 2026-02-30 e 2026-13-45) */
const dataReal = d => { const t = Date.parse(d + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; };
const texto = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

/* Salva uma foto enviada como "data URL" (data:image/jpeg;base64,...) em dados/fotos/ */
function salvarFoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > 1024 * 1024) return null; // o site já reduz para 640 px (dezenas de KB)
  // confere os primeiros bytes: o conteúdo precisa ser mesmo uma imagem do tipo declarado
  const ehJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const ehPng = bytes.length > 8 && bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  const ehWebp = bytes.length > 12 && bytes.slice(0, 4).toString("latin1") === "RIFF" && bytes.slice(8, 12).toString("latin1") === "WEBP";
  if (!((m[1] === "jpeg" && ehJpeg) || (m[1] === "png" && ehPng) || (m[1] === "webp" && ehWebp))) return null;
  garantirPastas();
  const nome = crypto.randomBytes(8).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(PASTA_FOTOS, nome), bytes, { mode: 0o600 });
  return "dados/fotos/" + nome;
}

/* ---------- Registro de atividades, notificações e painel ---------- */

const MAX_ATIVIDADES = 5000;     // as mais antigas saem quando passa do teto
const MAX_NOTIFICACOES = 5000;
const DIAS_NOTIFICACAO_LIDA = 30; // avisos já lidos são apagados depois disso
const PARA_COORDENACAO = "coordenacao"; // destinatário das notificações da coordenação (alunos usam o id numérico)

/* Anota no banco (b) uma ação administrativa e a conta que a fez. Chame antes de gravarBanco(b). */
function registrarAtividade(b, conta, acao, descricao, extra) {
  b.atividades.push({ id: b.proxAtiv++, em: new Date().toISOString(), conta: texto(conta, 30) || "?", acao, descricao: texto(descricao, 300), ...(extra || {}) });
  if (b.atividades.length > MAX_ATIVIDADES) b.atividades.splice(0, b.atividades.length - MAX_ATIVIDADES);
}

/* Cria uma notificação para a coordenação (PARA_COORDENACAO) ou para um aluno (id). Chame antes de gravarBanco(b). */
function notificar(b, para, tipo, msg, extra) {
  if (para === null || para === undefined) return;
  b.notificacoes.push({ id: b.proxNotif++, em: new Date().toISOString(), para, tipo, texto: texto(msg, 300), lida: false, ...(extra || {}) });
  const limite = Date.now() - DIAS_NOTIFICACAO_LIDA * 86400000;
  b.notificacoes = b.notificacoes.filter(n => !n.lida || Date.parse(n.em) > limite);
  if (b.notificacoes.length > MAX_NOTIFICACOES) b.notificacoes.splice(0, b.notificacoes.length - MAX_NOTIFICACOES);
}

/* Id do aluno dono do pedido (pedidos antigos podem ter só o RA) */
function alunoIdDoPedido(p) {
  if (Number.isInteger(p.alunoId)) return p.alunoId;
  const aluno = p.alunoRa ? BancoAlunos.porCodigo(p.alunoRa) : null;
  return aluno ? aluno.id : null;
}

const nomeDoItem = item => item ? item.nome : "item removido";

/* Números do painel de situação, tirados direto dos itens e pedidos. Cada item cai em UMA só faixa:
   cadastrados = devolvidos + aguardando retirada + novas solicitações. */
function calcularPainel(b) {
  const comPedidoNovo = new Set(b.pedidos.filter(p => p.status === "pendente").map(p => p.itemId));
  let devolvidos = 0, retiradaLiberada = 0, semDono = 0, novasSolicitacoes = 0;
  for (const i of b.itens) {
    if (i.status === "devolvido") devolvidos++;
    else if (i.status === "retirada_liberada") retiradaLiberada++;
    else if (comPedidoNovo.has(i.id)) novasSolicitacoes++;
    else semDono++;
  }
  return { cadastrados: b.itens.length, devolvidos, aguardandoRetirada: semDono + retiradaLiberada, novasSolicitacoes, detalhe: { semDono, retiradaLiberada } };
}

function resumoNotificacoes(b, para) {
  const minhas = b.notificacoes.filter(n => n.para === para);
  return { minhas, naoLidas: minhas.filter(n => !n.lida).length, ultimoId: minhas.reduce((m, n) => Math.max(m, n.id), 0) };
}

/* ?resumo=1 devolve só os contadores (usado na checagem periódica); sem isso, as 50 mais recentes */
function responderNotificacoes(req, res, b, para) {
  const r = resumoNotificacoes(b, para);
  if (new URL(req.url, "http://localhost").searchParams.get("resumo")) return responderJSON(res, 200, { naoLidas: r.naoLidas, ultimoId: r.ultimoId });
  const lista = r.minhas.slice(-50).reverse().map(n => ({ id: n.id, em: n.em, tipo: n.tipo, texto: n.texto, lida: !!n.lida, pedidoId: n.pedidoId }));
  return responderJSON(res, 200, { naoLidas: r.naoLidas, ultimoId: r.ultimoId, notificacoes: lista });
}

function marcarLidas(b, para) {
  let mudou = false;
  for (const n of b.notificacoes) if (n.para === para && !n.lida) { n.lida = true; mudou = true; }
  return mudou;
}

/* ---------- Avisos de "perdi um objeto" ---------- */

const MAX_PERDIDOS = 2000;          // teto de avisos guardados
const MAX_PERDIDOS_ABERTOS = 5;     // avisos abertos ao mesmo tempo por aluno
const DIAS_PERDIDO_ENCERRADO = 30;  // avisos encerrados são apagados depois disso

const normalizarTexto = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").trim();
const PALAVRAS_COMUNS = new Set(["com", "uma", "uns", "para", "por", "que", "dos", "das", "mas", "sem", "meu", "seu", "sua", "minha", "tem", "foi", "ele", "ela", "cor", "item", "objeto", "perdi", "achado"]);
const palavrasChave = s => new Set(normalizarTexto(s).split(/\s+/).filter(w => w.length > 2 && !PALAVRAS_COMUNS.has(w)));
function palavrasEmComum(a, b) {
  const B = palavrasChave(b);
  let n = 0;
  for (const w of palavrasChave(a)) if (B.has(w)) n++;
  return n;
}

/* O item achado pode ser o objeto perdido? Precisa estar disponível e ser da mesma categoria, com ao menos uma
   palavra importante em comum (nome ou descrição). No modo não estrito (sugestão para a coordenação, que confere
   com os próprios olhos) também vale o mesmo local. O aviso automático ao aluno usa o modo estrito. */
function perdidoCasaComItem(p, item, estrito) {
  if (!item || item.status !== "disponivel" || item.cat !== p.cat) return false;
  if (palavrasEmComum(p.nome + " " + p.desc, item.nome + " " + item.desc) > 0) return true;
  return !estrito && !!p.local && p.local === item.local;
}

const itensPossiveis = (b, p, estrito) => b.itens.filter(i => perdidoCasaComItem(p, i, estrito));

/* Remove avisos já encerrados há muito tempo. Chame antes de gravarBanco(b). */
function podarPerdidos(b) {
  const limite = Date.now() - DIAS_PERDIDO_ENCERRADO * 86400000;
  b.perdidos = b.perdidos.filter(p => p.status === "aberto" || Date.parse(p.encerradoEm || p.criadoEm) > limite);
}

/* Visão do aluno: só os avisos dele */
const perdidoParaAluno = p => ({ id: p.id, nome: p.nome, cat: p.cat, local: p.local, data: p.data, desc: p.desc, status: p.status, criadoEm: p.criadoEm,
  possivel: !!p.possivelEm, possivelItem: p.possivelItemNome || "" }); // "possivel": a coordenação marcou um possível objeto encontrado

/* ---------- API ---------- */

async function api(req, res, rota) {
  try {
    if (!limiteGeral.permitir(ipDe(req))) {
      return responderJSON(res, 429, { erro: "Muitas requisições. Aguarde um instante." });
    }
    // GET /api/dados -> dados completos para a coordenação; visão pública com nomes mínimos.
    if (req.method === "GET" && rota === "/api/dados") {
      const b = lerBanco();
      if (coordenacaoLogada(req)) {
        // o registro de atividades e as notificações têm rotas próprias; aqui vai o painel de situação
        const { atividades, notificacoes, perdidos, proxAtiv, proxNotif, proxPerd, ...base } = b;
        return responderJSON(res, 200, { ...base, painel: calcularPainel(b) });
      }
      const logadoAluno = !!alunoDaSessao(req); // quem não está logado não recebe nomes de alunos
      const pendentes = b.pedidos.filter(p => p.status === "pendente" || p.status === "liberado").map(p => ({
        itemId: p.itemId,
        status: p.status,
        solicitadoPor: logadoAluno ? (texto(p.nome, 80).split(/\s+/)[0] || "aluno") : "aluno",
        liberadoPara: p.status === "liberado" ? (logadoAluno ? texto(p.nome, 80) : "aluno") : null
      }));
      return responderJSON(res, 200, { itens: b.itens, pedidos: pendentes });
    }


    // POST /api/login  -> senha da coordenação
    if (req.method === "POST" && rota === "/api/login") {
      const ip = ipDe(req);
      if (limiteLogin.bloqueado(ip)) {
        registrarSeguranca("login_bloqueado", ip, "muitas tentativas erradas");
        return responderJSON(res, 429, { erro: "Muitas tentativas. Aguarde 15 minutos e tente de novo." });
      }
      const c = await lerCorpo(req);
      const conta = texto(c.usuario, 30).toLowerCase() || CONTA_PADRAO; // sem usuário = conta padrão (como era antes)
      const senhaDaConta = CONTAS.get(conta);
      // compara sempre (mesmo com usuário inexistente) para não vazar pelo tempo de resposta quais usuários existem
      const confere = senhaConfere(c.senha, senhaDaConta === undefined ? SENHA : senhaDaConta);
      if (!confere || senhaDaConta === undefined) {
        limiteLogin.registrar(ip); // só erros contam
        registrarSeguranca("login_falhou", ip, "conta=" + conta);
        return responderJSON(res, 401, { erro: c.usuario ? "Usuário ou senha incorretos." : "Senha incorreta." });
      }
      limiteLogin.zerar(ip);
      registrarSeguranca("login_ok", ip, "conta=" + conta);
      const token = crypto.randomBytes(24).toString("hex");
      while (sessoes.size >= MAX_SESSOES) sessoes.delete(sessoes.keys().next().value); // descarta a mais antiga
      sessoes.set(token, { expira: Date.now() + VALIDADE_SESSAO, conta });
      return responderJSON(res, 200, { token, conta });
    }

    // POST /api/logout
    // POST /api/aluno/login -> o servidor confere o RA (a lista de alunos NÃO é mais enviada ao navegador)
    if (req.method === "POST" && rota === "/api/aluno/login") {
      const ip = ipDe(req);
      if (limiteRA.bloqueado(ip)) {
        registrarSeguranca("ra_bloqueado", ip, "muitas tentativas de RA");
        return responderJSON(res, 429, { erro: "Muitas tentativas de RA. Aguarde 15 minutos e tente de novo." });
      }
      const c = await lerCorpo(req);
      const ra = texto(c.ra, 6);
      const aluno = /^\d{6}$/.test(ra) ? BancoAlunos.porCodigo(ra) : null;
      if (!aluno) {
        limiteRA.registrar(ip);
        registrarSeguranca("ra_invalido", ip);
        return responderJSON(res, 401, { erro: "RA não encontrado. Confira os 6 dígitos." });
      }
      const token = crypto.randomBytes(24).toString("hex");
      while (sessoesAluno.size >= MAX_SESSOES_ALUNO) sessoesAluno.delete(sessoesAluno.keys().next().value);
      sessoesAluno.set(token, { id: aluno.id, expira: Date.now() + VALIDADE_SESSAO_ALUNO });
      return responderJSON(res, 200, { token, aluno: { id: aluno.id, nome: aluno.nome, turma: aluno.turma, ano: aluno.ano } });
    }

    if (req.method === "POST" && rota === "/api/aluno/logout") {
      sessoesAluno.delete(String(req.headers["x-aluno-token"] || ""));
      return responderJSON(res, 200, { ok: true });
    }

    // GET /api/meus-pedidos -> só os pedidos do aluno da sessão (antes bastava saber o RA de alguém)
    if (req.method === "GET" && rota === "/api/meus-pedidos") {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para ver os seus pedidos." });
      const b = lerBanco();
      const pedidos = b.pedidos.filter(p => p.alunoId === aluno.id || p.alunoRa === aluno.codigo).map(p => {
        const item = b.itens.find(i => i.id === p.itemId);
        return { id: p.id, alunoRa: aluno.codigo, itemId: p.itemId, itemNome: item ? item.nome : "Item removido", status: p.status, criadoEm: p.criadoEm || null };
      });
      return responderJSON(res, 200, pedidos);
    }

    // GET /api/aluno/notificacoes -> avisos do aluno da sessão (?resumo=1 só devolve os contadores)
    if (req.method === "GET" && rota === "/api/aluno/notificacoes") {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para ver as notificações." });
      return responderNotificacoes(req, res, lerBanco(), aluno.id);
    }

    if (req.method === "POST" && rota === "/api/aluno/notificacoes/lidas") {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para ver as notificações." });
      const b = lerBanco();
      if (marcarLidas(b, aluno.id)) gravarBanco(b);
      return responderJSON(res, 200, { ok: true });
    }

    // GET /api/aluno/perdidos -> só os avisos de objeto perdido do aluno da sessão
    if (req.method === "GET" && rota === "/api/aluno/perdidos") {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para ver os seus avisos." });
      const meus = lerBanco().perdidos.filter(p => p.alunoId === aluno.id).slice(-50).reverse().map(perdidoParaAluno);
      return responderJSON(res, 200, meus);
    }

    // POST /api/aluno/perdidos -> o aluno avisa que perdeu um objeto (nome e turma vêm da sessão)
    if (req.method === "POST" && rota === "/api/aluno/perdidos") {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para avisar um objeto perdido." });
      if (!limitePerdidos.permitir(ipDe(req)) || !limitePerdidosAluno.permitir(String(aluno.id))) {
        return responderJSON(res, 429, { erro: "Muitos avisos em pouco tempo. Tente de novo mais tarde." });
      }
      const c = await lerCorpo(req);
      const nome = texto(c.nome, 50), desc = texto(c.desc, 140);
      const cat = texto(c.cat, 40), local = texto(c.local, 60), data = texto(c.data, 10);
      if (!nome || !desc || !CATEGORIAS.includes(cat) || (local && !LOCAIS.includes(local)) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(data) || !dataReal(data) || data > new Date().toISOString().slice(0, 10)) {
        return responderJSON(res, 400, { erro: "Dados do aviso inválidos." });
      }
      const b = lerBanco();
      podarPerdidos(b);
      if (b.perdidos.length >= MAX_PERDIDOS) return responderJSON(res, 400, { erro: "Limite de avisos guardados atingido. Fale com a coordenação." });
      const abertos = b.perdidos.filter(p => p.alunoId === aluno.id && p.status === "aberto");
      if (abertos.length >= MAX_PERDIDOS_ABERTOS) {
        return responderJSON(res, 409, { erro: "Você já tem " + MAX_PERDIDOS_ABERTOS + " avisos abertos. Encerre algum antes de criar outro." });
      }
      if (abertos.some(p => normalizarTexto(p.nome) === normalizarTexto(nome) && p.cat === cat)) {
        return responderJSON(res, 409, { erro: "Você já avisou que perdeu esse objeto." });
      }
      const aviso = {
        id: b.proxPerd++, nome, cat, local, data, desc,
        alunoId: aluno.id, alunoNome: aluno.nome, alunoTurma: aluno.turma,
        criadoEm: new Date().toISOString(), status: "aberto"
      };
      b.perdidos.push(aviso);
      notificar(b, PARA_COORDENACAO, "novo_perdido", "Novo aviso de objeto perdido: " + aluno.nome + " (" + aluno.turma + ") perdeu \"" + nome + "\".", { perdidoId: aviso.id });
      gravarBanco(b);
      // se já existe um item parecido na lista, o aluno fica sabendo na hora
      const possiveis = itensPossiveis(b, aviso, true).slice(0, 3).map(i => ({ id: i.id, nome: i.nome }));
      return responderJSON(res, 201, { ok: true, id: aviso.id, possiveis });
    }

    // POST /api/aluno/perdidos/:id/encerrar -> o aluno avisa que já encontrou (ou desistiu de procurar)
    const rotaPerdidoAluno = /^\/api\/aluno\/perdidos\/(\d+)\/encerrar$/.exec(rota);
    if (req.method === "POST" && rotaPerdidoAluno) {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para encerrar o aviso." });
      const b = lerBanco();
      const aviso = b.perdidos.find(p => p.id === Number(rotaPerdidoAluno[1]) && p.alunoId === aluno.id);
      if (!aviso) return responderJSON(res, 404, { erro: "Aviso não encontrado." });
      if (aviso.status !== "aberto") return responderJSON(res, 409, { erro: "Este aviso já foi encerrado." });
      aviso.status = "encerrado";
      aviso.encerradoEm = new Date().toISOString();
      aviso.encerradoPor = "aluno";
      gravarBanco(b);
      return responderJSON(res, 200, { ok: true });
    }

    if (req.method === "POST" && rota === "/api/logout") {
      const auth = req.headers["authorization"] || "";
      sessoes.delete(auth.startsWith("Bearer ") ? auth.slice(7) : "");
      return responderJSON(res, 200, { ok: true });
    }

    // POST /api/pedidos  -> qualquer pessoa pede a retirada ("É meu")
    if (req.method === "POST" && rota === "/api/pedidos") {
      const aluno = alunoDaSessao(req);
      if (!aluno) return responderJSON(res, 401, { erro: "Entre com o seu RA para pedir a retirada." });
      if (!limitePedidos.permitir(ipDe(req)) || !limitePedidosAluno.permitir(String(aluno.id))) {
        return responderJSON(res, 429, { erro: "Muitos pedidos em pouco tempo. Tente de novo mais tarde." });
      }
      const c = await lerCorpo(req);
      const b = lerBanco();
      if (b.pedidos.length >= MAX_PEDIDOS) return responderJSON(res, 400, { erro: "Limite de pedidos guardados atingido. Fale com a coordenação." });
      const item = b.itens.find(i => i.id === Number(c.itemId));
      if (!item || item.status !== "disponivel") return responderJSON(res, 404, { erro: "Item não encontrado." });
      if (b.pedidos.some(p => p.itemId === item.id && (p.status === "pendente" || p.status === "liberado"))) {
        return responderJSON(res, 409, { erro: "Já existe um pedido de retirada para este item." });
      }
      const detalhe = texto(c.detalhe, 300);
      if (!detalhe) return responderJSON(res, 400, { erro: "Preencha todos os campos." });
      const pedido = { // nome, turma e RA vêm da sessão do aluno, não do navegador
        id: b.prox++, itemId: item.id, nome: aluno.nome, turma: aluno.turma, detalhe,
        alunoId: aluno.id, alunoRa: aluno.codigo, criadoEm: new Date().toISOString(), status: "pendente"
      };
      b.pedidos.push(pedido);
      notificar(b, PARA_COORDENACAO, "novo_pedido", "Novo pedido de retirada: " + aluno.nome + " (" + aluno.turma + ") pediu \"" + item.nome + "\".", { pedidoId: pedido.id, itemId: item.id });
      gravarBanco(b);
      return responderJSON(res, 201, { ok: true });
    }

    // ---- daqui para baixo, só a coordenação logada ----
    if (rota.startsWith("/api/") && !coordenacaoLogada(req)) {
      return responderJSON(res, 401, { erro: "Faça login na coordenação." });
    }

    // POST /api/pedidos/:id/liberar -> reserva o item e autoriza a retirada.
    let rotaLiberar = /^\/api\/pedidos\/(\d+)\/liberar$/.exec(rota);
    if (req.method === "POST" && rotaLiberar) {
      const b = lerBanco();
      const p = b.pedidos.find(x => x.id === Number(rotaLiberar[1]));
      if (!p) return responderJSON(res, 404, { erro: "Pedido não encontrado." });
      if (p.status !== "pendente") return responderJSON(res, 409, { erro: "Este pedido não está aguardando liberação." });
      const item = b.itens.find(i => i.id === p.itemId);
      if (!item || item.status !== "disponivel") return responderJSON(res, 409, { erro: "Este item não está mais disponível. Recuse o pedido." });
      p.status = "liberado";
      p.liberadoEm = new Date().toISOString();
      item.status = "retirada_liberada";
      registrarAtividade(b, contaDaSessao(req), "liberar", "Liberou a retirada de \"" + item.nome + "\" para " + p.nome + " (" + p.turma + ")", { itemId: item.id, pedidoId: p.id });
      notificar(b, alunoIdDoPedido(p), "pedido_liberado", "Sua retirada de \"" + item.nome + "\" foi liberada. Procure a coordenação para buscar o item.", { pedidoId: p.id, itemId: item.id });
      gravarBanco(b);
      return responderJSON(res, 200, { ok: true });
    }

    // POST /api/itens  -> cadastrar item achado
    // GET /api/alunos -> lista de demonstração para o painel da coordenação
    if (req.method === "GET" && rota === "/api/alunos") {
      return responderJSON(res, 200, BancoAlunos.todos());
    }

    if (req.method === "POST" && rota === "/api/itens") {
      const c = await lerCorpo(req);
      const b = lerBanco();
      if (b.itens.length >= MAX_ITENS) return responderJSON(res, 400, { erro: "Limite de itens guardados atingido. Use o reset para recomeçar." });
      const nome = texto(c.nome, 50), desc = texto(c.desc, 140);
      const cat = texto(c.cat, 40), local = texto(c.local, 60), data = texto(c.data, 10);
      if (!nome || !desc || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !dataReal(data) || !CATEGORIAS.includes(cat) || !LOCAIS.includes(local)) {
        return responderJSON(res, 400, { erro: "Dados do item inválidos." });
      }
      const item = { id: b.prox++, nome, cat, local, data, desc, status: "disponivel", criadoEm: new Date().toISOString() };
      if (c.foto) {
        const caminho = salvarFoto(c.foto);
        if (!caminho) return responderJSON(res, 400, { erro: "Foto inválida. Use JPG, PNG ou WEBP." });
        item.foto = caminho;
      }
      b.itens.unshift(item);
      registrarAtividade(b, contaDaSessao(req), "cadastrar_item", "Cadastrou o item \"" + item.nome + "\" (" + item.cat + ", " + item.local + ")", { itemId: item.id });
      // quem avisou que perdeu algo parecido recebe uma notificação (no máximo 30 por item cadastrado)
      let avisados = 0;
      for (const aviso of b.perdidos) {
        if (avisados >= 30) break;
        if (aviso.status !== "aberto" || !perdidoCasaComItem(aviso, item, true)) continue;
        notificar(b, aviso.alunoId, "possivel_item", "Cadastraram um item que pode ser o objeto que você perdeu (\"" + aviso.nome + "\"): \"" + item.nome + "\". Confira na lista de itens achados e, se for seu, clique em \"É meu\".", { perdidoId: aviso.id, itemId: item.id });
        avisados++;
      }
      gravarBanco(b);
      return responderJSON(res, 201, { ok: true, id: item.id });
    }

    // POST /api/pedidos/:id/confirmar  |  /recusar
    let m = /^\/api\/pedidos\/(\d+)\/(confirmar|recusar)$/.exec(rota);
    if (req.method === "POST" && m) {
      const b = lerBanco();
      const p = b.pedidos.find(x => x.id === Number(m[1]));
      if (!p) return responderJSON(res, 404, { erro: "Pedido não encontrado." });
      let itemDevolvido = null;
      const conta = contaDaSessao(req);
      if (m[2] === "confirmar") {
        if (p.status !== "liberado") return responderJSON(res, 409, { erro: "Libere a retirada antes de confirmar a entrega." });
        p.status = "entregue";
        const item = b.itens.find(i => i.id === p.itemId);
        if (item) { item.status = "devolvido"; item.devolvidoEm = new Date().toISOString(); itemDevolvido = { foto: item.foto }; delete item.foto; }
        registrarAtividade(b, conta, "confirmar", "Confirmou a entrega de \"" + nomeDoItem(item) + "\" para " + p.nome + " (" + p.turma + ")", { itemId: p.itemId, pedidoId: p.id });
        notificar(b, alunoIdDoPedido(p), "pedido_entregue", "A entrega de \"" + nomeDoItem(item) + "\" foi confirmada pela coordenação.", { pedidoId: p.id, itemId: p.itemId });
      } else {
        if (p.status !== "pendente" && p.status !== "liberado") return responderJSON(res, 409, { erro: "Este pedido já foi encerrado." });
        p.status = "recusado";
        const item = b.itens.find(i => i.id === p.itemId);
        if (item && item.status === "retirada_liberada") item.status = "disponivel";
        registrarAtividade(b, conta, "recusar", "Recusou o pedido de " + p.nome + " (" + p.turma + ") para \"" + nomeDoItem(item) + "\"", { itemId: p.itemId, pedidoId: p.id });
        notificar(b, alunoIdDoPedido(p), "pedido_recusado", "Seu pedido de \"" + nomeDoItem(item) + "\" foi recusado pela coordenação.", { pedidoId: p.id, itemId: p.itemId });
      }
      gravarBanco(b);                 // 1º grava o banco...
      apagarFotoDoItem(itemDevolvido); // 2º apaga o arquivo (item devolvido não precisa mais da foto)
      return responderJSON(res, 200, { ok: true });
    }

    // POST /api/itens/:id/devolver
    m = /^\/api\/itens\/(\d+)\/devolver$/.exec(rota);
    if (req.method === "POST" && m) {
      const b = lerBanco();
      const item = b.itens.find(i => i.id === Number(m[1]));
      if (!item) return responderJSON(res, 404, { erro: "Item não encontrado." });
      const fotoAntiga = { foto: item.foto };
      let encerrados = 0;
      for (const p of b.pedidos) { // pedido aberto de um item já devolvido não pode ficar pendurado
        if (p.itemId === item.id && (p.status === "pendente" || p.status === "liberado")) {
          p.status = "recusado";
          encerrados++;
          notificar(b, alunoIdDoPedido(p), "pedido_encerrado", "O item \"" + item.nome + "\" foi marcado como devolvido e o seu pedido foi encerrado.", { pedidoId: p.id, itemId: item.id });
        }
      }
      item.status = "devolvido";
      item.devolvidoEm = new Date().toISOString();
      delete item.foto;
      registrarAtividade(b, contaDaSessao(req), "devolver", "Marcou \"" + item.nome + "\" como devolvido" + (encerrados ? " e encerrou " + encerrados + (encerrados === 1 ? " pedido em aberto" : " pedidos em aberto") : ""), { itemId: item.id });
      gravarBanco(b);
      apagarFotoDoItem(fotoAntiga);
      return responderJSON(res, 200, { ok: true });
    }

    // POST /api/resetar  -> apaga tudo (itens, pedidos e fotos) e volta aos exemplos
    if (req.method === "POST" && rota === "/api/resetar") {
      const conta = contaDaSessao(req);
      registrarSeguranca("reset_executado", ipDe(req), "conta=" + conta + " itens, pedidos e fotos apagados");
      apagarFotos();
      const novo = exemplos();
      // o registro de atividades NÃO é apagado no reset: ele guarda justamente quem fez o reset
      let antigo = null;
      try { antigo = lerBanco(); } catch (e) { /* banco ilegível: recomeça sem o histórico */ }
      if (antigo) { novo.atividades = antigo.atividades; novo.proxAtiv = antigo.proxAtiv; novo.proxNotif = antigo.proxNotif; novo.proxPerd = antigo.proxPerd; }
      registrarAtividade(novo, conta, "resetar", "Resetou os dados: apagou itens, pedidos e fotos e voltou aos itens de exemplo");
      gravarBanco(novo);
      return responderJSON(res, 200, { ok: true });
    }

    // GET /api/notificacoes -> avisos da coordenação (?resumo=1 só devolve os contadores)
    if (req.method === "GET" && rota === "/api/notificacoes") {
      return responderNotificacoes(req, res, lerBanco(), PARA_COORDENACAO);
    }

    if (req.method === "POST" && rota === "/api/notificacoes/lidas") {
      const b = lerBanco();
      if (marcarLidas(b, PARA_COORDENACAO)) gravarBanco(b);
      return responderJSON(res, 200, { ok: true });
    }

    // GET /api/perdidos -> avisos de objeto perdido ainda abertos, com possíveis itens achados (mais recentes primeiro)
    if (req.method === "GET" && rota === "/api/perdidos") {
      const b = lerBanco();
      const abertos = b.perdidos.filter(p => p.status === "aberto").reverse().slice(0, 200).map(p => ({
        id: p.id, em: p.criadoEm, nome: p.nome, cat: p.cat, local: p.local, data: p.data, desc: p.desc,
        alunoNome: p.alunoNome, alunoTurma: p.alunoTurma,
        possivelEm: p.possivelEm || null, possivelItemId: p.possivelItemId || null, possivelItem: p.possivelItemNome || "",
        possiveis: itensPossiveis(b, p, false).slice(0, 3).map(i => ({ id: i.id, nome: i.nome, local: i.local, data: i.data }))
      }));
      return responderJSON(res, 200, { perdidos: abertos });
    }

    // POST /api/perdidos/:id/possivel -> a coordenação marca que há um possível objeto encontrado e avisa o aluno.
    // Corpo opcional: { itemId } indica qual item da lista parece ser o objeto. O aviso continua aberto.
    const rotaPerdidoPossivel = /^\/api\/perdidos\/(\d+)\/possivel$/.exec(rota);
    if (req.method === "POST" && rotaPerdidoPossivel) {
      const c = await lerCorpo(req);
      const b = lerBanco();
      const aviso = b.perdidos.find(p => p.id === Number(rotaPerdidoPossivel[1]));
      if (!aviso) return responderJSON(res, 404, { erro: "Aviso não encontrado." });
      if (aviso.status !== "aberto") return responderJSON(res, 409, { erro: "Este aviso já foi encerrado." });
      let item = null;
      if (c.itemId !== undefined && c.itemId !== null && c.itemId !== "") {
        item = b.itens.find(i => i.id === Number(c.itemId));
        if (!item || item.status !== "disponivel") return responderJSON(res, 404, { erro: "Item não encontrado ou já indisponível." });
      }
      const itemId = item ? item.id : null;
      if (aviso.possivelEm && (aviso.possivelItemId || null) === itemId) {
        return responderJSON(res, 409, { erro: "O aluno já foi avisado" + (item ? " sobre este item." : ".") });
      }
      const conta = contaDaSessao(req);
      aviso.possivelEm = new Date().toISOString();
      aviso.possivelItemId = itemId;
      aviso.possivelItemNome = item ? item.nome : "";
      registrarAtividade(b, conta, "possivel_encontrado", "Marcou possível objeto encontrado para o aviso \"" + aviso.nome + "\" de " + aviso.alunoNome + " (" + aviso.alunoTurma + ")" + (item ? ": \"" + item.nome + "\"" : ""), { perdidoId: aviso.id, ...(item ? { itemId: item.id } : {}) });
      notificar(b, aviso.alunoId, "possivel_encontrado", "A coordenação encontrou um possível objeto para o seu aviso \"" + aviso.nome + "\"" + (item ? ": \"" + item.nome + "\"" : "") + ". Procure a coordenação para conferir se é seu.", { perdidoId: aviso.id, ...(item ? { itemId: item.id } : {}) });
      gravarBanco(b);
      return responderJSON(res, 200, { ok: true });
    }

    // POST /api/perdidos/:id/encerrar -> a coordenação encerra o aviso (objeto encontrado ou aviso antigo)
    const rotaPerdidoCoord = /^\/api\/perdidos\/(\d+)\/encerrar$/.exec(rota);
    if (req.method === "POST" && rotaPerdidoCoord) {
      const b = lerBanco();
      const aviso = b.perdidos.find(p => p.id === Number(rotaPerdidoCoord[1]));
      if (!aviso) return responderJSON(res, 404, { erro: "Aviso não encontrado." });
      if (aviso.status !== "aberto") return responderJSON(res, 409, { erro: "Este aviso já foi encerrado." });
      const conta = contaDaSessao(req);
      aviso.status = "encerrado";
      aviso.encerradoEm = new Date().toISOString();
      aviso.encerradoPor = conta;
      registrarAtividade(b, conta, "encerrar_perdido", "Encerrou o aviso de objeto perdido \"" + aviso.nome + "\" de " + aviso.alunoNome + " (" + aviso.alunoTurma + ")", { perdidoId: aviso.id });
      notificar(b, aviso.alunoId, "perdido_encerrado", "A coordenação encerrou o seu aviso do objeto perdido \"" + aviso.nome + "\". Se ainda não encontrou, faça um novo aviso.", { perdidoId: aviso.id });
      gravarBanco(b);
      return responderJSON(res, 200, { ok: true });
    }

    // GET /api/atividades?limite=50 -> registro de ações da coordenação (mais recentes primeiro)
    if (req.method === "GET" && rota === "/api/atividades") {
      const b = lerBanco();
      const limite = Math.min(500, Math.max(1, Math.floor(Number(new URL(req.url, "http://localhost").searchParams.get("limite"))) || 50));
      return responderJSON(res, 200, { total: b.atividades.length, atividades: b.atividades.slice(-limite).reverse() });
    }

    return responderJSON(res, 404, { erro: "Rota não encontrada." });
  } catch (e) {
    if (e.message === "grande") return responderJSON(res, 413, { erro: "Envio grande demais. Use uma foto menor." });
    if (e.message === "json") return responderJSON(res, 400, { erro: "Requisição inválida." });
    console.error(e);
    return responderJSON(res, 500, { erro: "Erro interno do servidor." });
  }
}

/* ---------- Cabeçalhos de segurança ---------- */

/* A conexão é HTTPS? Diretamente (certificado no próprio servidor) ou, com proxy confiável,
   quando o Caddy/Cloudflare avisa pelo cabeçalho X-Forwarded-Proto. */
function ehHttps(req) {
  if (req.socket && req.socket.encrypted) return true;
  return CONFIAR_PROXY && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
}

function cabecalhosSeguranca(res) {
  const seguro = !!(res && res.conexaoSegura);
  const extras = {};
  if (seguro && HSTS_SEGUNDOS > 0) extras["Strict-Transport-Security"] = "max-age=" + HSTS_SEGUNDOS; // o navegador só volta por HTTPS
  return {
    ...extras,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-Content-Type-Options": "nosniff",                 // o navegador não "adivinha" o tipo do arquivo
    "X-Frame-Options": "DENY",                           // ninguém pode embutir o site em outra página
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    // O site só carrega recursos dele mesmo (mais a fonte do Google). Fotos vêm da própria pasta ou de "data:".
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data: blob:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; " +
      "script-src 'self' 'sha256-MUiX3NABaMj64mK6gjfLGHGxrPgRQUyI0wfNDzdIlb0='; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" + (seguro ? "; upgrade-insecure-requests" : "")
  };
}

/* ---------- Arquivos estáticos ---------- */

// Só estes arquivos do site são públicos. banco.json e o server.js nunca são servidos.
// A interface é o app.html. O index.html do repositório é só o redirecionamento do GitHub Pages para esta hospedagem.
const PUBLICOS = new Set(["/index.html", "/app.html", "/style.css", "/script.js", "/logo.png"]);

function estatico(req, res, rota) {
  if (rota === "/") rota = "/app.html";
  let arquivo = null;

  if (PUBLICOS.has(rota)) {
    arquivo = path.join(RAIZ, rota);
  } else if (rota.startsWith("/dados/fotos/")) {
    // só as fotos ficam visíveis da pasta dados/; o basename impede "../"
    arquivo = path.join(PASTA_FOTOS, path.basename(rota));
  }

  if (!arquivo) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Página não encontrada.");
  }

  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Página não encontrada.");
    }
    // Fotos têm nome aleatório único que nunca muda: o navegador pode guardar por 1 ano (economiza banda).
    // Já o site (html/css/js) é revalidado sempre, para as atualizações chegarem.
    const ehFoto = arquivo.startsWith(PASTA_FOTOS);
    res.writeHead(200, {
      "Content-Type": TIPOS[path.extname(arquivo).toLowerCase()] || "application/octet-stream",
      "Cache-Control": ehFoto ? "public, max-age=31536000, immutable" : "no-cache",
      ...cabecalhosSeguranca(res)
    });
    res.end(conteudo);
  });
}

/* ---------- Início ---------- */

/* Só aceita escritas (POST) vindas do próprio site. Navegadores sempre mandam o cabeçalho Origin;
   se ele apontar para outro endereço, outro site está tentando usar a API em nome do visitante. */
function origemPermitida(req) {
  const origem = req.headers["origin"];
  if (!origem) return true; // ferramentas fora do navegador (curl etc.) não mandam Origin
  let hostOrigem;
  try { hostOrigem = new URL(origem).host; } catch (e) { return false; } // inclui o "null" de arquivos abertos do disco
  const hostSite = (CONFIAR_PROXY && req.headers["x-forwarded-host"])
    ? String(req.headers["x-forwarded-host"]).split(",")[0].trim()
    : String(req.headers["host"] || "");
  return hostOrigem === hostSite || ORIGENS_PERMITIDAS.includes(origem);
}

/* Endereço seguro para montar o redirecionamento (impede injetar texto estranho no cabeçalho Location) */
function hostValido(h) {
  return /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(h || "") ? h : null;
}

function responderTexto(res, status, texto, extras) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...cabecalhosSeguranca(res), ...(extras || {}) });
  res.end(texto);
}

function tratarRequisicao(req, res) {
  res.conexaoSegura = ehHttps(req);
  try {
    // Redireciona HTTP -> HTTPS quando pedido (FORCAR_HTTPS=sim)
    if (FORCAR_HTTPS && !res.conexaoSegura) {
      const bruto = (CONFIAR_PROXY && req.headers["x-forwarded-host"]) ? String(req.headers["x-forwarded-host"]).split(",")[0].trim() : String(req.headers["host"] || "");
      const host = hostValido(bruto);
      if (!host) return responderTexto(res, 400, "Requisição inválida.");
      const semPorta = host.replace(/:\d+$/, "");
      const porta = USAR_HTTPS && String(PORTA) !== "443" ? ":" + PORTA : "";
      return responderTexto(res, 308, "Redirecionando para HTTPS...", { Location: "https://" + semPorta + porta + req.url });
    }

    let rota;
    try { rota = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch (e) { return responderTexto(res, 400, "Endereço inválido."); } // antes uma URL malformada derrubava o servidor

    if (rota.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD" && !origemPermitida(req)) {
        registrarSeguranca("origem_bloqueada", ipDe(req), "origin=" + req.headers["origin"]);
        return responderJSON(res, 403, { erro: "Origem não permitida." });
      }
      return api(req, res, rota);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    estatico(req, res, rota);
  } catch (e) {
    console.error("Erro ao tratar requisição:", e);
    try { responderTexto(res, 500, "Erro interno do servidor."); } catch (e2) { /* conexão já fechada */ }
  }
}

let servidor;
if (USAR_HTTPS) {
  let credenciais;
  try { credenciais = { cert: fs.readFileSync(HTTPS_CERT), key: fs.readFileSync(HTTPS_KEY), minVersion: "TLSv1.2" }; }
  catch (e) {
    console.error("\nERRO: não consegui ler o certificado/chave HTTPS: " + e.message + "\n");
    process.exit(1);
  }
  servidor = https.createServer(credenciais, tratarRequisicao);
} else {
  servidor = http.createServer(tratarRequisicao);
}
servidor.on("clientError", (err, socket) => { // requisição quebrada: responde 400 em vez de deixar a conexão pendurada
  try { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); } catch (e) { /* ignora */ }
});

// Porta extra só para redirecionar HTTP -> HTTPS (quando o próprio servidor faz o HTTPS)
let servidorRedireciona = null;
if (USAR_HTTPS && PORTA_HTTP) {
  servidorRedireciona = http.createServer((req, res) => {
    const host = hostValido(String(req.headers["host"] || ""));
    if (!host) { res.writeHead(400); return res.end(); }
    const semPorta = host.replace(/:\d+$/, "");
    const porta = String(PORTA) !== "443" ? ":" + PORTA : "";
    res.writeHead(308, { Location: "https://" + semPorta + porta + req.url });
    res.end();
  });
  servidorRedireciona.on("clientError", (err, socket) => { try { socket.destroy(); } catch (e) { /* ignora */ } });
}

lerBanco(); // cria a pasta dados/ e o banco.json na primeira vez
fazerBackup();
setInterval(fazerBackup, 6 * 60 * 60 * 1000).unref(); // a cada 6 horas (mantém 1 por dia)

servidor.requestTimeout = 30 * 1000;  // conexões lentas demais são cortadas
servidor.headersTimeout = 15 * 1000;

if (servidorRedireciona) servidorRedireciona.listen(PORTA_HTTP, HOST, () => console.log("Redirecionando HTTP (porta " + PORTA_HTTP + ") para HTTPS"));

servidor.listen(PORTA, HOST, () => {
  console.log("Achados do Lourdes (hospedagem) em " + (USAR_HTTPS ? "https" : "http") + "://" + HOST + ":" + PORTA);
  console.log("Dados guardados em: " + PASTA_DADOS);
  console.log("Proxy confiável: " + (CONFIAR_PROXY ? "sim (usa o IP real do visitante)" : "não") + " | backups mantidos: " + BACKUPS_MANTER);
  if (HOST === "0.0.0.0" && !USAR_HTTPS) console.log("ATENÇÃO: escutando em todas as interfaces sem HTTPS. Use HTTPS (HTTPS_CERT/HTTPS_KEY) ou um proxy na frente.");
  if (!USAR_HTTPS && !CONFIAR_PROXY && HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") console.log("ATENÇÃO: sem HTTPS a senha da coordenação trafega sem proteção. Aceitável só em rede local de teste.");
  if (CONFIAR_PROXY && HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") console.log("ATENÇÃO: com CONFIAR_PROXY=sim o servidor deveria escutar só em 127.0.0.1; senão qualquer um pode forjar o IP e fugir dos limites.");
  if (FORCAR_HTTPS && !USAR_HTTPS && !CONFIAR_PROXY) console.log("ATENÇÃO: FORCAR_HTTPS=sim sem HTTPS_CERT/HTTPS_KEY e sem CONFIAR_PROXY=sim vai redirecionar todo acesso e o site não abrirá.");
  console.log("HTTPS: " + (USAR_HTTPS ? "ligado (certificado próprio)" : CONFIAR_PROXY ? "pelo proxy" : "desligado") + (FORCAR_HTTPS ? " | redirecionamento forçado" : ""));
});

// Desligamento limpo (Ctrl+C ou serviço parando): termina o que está em andamento
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    console.log("\nDesligando...");
    if (servidorRedireciona) servidorRedireciona.close();
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
