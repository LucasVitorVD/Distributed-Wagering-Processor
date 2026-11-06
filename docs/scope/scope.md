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
