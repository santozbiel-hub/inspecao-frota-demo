# Inspeção de Frota — aplicação completa

Checklists, fotos, observações, progresso semanal, histórico, permissões e sincronização offline.

Next.js, React, TypeScript e Supabase. Os arquivos preservam a estrutura funcional do projeto; nomes de tabelas, marca, contatos, sementes e recursos identificáveis foram neutralizados de forma consistente. Os ícones de marca são vetores demonstrativos.

## Configuração
1. Use Node.js 24 e instale as dependências (`npm install`).
2. Copie `.env.example` para `.env.local` e preencha com um projeto Supabase novo.
3. Aplique `supabase/migrations/` em ordem. Crie o primeiro usuário em Authentication → Users. O gatilho cria um perfil inspector; no SQL Editor execute `update public.profiles set role = 'admin' where id = 'UUID_DO_USUARIO';`. Publique a função `criar-usuario` no seu projeto, configure suas origens permitidas e crie os usuários. O veículo de exemplo é fictício. Os arquivos em `supabase/tests/` verificam regras e RLS em banco de teste.
4. Execute `npm run dev` e abra http://localhost:3000.

## Verificação
`npm test` executa os testes incluídos; `npm run build` compila a aplicação. Os fluxos autenticados, uploads e persistência dependem de Supabase configurado. A presença do código não equivale a uma validação ponta a ponta em produção.

## Separação dos ambientes
Nunca use URLs, chaves ou banco de um cliente nesta versão. As migrações devem ir para um banco vazio. Não configure credenciais de serviço com prefixo NEXT_PUBLIC. Arquivos de ambiente, caches e uploads são ignorados pelo Git.
