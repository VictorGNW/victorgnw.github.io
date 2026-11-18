const CATS={"Roupas":"🧥","Material escolar":"📓","Eletrônicos":"🎧","Garrafas e lancheiras":"🥤","Documentos":"🪪","Outros":"📦"};
const LOCAIS=["Pátio","Cantina","Biblioteca","Laboratório de informática","Quadra","Salas de aula"];
const iniciais=n=>n.trim().split(/\s+/).slice(0,2).map(p=>p[0].toUpperCase()).join("");
const dia=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10)};
const normalizar=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s]/g," ").trim();
const palavrasEmComum=(a,b)=>{
 const A=new Set(normalizar(a).split(/\s+/).filter(w=>w.length>2));
 const B=new Set(normalizar(b).split(/\s+/).filter(w=>w.length>2));
 if(!A.size||!B.size)return 0;
 let comuns=0;for(const w of A)if(B.has(w))comuns++;
 return comuns/Math.min(A.size,B.size);
};
/* Considera "parecido" um item ainda disponível, na mesma categoria e local, cadastrado até 3 dias
   antes ou depois, com nome parecido (metade ou mais das palavras em comum). Ajuda a coordenação a
   não cadastrar o mesmo item duas vezes por engano; não impede o cadastro, só avisa. */
const acharItemParecido=novo=>{
 const dataNovo=Date.parse(novo.data+"T00:00:00");
 return db.itens.find(i=>{
  if(i.status!=="disponivel")return false;
  if(i.cat!==novo.cat||i.local!==novo.local)return false;
  const dif=Math.abs(Date.parse(i.data+"T00:00:00")-dataNovo)/86400000;
  if(dif>3)return false;
  return palavrasEmComum(i.nome,novo.nome)>=0.5;
 });
};
/* Os itens e pedidos ficam no servidor (pasta dados/). Aqui só guardamos uma cópia para desenhar a tela. */
let db={itens:[],pedidos:[],prox:0};
let tokenCoord=null;
try{tokenCoord=sessionStorage.getItem("achados-token")}catch(e){}
async function api(metodo,url,corpo){
 if(window.ARMAZENAMENTO_LOCAL)return window.ARMAZENAMENTO_LOCAL(metodo,url,corpo,tokenCoord);
 const h={};
 if(corpo!==undefined)h["Content-Type"]="application/json";
 if(tokenCoord)h["Authorization"]="Bearer "+tokenCoord;
 if(tokenAluno)h["X-Aluno-Token"]=tokenAluno;
 let r;
 try{r=await fetch(url,{method:metodo,headers:h,body:corpo!==undefined?JSON.stringify(corpo):undefined})}
 catch(e){throw new Error("Sem conexão com o servidor. Ele está ligado?")}
 let j={};try{j=await r.json()}catch(e){}
 if(r.status===401&&tokenCoord&&url!=="/api/login"){tokenCoord=null;S.logado=false;listaAlunos=[];try{sessionStorage.removeItem("achados-token")}catch(e){}setTimeout(render,0);throw new Error("Sua sessão da coordenação expirou. Entre de novo.")}
 if(r.status===401&&tokenAluno&&!tokenCoord&&url!=="/api/aluno/login"){tokenAluno=null;S.aluno=null;alunoLogado=null;S.meusPedidos=[];S.view="loginAluno";setTimeout(render,0);throw new Error("Sua sessão expirou. Entre com o RA de novo.")}
 if(!r.ok)throw new Error(j.erro||"Erro ao falar com o servidor.");
 return j}
async function carregar(){
 try{db=await api("GET","/api/dados");ultimaAtualizacao=new Date();return true}
 catch(e){toast(e.message);return false}}
let tokenAluno=null; // só na memória: fechar ou recarregar a página pede o RA de novo
let alunoLogado=null;
let listaAlunos=[]; // lista de demonstração, só carregada para a coordenação
const alunosAno=a=>a?listaAlunos.filter(x=>x.ano===a):listaAlunos;
async function carregarAlunos(){if(!S.logado){listaAlunos=[];return}try{listaAlunos=await api("GET","/api/alunos")}catch(e){listaAlunos=[]}}
let S={view:tokenCoord?"coord":"loginAluno",q:"",cat:"",local:"",ano:0,ordem:"recentes",somenteFoto:false,logado:!!tokenCoord,alvo:null,aluno:alunoLogado,meusPedidos:[],carregandoPedidos:false};
let ultimaAtualizacao=null;
let fotoPend=null;
const VISITA_KEY="achados-ultima-visita-v1";
async function carregarPedidosAluno(){
 if(!S.aluno){S.meusPedidos=[];return}
 S.carregandoPedidos=true;
 try{S.meusPedidos=await api("GET","/api/meus-pedidos")}
 catch(e){S.meusPedidos=[];toast(e.message)}
 finally{S.carregandoPedidos=false}
}
const resumoPedidosAluno=()=>{
 if(!S.aluno)return '<div class="empty">Sem pedidos.</div>';
 if(S.carregandoPedidos)return '<div class="empty">Carregando pedidos...</div>';
 const regs=S.meusPedidos||[];
 if(!regs.length)return '<div class="empty">Sem pedidos.</div>';
 return `<div class="list">${regs.map(r=>{
  const status=r.status==='entregue'?'entregue':r.status==='liberado'?'liberado':r.status==='pendente'?'pendente':'encerrado';
  const data=r.criadoEm?new Date(r.criadoEm).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Pedido salvo no banco';
  const rotulo=status==='liberado'?'Retirada liberada':status==='pendente'?'Em análise':status==='entregue'?'Confirmado':'Encerrado';
  return `<div class="li"><div class="info"><strong>${esc(r.itemNome||'Item removido')}</strong><br><span class="meta">Enviado em ${data}</span></div><span class="status ${status==='entregue'?'delivered':''}">${rotulo}</span></div>`;
 }).join('')}</div>`;
};
const itemCriadoTs=i=>i.criadoEm?Date.parse(i.criadoEm):Date.parse(i.data+"T00:00:00");
const novosItens=()=>{let ultima=0;try{ultima=Number(localStorage.getItem(VISITA_KEY)||0)||0}catch(e){};if(!ultima)return [];return db.itens.filter(i=>i.status==="disponivel"&&itemCriadoTs(i)>ultima).sort((a,b)=>itemCriadoTs(b)-itemCriadoTs(a))};
const marcarVisita=()=>{try{localStorage.setItem(VISITA_KEY,String(Date.now()))}catch(e){}};
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=d=>d.split("-").reverse().join("/");
const diasDesde=d=>Math.max(0,Math.floor((new Date(new Date().toDateString())-new Date(d+"T00:00:00"))/86400000));
const quando=d=>{const n=diasDesde(d);if(n===0)return "hoje";if(n===1)return "ontem";if(n<7)return `há ${n} dias`;if(n<30)return `há ${Math.floor(n/7)} sem.`;return `há ${Math.floor(n/30)} mês(es)`};
function tema(){let t="auto";try{t=localStorage.getItem("achados-tema")||"auto"}catch(e){}return t}
function atualizarTema(){const t=tema(),root=document.documentElement,b=$("#themeToggle");if(t==="auto")delete root.dataset.theme;else root.dataset.theme=t;if(b){const ic=t==="light"?"☀":t==="dark"?"☾":"◐";const nome=t==="light"?"claro":t==="dark"?"escuro":"automático";b.querySelector("span").textContent=ic;b.title="Tema: "+nome;b.setAttribute("aria-label","Tema: "+nome+". Clique para alternar")} }
function proximoTema(){const t=tema(),n=t==="auto"?"light":t==="light"?"dark":"auto";try{localStorage.setItem("achados-tema",n)}catch(e){}atualizarTema();toast("Tema "+(n==="auto"?"automático":n==="light"?"claro":"escuro"))}
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("on"),2600)}
function comprimir(file){return new Promise((res,rej)=>{
 if(!file||!file.type.startsWith("image/"))return rej(new Error("tipo"));
 const url=URL.createObjectURL(file),img=new Image();
 img.onload=()=>{const M=640,r=Math.min(1,M/Math.max(img.width,img.height)),c=document.createElement("canvas");
  c.width=Math.round(img.width*r);c.height=Math.round(img.height*r);
  const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);
  URL.revokeObjectURL(url);res(c.toDataURL("image/jpeg",.78))};
 img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("leitura"))};img.src=url})}
function fotoUI(){const p=$("#fotoPrev"),d=$("#drop");if(!p||!d)return;
 p.hidden=!fotoPend;d.hidden=!!fotoPend;if(fotoPend)$("#fotoImg").src=fotoPend}
async function receberFoto(file){
 try{fotoPend=await comprimir(file);fotoUI();toast("Foto adicionada.")}
 catch(e){toast("Não foi possível ler essa imagem. Tente um JPG ou PNG.")}}
const pendente=id=>db.pedidos.some(p=>p.itemId===id&&(p.status==="pendente"||p.status==="liberado"));

const devolvidosRecentes=()=>{const limite=3*24*60*60*1000,agora=Date.now();return db.itens.filter(i=>i.status==="devolvido"&&i.devolvidoEm&&agora-Date.parse(i.devolvidoEm)>=0&&agora-Date.parse(i.devolvidoEm)<limite).sort((a,b)=>Date.parse(b.devolvidoEm)-Date.parse(a.devolvidoEm));};
const stats=()=>{const d=db.itens.filter(i=>i.status==="disponivel").length;const v=devolvidosRecentes().length;const p=db.pedidos.filter(x=>x.status==="pendente"||x.status==="liberado").length;
 const vExibido=v>0?v:"";
 return `<div class="stats"><div class="stat"><span>Itens disponíveis</span><b>${d}</b><small>esperando o dono</small></div><div class="stat"><span>Já devolvidos</span><b>${vExibido}</b><small>mostrados por 3 dias após a devolução</small></div><div class="stat"><span>Pedidos em análise</span><b>${p}</b><small>aguardando a coordenação</small></div></div>`};
const hoje=()=>new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"short",year:"numeric"}).replace(/ de /g," ").replace(".","");
function publico(){
 const q=S.q.toLowerCase();
 let itens=db.itens.filter(i=>(i.status==="disponivel"||i.status==="retirada_liberada")&&(!S.cat||i.cat===S.cat)&&(!S.local||i.local===S.local)&&(!S.somenteFoto||!!i.foto)&&(!q||(i.nome+" "+i.desc+" "+i.local+" "+i.cat).toLowerCase().includes(q)));
 itens.sort((a,b)=>S.ordem==="antigos"?a.data.localeCompare(b.data):S.ordem==="nome"?a.nome.localeCompare(b.nome,"pt-BR"):b.data.localeCompare(a.data));
 const novos=novosItens();
 const devolvidos=devolvidosRecentes();
 return `<section class="hero"><h1>Perdeu algo na escola?</h1><p class="lead">Veja o que já foi encontrado. Achou o seu? Envie um pedido de retirada e a coordenação confirma.</p><div class="hero-meta">${hoje()} · EEEM Nossa Senhora de Lourdes</div></section>
 ${stats()}
 ${novos.length?`<div class="notice-new" role="status"><div><strong>🆕 ${novos.length} ${novos.length===1?"item novo encontrado":"itens novos encontrados"}</strong><span>Há achados desde sua última visita.</span></div><button class="btn sm" id="verNovos">Ver novos</button></div>`:""}
 <div class="filters"><input id="q" type="search" placeholder="Buscar por nome, descrição, local ou categoria" value="${esc(S.q)}" aria-label="Buscar itens">
 <select id="local" aria-label="Filtrar por local"><option value="">Todos os locais</option>${LOCAIS.map(l=>`<option ${S.local===l?"selected":""}>${l}</option>`).join("")}</select>
 <select id="ordem" class="sort" aria-label="Ordenar itens"><option value="recentes" ${S.ordem==="recentes"?"selected":""}>Mais recentes</option><option value="antigos" ${S.ordem==="antigos"?"selected":""}>Mais antigos</option><option value="nome" ${S.ordem==="nome"?"selected":""}>Nome A–Z</option></select></div>
 <div class="filter-tools"><label class="photo-filter"><input id="somenteFoto" type="checkbox" ${S.somenteFoto?"checked":""}> Somente itens com foto</label>${S.aluno?`<button class="btn alt sm" id="verPedidos">Meus pedidos</button>`:""}</div>
 <div class="chips" role="group" aria-label="Categorias"><button class="chip" data-cat="" aria-pressed="${!S.cat}">Todas</button>${Object.keys(CATS).map(c=>`<button class="chip" data-cat="${c}" aria-pressed="${S.cat===c}">${CATS[c]} ${c}</button>`).join("")}</div>
 <div class="results-bar"><div class="results-left"><span class="results-count">${itens.length} ${itens.length===1?"item encontrado":"itens encontrados"}</span>${(S.q||S.cat||S.local||S.somenteFoto||S.ordem!=="recentes")?`<button class="btn alt sm" id="limparFiltros" type="button">Limpar filtros</button>`:""}</div><div class="results-actions"><span class="hint">${ultimaAtualizacao?`Atualizado ${ultimaAtualizacao.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`:"Lista atualizada"}</span><button class="btn alt sm" id="atualizar" type="button" title="Atualizar a lista">↻ Atualizar</button></div></div>
 ${itens.length?`<div class="grid">${itens.map(i=>{const novo=i.status==="disponivel"&&diasDesde(i.data)<=2;const pedido=db.pedidos.find(p=>p.itemId===i.id&&(p.status==="pendente"||p.status==="liberado"));const liberado=i.status==="retirada_liberada"||pedido?.status==="liberado";return `<article class="tag">${novo?`<span class="new-badge">Novo</span>`:""}${i.foto?`<button class="foto" data-zoom="${i.id}" aria-label="Ampliar a foto de ${esc(i.nome)}"><img src="${i.foto}" alt="Foto: ${esc(i.nome)}" loading="lazy"><span class="cat-badge" aria-hidden="true">${CATS[i.cat]}</span></button>`:`<div class="ico" aria-hidden="true">${CATS[i.cat]}</div>`}<h3>${esc(i.nome)}</h3><p>${esc(i.desc)}</p><div class="meta">${esc(i.local)} · achado ${quando(i.data)} (${fmt(i.data)})</div>
 ${liberado?`<span class="status released">Retirada liberada para ${esc(pedido?.liberadoPara||"aluno")}</span><button class="btn" disabled>Retirada liberada</button>`:pedido?`<span class="status">Solicitado por ${esc(pedido.solicitadoPor||"aluno")}</span><button class="btn" disabled>Aguardando a coordenação</button>`:`<button class="btn" data-claim="${i.id}">É meu</button>`}</article>`}).join("")}</div>`
 :`<div class="empty"><strong>Nenhum item encontrado.</strong><br>Tente outra palavra ou limpe os filtros. Se o seu item não está aqui, volte em alguns dias.</div>`}
 ${devolvidos.length?`<section class="panel recent-returned"><div class="section-head"><h2>Últimas devoluções</h2><small>Disponíveis no histórico por 3 dias</small></div><div class="list">${devolvidos.map(i=>`<div class="li"><div class="info"><strong>${esc(i.nome)}</strong><br><span class="meta">${CATS[i.cat]} ${esc(i.cat)} · ${esc(i.local)} · devolvido ${quando(i.devolvidoEm.slice(0,10))}</span></div><span class="status delivered">Devolvido</span></div>`).join("")}</div></section>`:""}`;
}

function ajuda(){
 return `<section class="hero"><h1>Como funciona</h1><p class="lead">Um guia rápido para encontrar seu item e fazer a retirada com segurança.</p></section>
 <section class="panel help-grid"><div class="help-card"><b class="help-icon">1</b><div><h2>Encontre o item</h2><p>Use a busca, as categorias, o local ou o filtro de fotos. Confira descrição, data e local antes de solicitar.</p></div></div><div class="help-card"><b class="help-icon">2</b><div><h2>Faça o pedido</h2><p>Clique em “É meu” e informe um detalhe que ajude a comprovar que o item é seu.</p></div></div><div class="help-card"><b class="help-icon">3</b><div><h2>Aguarde a análise</h2><p>A coordenação verifica o pedido. Enquanto estiver em análise, o item fica sinalizado para evitar pedidos duplicados.</p></div></div><div class="help-card"><b class="help-icon">4</b><div><h2>Retire na coordenação</h2><p>Após a confirmação, siga a orientação da escola para retirar o item. Se necessário, leve seu documento ou identificação escolar.</p></div></div></section>
 <section class="panel"><h2>Se não encontrar agora</h2><p class="hint">Novos itens podem ser cadastrados ao longo dos dias. Ative o aviso de itens novos ao voltar ao site e confira novamente depois.</p><p class="hint">As informações usadas no pedido são destinadas à coordenação para conferir a propriedade do item.</p></section>
 <section class="panel"><div class="section-head"><h2>Meus pedidos</h2><small>${S.aluno?`${esc(S.aluno.nome)} · ${esc(S.aluno.turma)}`:'Acompanhe seus pedidos'}</small></div>${S.aluno?`<p class="hint">Aqui aparecem os pedidos enviados pela sua conta neste dispositivo.</p>${resumoPedidosAluno()}`:`<div class="empty">Sem pedidos.</div>`}</section>`;
}

function pedidosView(){
 if(!S.aluno)return `<section class="hero"><h1>Meus pedidos</h1><p class="lead">Sem pedidos.</p></section><div class="panel narrow"><button class="btn" id="pedidosLogin">Login do aluno</button></div>`;
 return `<section class="hero"><h1>Meus pedidos</h1><p class="lead">${esc(S.aluno.nome)} · ${esc(S.aluno.turma)}</p></section><section class="panel"><div class="section-head"><h2>Pedidos enviados</h2><small>Filtrados pelo RA da conta</small></div>${resumoPedidosAluno()}<p class="hint">Os pedidos são salvos no banco local e vinculados ao seu RA.</p></section><button class="btn alt" id="voltarItens">← Voltar aos itens</button>`;
}

function coord(){
 if(!S.logado)return `<h1 class="center">Área da coordenação</h1><p class="lead center">Entre para cadastrar itens e responder aos pedidos de retirada.</p>
 <div class="panel narrow"><form id="login"><label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
 <button class="btn" type="submit">Entrar</button><p class="hint">Acesso restrito à coordenação da escola.</p><button class="btn alt role-switch" type="button" id="goAluno">Sou aluno</button></form></div>`;
 const pend=db.pedidos.filter(p=>p.status==="pendente"||p.status==="liberado");
 const disp=db.itens.filter(i=>i.status==="disponivel");
 return `<section class="hero bar"><div><h1>Painel da coordenação</h1><p class="lead">Cadastre itens e responda aos pedidos de retirada.</p></div><button class="btn alt" id="sair">Sair</button></section>${stats()}
 <div class="coord-nav"><a href="#pedidos">Pedidos</a><a href="#cadastro">Cadastrar item</a><a href="#lista">Itens cadastrados</a><a href="#alunos">Alunos</a><a href="#manutencao">Manutenção</a></div><section class="panel" id="pedidos"><div class="section-head"><h2>Pedidos de retirada (${pend.length})</h2><small>Analise os pedidos recebidos</small></div>
 ${pend.length?`<div class="list">${pend.map(p=>{const i=db.itens.find(x=>x.id===p.itemId);const liberado=p.status==="liberado";return `<div class="li"><div class="info"><strong>${esc(i.nome)}</strong><br>${esc(p.nome)}, ${esc(p.turma)}<br><span class="meta">Detalhe informado: ${esc(p.detalhe)}</span></div><div class="acts"><button class="btn alt" data-liberar="${p.id}" ${liberado?"disabled":""}>${liberado?"Retirada liberada":"Liberar retirada"}</button><button class="btn ok" data-ok="${p.id}" ${liberado?"":"disabled"}>Confirmar entrega</button><button class="btn bad" data-no="${p.id}">Recusar</button></div></div>`}).join("")}</div>`:`<div class="empty">Nenhum pedido pendente.</div>`}</section>
 <section class="panel" id="cadastro"><div class="section-head"><h2>Cadastrar item achado</h2><small>O item aparece imediatamente na lista pública</small></div><form id="novo">
 <div class="row2"><label>Nome do item<input name="nome" required maxlength="50"></label>
 <label>Categoria<select name="cat">${Object.keys(CATS).map(c=>`<option>${c}</option>`).join("")}</select></label></div>
 <div class="row2"><label>Onde foi achado<select name="local">${LOCAIS.map(l=>`<option>${l}</option>`).join("")}</select></label>
 <label>Data<input type="date" name="data" required value="${dia(0)}"></label></div>
 <label>Descrição<textarea name="desc" rows="2" required maxlength="140"></textarea></label>
 <div class="foto-field"><span class="lbl">Foto do item <small>(opcional)</small></span>
  <button type="button" class="drop" id="drop" ${fotoPend?"hidden":""}><span class="drop-ico" aria-hidden="true">📷</span><b>Escolher foto</b><span>ou arraste uma imagem para cá</span><small>JPG, PNG ou WEBP · é reduzida automaticamente</small></button>
  <input type="file" id="foto" accept="image/*" hidden>
  <div class="foto-prev" id="fotoPrev" ${fotoPend?"":"hidden"}><img id="fotoImg" alt="Pré-visualização da foto" src="${fotoPend||""}"><button type="button" class="btn alt sm" id="fotoRem">Remover foto</button></div></div>
 <button class="btn" type="submit">Cadastrar item</button></form></section>
 <section class="panel" id="lista"><div class="section-head"><h2>Itens na lista (${disp.length})</h2><small>Itens ainda disponíveis</small></div>${disp.length?`<div class="list">${disp.map(i=>`<div class="li"><div class="info withthumb">${i.foto?`<img class="thumb" src="${i.foto}" alt="Foto: ${esc(i.nome)}" data-zoom="${i.id}" loading="lazy">`:`<span class="thumb ph" aria-hidden="true">${CATS[i.cat]}</span>`}<div><strong>${esc(i.nome)}</strong><br><span class="meta">${CATS[i.cat]} ${esc(i.cat)} · ${esc(i.local)} · ${fmt(i.data)}</span></div></div><div class="acts"><button class="btn alt" data-dev="${i.id}">Marcar como devolvido</button></div></div>`).join("")}</div>`:`<div class="empty">Nenhum item na lista. Cadastre o primeiro acima.</div>`}</section>
 <section class="panel" id="alunos"><div class="section-head"><h2>Banco de alunos (${alunosAno(S.ano).length})</h2><small>Lista de demonstração, visível só para a coordenação</small></div>
 <div class="chips" role="group" aria-label="Filtrar por ano">${[0,1,2,3].map(a=>`<button class="chip" data-ano="${a}" aria-pressed="${S.ano===a}">${a?a+"º ano":"Todos"} (${alunosAno(a).length})</button>`).join("")}</div>
 <div class="list">${alunosAno(S.ano).map(a=>`<div class="li"><div class="info withthumb"><span class="avatar" aria-hidden="true">${iniciais(a.nome)}</span><div><strong>${esc(a.nome)}</strong><br><span class="meta">${a.ano}º ano · turma ${esc(a.turma)}</span></div></div><span class="codigo" title="Código de login">${a.codigo}</span></div>`).join("")}</div></section>
 <section class="panel perigo" id="manutencao"><h2>Zerar itens</h2><p class="hint">Apaga todos os itens, pedidos e fotos guardados no servidor e volta para os itens de exemplo. Não dá para desfazer.</p><button class="btn bad" id="reset">Resetar todos os itens</button></section>`;
}

function alunoBox(){
 if(S.view==="loginAluno"||S.view==="coord")return "";
 if(S.aluno)return `<div class="aluno"><div class="avatar" aria-hidden="true">${iniciais(S.aluno.nome)}</div><div class="aluno-info"><b>${esc(S.aluno.nome)}</b><small>${esc(S.aluno.turma)}</small></div><button class="btn alt sm" id="alunoPedidos">Meus pedidos</button><button class="btn alt sm" id="alunoSair">Sair</button></div>`;
 return `<button class="btn alt sm" id="alunoEntrar">Login do aluno</button>`;
}

function loginAlunoView(){return `<section class="login-screen"><h1>Aluno</h1><form id="alunoForm" class="login-card"><img src="logo.png" alt="Logo da escola" class="login-logo"><label>RA<input name="codigo" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="Digite seu RA" autocomplete="username"></label><button class="btn" type="submit">Acessar</button><p class="hint">Use seu RA de 6 dígitos.</p><button class="btn alt role-switch" type="button" id="goCoord">Sou Coordenador</button></form></section>`;}

function render(){
 $("#app").innerHTML=S.view==="loginAluno"?loginAlunoView():S.view==="publico"?publico():S.view==="ajuda"?ajuda():S.view==="pedidos"?pedidosView():coord();
 $("#alunoBox").innerHTML=alunoBox();
 document.querySelector("nav").hidden=S.view==="loginAluno"||S.view==="coord";
 document.querySelector('nav button[data-view="coord"]').hidden=!!S.aluno;
 document.querySelectorAll("nav button").forEach(b=>{if(b.dataset.view===S.view)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
 if(S.view==="publico"&&novosItens().length){clearTimeout(window._marcarVisita);window._marcarVisita=setTimeout(()=>{marcarVisita();},5000)}
}

document.addEventListener("click",async e=>{
 const z=e.target.closest("[data-zoom]");
 if(z){const i=db.itens.find(x=>x.id===+z.dataset.zoom);if(i&&i.foto){$("#fotoGrande").src=i.foto;$("#fotoGrande").alt="Foto: "+i.nome;$("#fotoLegenda").textContent=i.nome+" · "+i.local;$("#dlgFoto").showModal()}return}
 if(e.target===$("#dlgFoto")){$("#dlgFoto").close();return}
 const t=e.target.closest("button");if(!t)return;
 if(t.id==="themeToggle"){proximoTema();return}
 if(t.id==="goCoord"){S.view="coord";render();return}
 if(t.id==="goAluno"){S.view="loginAluno";render();return}
 if(t.id==="alunoPedidos"||t.id==="verPedidos"){S.view="pedidos";await carregarPedidosAluno();render();return}
 if(t.id==="voltarItens"){S.view="publico";render();return}
 if(t.id==="ajudaLogin"||t.id==="pedidosLogin"){S.view="loginAluno";render();return}
 if(t.id==="verNovos"){S.q="";S.cat="";S.local="";S.ordem="recentes";S.somenteFoto=false;marcarVisita();render();toast("Mostrando os itens novos.");return}
 if(t.id==="limparFiltros"){S.q="";S.cat="";S.local="";S.ordem="recentes";S.somenteFoto=false;render();toast("Filtros limpos.");return}
 if(t.id==="atualizar"){t.disabled=true;const ok=await carregar();render();if(ok)toast("Lista atualizada.");return} /* se falhar, carregar() já mostrou o erro */
 if(t.id==="drop"){$("#foto").click();return}
 if(t.id==="fotoRem"){fotoPend=null;fotoUI();return}
 if(t.id==="fecharFoto"){$("#dlgFoto").close();return}
 if(t.dataset.ano!==undefined){S.ano=+t.dataset.ano;render();return}
 if(t.dataset.view){S.view=t.dataset.view;render();return}
 if(t.dataset.cat!==undefined&&t.classList.contains("chip")&&t.dataset.cat!==undefined&&!t.id){S.cat=t.dataset.cat;render();return}
 if(t.dataset.claim){S.alvo=+t.dataset.claim;const i=db.itens.find(x=>x.id===S.alvo);if(!i){toast("Esse item não está mais na lista.");await carregar();render();return}$("#dlgItem").textContent=i.nome+" ("+i.local+")";$("#claimForm").reset();
  const f=$("#claimForm");
  if(S.aluno){f.nome.value=S.aluno.nome;f.turma.value=S.aluno.turma;f.nome.readOnly=true;f.turma.readOnly=true}
  else{f.nome.readOnly=false;f.turma.readOnly=false}
  $("#dlg").showModal();return}
 if(t.dataset.liberar){try{await api("POST","/api/pedidos/"+t.dataset.liberar+"/liberar");await carregar();render();toast("Retirada liberada para o aluno.")}catch(er){toast(er.message)}return}
 if(t.dataset.ok){try{await api("POST","/api/pedidos/"+t.dataset.ok+"/confirmar");await carregar();render();toast("Entrega confirmada. O item saiu da lista.")}catch(er){toast(er.message)}return}
 if(t.dataset.no){try{await api("POST","/api/pedidos/"+t.dataset.no+"/recusar");await carregar();render();toast("Pedido recusado. O item voltou a ficar disponível.")}catch(er){toast(er.message)}return}
 if(t.dataset.dev){try{await api("POST","/api/itens/"+t.dataset.dev+"/devolver");await carregar();render();toast("Item marcado como devolvido.")}catch(er){toast(er.message)}return}
 if(t.id==="sair"){try{await api("POST","/api/logout")}catch(er){}tokenCoord=null;S.logado=false;listaAlunos=[];try{sessionStorage.removeItem("achados-token")}catch(er){}await carregar();render();return}
 if(t.id==="reset"){
  if(!confirm("Tem certeza? Isso apaga TODOS os itens, pedidos e fotos e volta para os itens de exemplo."))return;
  try{await api("POST","/api/resetar");fotoPend=null;await carregar();render();toast("Todos os itens foram resetados.")}catch(er){toast(er.message)}return}
 if(t.id==="cancelClaim")$("#dlg").close();
 if(t.id==="alunoEntrar"){S.view="loginAluno";render();return}
 if(t.id==="alunoSair"){try{await api("POST","/api/aluno/logout")}catch(er){}tokenAluno=null;S.aluno=null;alunoLogado=null;S.meusPedidos=[];S.view="loginAluno";render();toast("Login do aluno encerrado.")}
});
document.addEventListener("input",e=>{
 if(e.target.id==="q"){S.q=e.target.value;const pos=e.target.selectionStart;render();const q=$("#q");q.focus();q.setSelectionRange(pos,pos)}
});
document.addEventListener("change",e=>{
 if(e.target.id==="local"){S.local=e.target.value;render()}
 if(e.target.id==="ordem"){S.ordem=e.target.value;render()}
 if(e.target.id==="somenteFoto"){S.somenteFoto=e.target.checked;render()}
 if(e.target.id==="foto"){const f=e.target.files[0];e.target.value="";if(f)receberFoto(f)}
});
document.addEventListener("dragover",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d){e.preventDefault();d.classList.add("over")}});
document.addEventListener("dragleave",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d)d.classList.remove("over")});
document.addEventListener("drop",e=>{const d=e.target.closest&&e.target.closest("#drop");if(d){e.preventDefault();d.classList.remove("over");const f=e.dataTransfer.files[0];if(f)receberFoto(f)}});
document.addEventListener("submit",async e=>{
 const f=e.target;
 if(f.id==="claimForm"){e.preventDefault();const d=new FormData(f);
  try{await api("POST","/api/pedidos",{itemId:S.alvo,detalhe:d.get("detalhe").trim()});
   $("#dlg").close();await carregar();if(S.aluno)await carregarPedidosAluno();render();toast("Pedido enviado. A coordenação vai analisar.")}
  catch(er){toast(er.message);await carregar();
   /* fecha a janela se a sessão do aluno acabou ou se o item não está mais disponível */
   if(!S.aluno||!db.itens.some(x=>x.id===S.alvo&&x.status==="disponivel"))$("#dlg").close();
   render()}}
 if(f.id==="login"){e.preventDefault();
  try{const r=await api("POST","/api/login",{senha:new FormData(f).get("senha")});tokenCoord=r.token;try{sessionStorage.setItem("achados-token",tokenCoord)}catch(er){}S.logado=true;await carregar();await carregarAlunos();render()}
  catch(er){toast(er.message)}}
 if(f.id==="alunoForm"){e.preventDefault();const cod=new FormData(f).get("codigo").trim();
  try{const r=await api("POST","/api/aluno/login",{ra:cod});tokenAluno=r.token;S.aluno=r.aluno;alunoLogado=r.aluno;
   await carregar();await carregarPedidosAluno();S.view="publico";render();toast(`Bem-vindo(a), ${r.aluno.nome.split(" ")[0]}!`)}
  catch(er){toast(er.message)}}
 if(f.id==="novo"){e.preventDefault();const d=Object.fromEntries(new FormData(f));
  const novo={nome:d.nome.trim(),cat:d.cat,local:d.local,data:d.data,desc:d.desc.trim()};
  if(fotoPend)novo.foto=fotoPend;
  const parecido=acharItemParecido(novo);
  if(parecido&&!f.dataset.confirmado){
   const seguir=confirm(`Já existe um item parecido cadastrado:\n\n"${parecido.nome}" · ${parecido.cat} · ${parecido.local} · ${new Date(parecido.data+"T00:00:00").toLocaleDateString("pt-BR")}\n\nDeseja cadastrar mesmo assim?`);
   if(!seguir)return;
  }
  try{await api("POST","/api/itens",novo);fotoPend=null;f.dataset.confirmado="";await carregar();render();toast("Item cadastrado. Ele já aparece na lista pública.")}
  catch(er){toast(er.message)}}
});
carregar().then(async()=>{await carregarAlunos();atualizarTema();render()});
