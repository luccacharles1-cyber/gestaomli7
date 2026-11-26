# MLI Gestão — Etapa 1

App de gestão por assinatura para lojas de iPhone. Cada loja tem dados isolados. Interface em pt-BR, valores em R$, fuso America/Sao_Paulo.

## O que será entregue

1. **Visual e navegação**: tons grafite, branco e cinza com dourado discreto. Menu lateral no computador e menu inferior/gaveta no celular. Itens do menu: Início, Estoque, Vendas, Clientes e CRM, Avaliação de usados, Financeiro, Relatórios, Documentos, Fornecedores, Configurações. As telas que ainda não existem mostram "Em desenvolvimento", sem botões falsos.
2. **Contas**: cadastro, login, recuperação de senha (/reset-password). No primeiro acesso, um assistente cria a loja, e quem cria vira Proprietário.
3. **Perfis**: Proprietário, Gerente e Vendedor, com permissões separadas (ver custos, ver financeiro, dar descontos, aprovar avaliações, gerenciar estoque, gerenciar equipe). O Proprietário convida membros por e-mail. O papel de administrador da plataforma fica numa tabela à parte; ninguém consegue se cadastrar como admin.
4. **Configurações da loja**: nome, CNPJ/CPF, contato, endereço, logo, texto de garantia, gestão da equipe e das permissões.
5. **Estoque**: aparelhos controlados um a um, com todos os campos da ficha (IMEI 1/2, série, condição, bateria, peças trocadas, checklist de testes, custos, custo total calculado, preço de venda e preço mínimo, localização, fotos). Acessórios controlados por quantidade. Os 7 status do brief. Histórico de movimentações. IMEI nunca se repete na mesma loja, nem cruzando IMEI 1 com IMEI 2. Busca e filtros por modelo, armazenamento, condição, status e dias em estoque. Custos ficam ocultos para quem não tem permissão, e esse bloqueio é aplicado no servidor.
6. **Cards internos**: foto principal, galeria e dados comerciais. É possível escolher fotos e compartilhar só as fotos pelo compartilhamento nativo do celular (dá para escolher o WhatsApp), com descrição e preço opcionais. Quando o compartilhamento nativo não existir, as fotos são baixadas. Nunca saem custo, fornecedor ou observações internas.
7. **Início**: cabeçalho, ações rápidas (Nova venda / Novo contato / Lançar despesa aparecem como em desenvolvimento), indicadores com filtro de período (hoje, 7 dias, mês, personalizado) e capital em estoque calculado com dados reais. Faturamento, lucro e financeiro aparecem zerados com o aviso "módulo em desenvolvimento". Também terá checklist de configuração no primeiro acesso, faixa de destaques (vazia até o admin cadastrar) e pendências. Não haverá dados fictícios.
8. **Admin da plataforma (básico)**: cadastrar destaques e conceder manualmente o acesso a Fornecedores.

## Estrutura de dados (resumo)

- lojas, membros da loja (papel + permissões), papéis da plataforma
- aparelhos, fotos dos aparelhos, movimentações, acessórios
- destaques, concessões de produtos (fornecedores), planos/assinatura (só a estrutura, sem preços)
- histórico de alterações (auditoria)

Toda tabela tem a loja como dona dos registros, com regras de acesso no banco que só deixam ver os registros da própria loja. As fotos ficam num armazenamento privado separado por pasta da loja, e só são abertas por links temporários.

## Dependência

Preciso ativar o **Lovable Cloud**, que traz banco de dados, login e armazenamento de arquivos. Você não precisa fazer nada além de aprovar.

## Verificações ao final

- Criar duas contas com duas lojas diferentes. Cadastrar e editar um aparelho, enviar fotos e confirmar que a loja B não consegue ler nem os aparelhos nem as fotos da loja A, consultando direto no banco e não só pela tela.
- Tentar cadastrar um IMEI duplicado e confirmar que é bloqueado.
- Confirmar que um Vendedor sem permissão não recebe o custo do servidor.
- Testes automáticos dos cálculos (custo total, capital em estoque, validação de IMEI).

## Detalhes técnicos

- TanStack Start com createServerFn e requireSupabaseAuth. Rotas protegidas em `_authenticated/`.
- RLS com funções security definer `is_store_member(store_id)` e `has_store_permission(store_id, perm)`. `has_role` fica para o admin da plataforma.
- Os campos de custo ficam numa tabela `device_costs` separada, com RLS por permissão, para que o vendedor nunca receba esses valores.
- Valores monetários em `numeric(12,2)`. No cliente, cálculos em centavos inteiros.
- IMEI único por loja: tabela `device_imeis(store_id, imei)` com unique, alimentada por trigger, para cobrir o cruzamento entre IMEI1 e IMEI2.
- Bucket privado `device-photos/{store_id}/...` com políticas em storage.objects por membro da loja e signed URLs.
- Compartilhamento via `navigator.share({ files })`, com download como alternativa.
- Head metadata própria em cada rota. Não haverá service worker (só a estrutura pronta para PWA no futuro).
