# Achados do Lourdes

🌐 **Acessar o site:** [victorgnw.github.io](https://victorgnw.github.io/) · [abrir direto no Render](https://victorgnw-github-io-1.onrender.com/)

Aplicação de achados e perdidos da EEEM Nossa Senhora de Lourdes. O mesmo serviço Node.js entrega a interface e a API; o GitHub guarda o código e o Render executa a aplicação.

> **Hospedagem temporária:** atualmente, o site está sendo hospedado no Render. O GitHub é utilizado para armazenar e versionar o código-fonte.

## Funcionalidades

- Lista pública com busca, filtros, ordenação e fotos opcionais
- Login de aluno e acompanhamento dos pedidos de retirada
- Painel da coordenação para cadastrar itens, analisar pedidos e registrar devoluções
- "Perdi um objeto": o aluno avisa o que perdeu; a coordenação vê o aviso com possíveis itens achados e o aluno é notificado se um item parecido for cadastrado
- Notificações (sino) para o aluno quando o pedido muda de status e para a coordenação quando chega um pedido ou aviso
- Interface responsiva, tema claro/escuro e aviso de itens novos


## Manutenção e privacidade

- `GET /api/saude` responde `ok` e o tempo no ar, sem dados de alunos. Use para monitorar o site (Render, UptimeRobot).
- Limpeza automática a cada 6 horas: apaga itens devolvidos com mais de `DIAS_ITEM_DEVOLVIDO` dias (padrão 180), junto com os pedidos deles; avisos de objeto perdido encerrados há mais de 30 dias; e fotos que nenhum item usa (poupa as de menos de 1 hora).
- Erros do servidor vão para `dados/erros.log` (sem dados de alunos). Erros não tratados encerram o processo e o Render o reinicia.
- O texto de privacidade fica em "Como funciona" > "Privacidade e dados". Confirme com a direção da escola antes de divulgar.
