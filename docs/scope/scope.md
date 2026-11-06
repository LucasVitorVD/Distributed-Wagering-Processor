# Scope: Distributed Wagering Processor

Este serviço processa transações de apostas e mantém carteiras e seus lançamentos. Este scope acompanha o trabalho de persistência necessário para processar apostas com segurança.

**Build approach:** Tracer Bullet (conectar cada camada em uma fatia pequena e funcional).
**Workflow:** Beta (verificação e testes depois do build).

_Estas são recomendações para organizar o build, não requisitos. Você decide quando uma feature está concluída._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | BET repositories | Bet processing | in-progress |
| 2 | Wallet creation | Wallets | in-progress |
| 3 | Wallet reads | Wallets | in-progress |
| 4 | Wagering transaction API | Bet processing | in-progress |
| 5 | Provider authentication and request limits | Security | planned |

## Bet processing

### 1. BET repositories · in-progress
Criar contratos de domínio e adapters MikroORM para ler e persistir carteiras, transações e lançamentos de ledger na mesma transação.
**Done when:** consultas retornam os registros existentes; o lock serializa operações na mesma carteira; gravações relacionadas confirmam juntas ou são revertidas; testes de integração verificam constraints e imutabilidade do ledger.
- [x] Design it (spec): `/architect repositories para BET`
- [x] Build it: `/develop BET repositories`
  - [x] Contratos de domínio e unidade de trabalho (AC-1, AC-2, AC-3, AC-4)
  - [x] Adapters MikroORM, lock e gravação transacional (AC-2, AC-3, AC-4, AC-5, AC-6)
  - [x] PostgreSQL descartável e testes de integração (AC-5, AC-6, AC-7, AC-8)
- [ ] Verify it: `/check verify BET repositories`
- [ ] Test it: `/test BET repositories`
Spec [0001](../specs/0001-bet-repositories/index.md)
Code in: `src/domain/repositories`, `src/infrastructure/persistence`, `test/wagering-repositories.integration-spec.ts`

### 4. Wagering transaction API · in-progress
Expor consultas por ID interno e por referência do provedor, além do POST síncrono para todos os tipos externos.
**Done when:** GETs retornam a mesma representação; POST aceita todos os tipos externos e aplica as regras de saldo e referência; a resposta contém `transactionId`, `status`, `balance` e `idempotentReplay`; o saldo do resultado é persistido para replay estável; chave e hash garantem replay seguro; gravações são atômicas e os conflitos, falhas e limites de segurança estão documentados e testados.
- [x] Design it (spec): `/architect API de transações de wagering` [0004](../specs/0004-wagering-transactions-api/index.md)
- [x] Build it: `/develop wagering transaction API`
  - [x] Consultas GET e representação sem dados internos (AC-1, AC-2, AC-11)
  - [x] Fluxo BET síncrono com validação, hash e replay (AC-3, AC-4, AC-8, AC-9)
  - [x] Tipos externos, referências, rejeições e limites acumulados (AC-5, AC-6, AC-7)
  - [x] Corridas de unicidade, erros, testes e documentação (AC-10, AC-12, AC-13)
  - [x] Saldo de resultado persistido e formato compacto do POST com replay estável (AC-4, AC-7, AC-9, AC-11)
- [ ] Verify it: `/check verify wagering transaction API`
- [ ] Test it: `/test wagering transaction API`
Code in: `src/wagering`, `src/domain/wagering`, `src/domain/repositories`, `src/infrastructure/persistence`, `src/common/filters`, `test/wagering-transactions-api.integration-spec.ts`, `README.md`

## Security

### 5. Provider authentication and request limits · needs a decision
Adicionar autenticação de provedor, escopo de acesso e limite de chamadas antes de expor as rotas publicamente. Derivado da spec 0004.
**Done when:** a identidade do provedor é verificada; consultas e alterações ficam limitadas aos dados do provedor; limites de chamadas e testes de acesso estão definidos.
- [ ] Design it (spec): `/architect autenticação de provedor e limites de requisição`

## Wallets

### 2. Wallet creation · in-progress
Criar uma wallet BRL por `playerId` via `POST /wallets`, com validação, resposta uniforme de erros e abertura atômica no ledger para saldo inicial positivo. Saldo zero cria somente a wallet. Autenticação e limite de chamadas ficam fora do desafio e devem ser documentados como necessários antes de exposição pública.
**Done when:** a rota cria wallets com saldo zero e positivo; para saldo positivo, wallet, `OPENING` e lançamento de ledger persistem juntos; duplicidade retorna conflito; entradas inválidas e falhas inesperadas usam o contrato de erro; testes de integração verificam atomicidade e concorrência; o README explica o limite de segurança.
- [x] Design it (spec): `/architect POST /wallets` [0002](../specs/0002-wallet-creation-api.md)
- [x] Build it: `/develop wallet creation`
  - [x] Suporte de domínio e migração para `OPENING` e ledger (AC-3, AC-4, AC-5)
  - [x] Fluxo `POST /wallets` para saldo zero e positivo (AC-2, AC-3, AC-4, AC-5)
  - [x] Validação, erros, testes e documentação do limite de segurança (AC-1, AC-6, AC-7, AC-8)
Code in: `src/wallets`, `src/common`, `src/domain`, `src/migrations`, `test/wallet-creation*`, `README.md`
- [ ] Verify it: `/check verify wallet creation`
- [ ] Test it: `/test wallet creation`

### 3. Wallet reads · in-progress
Disponibilizar `GET /wallets/:walletId` para consultar o saldo e `GET /wallets/:walletId/ledger` para consultar lançamentos com cursor estável.
**Done when:** as duas rotas retornam os campos definidos; validação, paginação, carteira inexistente e histórico vazio seguem o contrato; os logs não incluem dados financeiros; testes unitários, HTTP e PostgreSQL cobrem os casos; o README explica o limite de segurança do desafio.
- [x] Design it (spec): `/architect GET /wallets` [0003](../specs/0003-wallet-query-api.md)
- [x] Build it: `/develop wallet reads`
  - [x] Consulta da wallet, resposta e validação (AC-1, AC-2, AC-7)
  - [x] Cursor do ledger, paginação e testes PostgreSQL (AC-3, AC-4, AC-5, AC-6, AC-7)
  - [x] Logs seguros e documentação do limite de segurança (AC-8, AC-9)
- [ ] Verify it: `/check verify wallet reads`
- [ ] Test it: `/test wallet reads`
Code in: `src/wallets`, `src/common`, `src/domain/repositories`, `src/infrastructure/persistence`, `test/wallet-query-api.integration-spec.ts`, `test/wallet-creation.e2e-spec.ts`, `README.md`
