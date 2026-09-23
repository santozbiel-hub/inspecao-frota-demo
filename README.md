# Inspeção de Frota

Protótipo interativo, independente, com identidade genérica e dados fictícios.

## Problema

Um checklist diário precisa conservar pendências ainda não resolvidas, mesmo quando a data muda.

## Experimente

Marcar conformidade; avançar o dia; consultar grade mensal; resolver pendências no perfil administrador; simular fila sem sinal.

1. Marque um item como não conforme e avance o dia.
2. Confira que a pendência continua aberta.
3. Alterne para administrador e resolva a ocorrência.

## Executar localmente

Com Python 3 instalado, execute na pasta do repositório:

```bash
python3 -m http.server 8080
```

Abra http://localhost:8080. Não são necessárias contas, credenciais, instalação de pacotes ou configuração de banco.

## Tecnologias e decisões

- HTML semântico, CSS responsivo e JavaScript sem dependências de execução.
- Estado somente em memória: recarregar restaura o cenário de demonstração.
- Conteúdo de formulários escapado antes de ser inserido no HTML.
- Política de conteúdo bloqueia conexões externas da aplicação.
- Nomes, clientes, veículos e registros são demonstrativos.

## Limites

Perfis são seletores de demonstração, não autenticação ou controle de acesso real. Não há banco, upload ou sincronização real. Não use este protótipo para registros reais. Os dados desaparecem ao recarregar.

## Estrutura

- `index.html`: entrada e política de conteúdo.
- `shared.css`: estilos responsivos.
- `demo.js`: dados fictícios, navegação e interações.

## Licença

Nenhuma licença de código aberto foi concedida neste repositório.
