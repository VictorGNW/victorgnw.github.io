# Achados do Lourdes

Aplicação de achados e perdidos da EEEM Nossa Senhora de Lourdes. O mesmo serviço Node.js entrega a interface e a API; o GitHub guarda o código e o Render executa a aplicação.

## Funcionalidades

- Lista pública com busca, filtros, ordenação e fotos opcionais
- Login de aluno e acompanhamento dos pedidos de retirada
- Painel da coordenação para cadastrar itens, analisar pedidos e registrar devoluções
- Interface responsiva, tema claro/escuro e aviso de itens novos

## Requisitos e execução local

- Node.js 18 ou mais novo
- Uma senha forte para a coordenação

```sh
npm install
SENHA_COORDENACAO='defina-uma-senha-forte' npm start
```

O site abre em `http://localhost:3000`. Para desenvolvimento local, os dados ficam em `./dados`. Não coloque senhas ou dados reais no repositório.

## Implantação no Render

O arquivo `render.yaml` configura um único serviço web Node.js. Ele define o comando de inicialização, o endereço de escuta, a pasta de dados e solicita a senha como segredo. A configuração não cria nem publica um serviço por conta própria.

1. No Render, crie um serviço a partir deste repositório e use o Blueprint `render.yaml`.
2. O Blueprint solicita um serviço pago Starter e um Persistent Disk de 1 GB montado em `/var/data`. Confira os valores e o custo exibidos no Render antes de criar o serviço; o plano gratuito não oferece disco persistente.
3. Informe `SENHA_COORDENACAO` como segredo no Render. Use uma senha única, com pelo menos oito caracteres, que não seja uma das senhas fracas bloqueadas pelo servidor.
4. Faça o primeiro deploy e abra a URL do serviço. O Render termina o HTTPS; `CONFIAR_PROXY=sim` permite ao servidor considerar os cabeçalhos encaminhados pelo proxy.

O serviço deve ficar em uma única instância: o disco persistente do Render é associado a uma instância e não pode ser compartilhado entre várias. A hospedagem fornece a porta em `PORT`; o servidor escuta em `0.0.0.0`.

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
