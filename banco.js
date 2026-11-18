/* Mini banco de dados de alunos (demonstração).
   Cada aluno tem: id, nome, ano (1, 2 ou 3), turma e código de login (6 números).
   Na hospedagem, SO O SERVIDOR le este arquivo (ele nao e enviado ao navegador). */
const ALUNOS=[
 {id:1,nome:"Pedro Henrique",ano:2,turma:"2º IM01",codigo:"104822"},
 {id:2,nome:"Ana Beatriz",ano:1,turma:"1º IM02",codigo:"215936"},
 {id:3,nome:"Lucas Gabriel",ano:3,turma:"3º IM01",codigo:"338710"},
 {id:4,nome:"Maria Eduarda",ano:2,turma:"2º IM02",codigo:"449283"},
 {id:5,nome:"João Vitor",ano:1,turma:"1º IM01",codigo:"557194"},
 {id:6,nome:"Isabela Souza",ano:3,turma:"3º IM02",codigo:"662045"},
 {id:7,nome:"Gabriel Costa",ano:2,turma:"2º IM01",codigo:"773518"},
 {id:8,nome:"Laura Fernandes",ano:1,turma:"1º IM02",codigo:"884627"},
 {id:9,nome:"Rafael Almeida",ano:3,turma:"3º IM01",codigo:"995130"},
 {id:10,nome:"Beatriz Lima",ano:2,turma:"2º IM02",codigo:"106249"}
];
const BancoAlunos={
 todos:()=>ALUNOS.slice(),
 porId:id=>ALUNOS.find(a=>a.id===id)||null,
 porCodigo:cod=>ALUNOS.find(a=>a.codigo===cod)||null,
 porAno:ano=>ano?ALUNOS.filter(a=>a.ano===ano):ALUNOS.slice(),
 turmas:()=>[...new Set(ALUNOS.map(a=>a.turma))].sort()
};

if (typeof module !== "undefined" && module.exports) module.exports = BancoAlunos;
