# Achados do Lourdes

Aplicação de achados e perdidos da EEEM Nossa Senhora de Lourdes. O mesmo serviço Node.js entrega a interface e a API; o GitHub guarda o código e o Render executa a aplicação.

## Funcionalidades

- Lista pública com busca, filtros, ordenação e fotos opcionais
- Login de aluno e acompanhamento dos pedidos de retirada
- Painel da coordenação para cadastrar itens, analisar pedidos e registrar devoluções
- Interface responsiva, tema claro/escuro e aviso de itens novos

### Persistência e cópias de segurança

Itens e pedidos ficam em `banco.json`; fotos ficam em `fotos/`; cópias diárias do JSON ficam em `backups/`; logs de segurança ficam em `seguranca.log`. Todos ficam sob `DATA_DIR`, portanto no Render precisam estar abaixo de `/var/data`.

O backup automático inclui apenas o JSON, não as fotos. Para uma cópia completa, preserve também a pasta `fotos/` e guarde essa cópia fora do serviço. O servidor cria exemplos somente quando o arquivo de banco ainda não existe; se encontrar um banco inválido, interrompe a inicialização sem sobrescrevê-lo. Restaure o JSON e as fotos a partir de uma cópia antes de reiniciar.

Anexe o disco antes do primeiro uso com dados reais. Se já houver dados em outra hospedagem, copie o conteúdo da antiga pasta `dados/` para `/var/data` no disco persistente antes de apontar o serviço para ele.

### Segurança e contas de demonstração

- Defina `SENHA_COORDENACAO` nos segredos do Render; não a adicione ao GitHub.
- `banco.js` contém alunos e códigos de RA de demonstração. O login de aluno usa somente o RA; substitua esses dados e confirme o método de autenticação com a escola antes de inserir dados reais.
- Tokens de sessão e limites de requisição ficam em memória. Reiniciar o serviço encerra as sessões e reinicia esses limites.
- Os pedidos contêm nome e turma. Restrinja o acesso ao painel e mantenha backups em local protegido.

## Arquivos

- `server.js`: servidor HTTP, API, autenticação, armazenamento e backups
- `banco.js`: dados de alunos de demonstração
- `index.html`, `style.css`, `script.js`: interface do site
- `render.yaml`: configuração do serviço no Render
