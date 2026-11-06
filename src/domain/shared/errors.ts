export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class WalletNotFoundError extends DomainError {
  constructor() {
    super('WALLET_NOT_FOUND', 'Carteira não encontrada.');
  }
}

export class WagerTransactionNotFoundError extends DomainError {
  constructor() {
    super('WAGER_TRANSACTION_NOT_FOUND', 'Transação não encontrada.');
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor() {
    super(
      'IDEMPOTENCY_CONFLICT',
      'A chave de idempotência já foi usada com outros dados.',
    );
  }
}

export class DuplicateWagerTransactionError extends DomainError {
  constructor() {
    super(
      'DUPLICATE_TRANSACTION',
      'Já existe uma transação com essa referência do provedor.',
    );
  }
}

export class NegativeBalanceError extends DomainError {
  constructor(walletId: string) {
    super(
      'NEGATIVE_BALANCE',
      `Saldo ficaria negativo para a carteira ${walletId}`,
    );
  }
}

export class WalletCurrencyMismatchError extends DomainError {
  constructor(walletCurrency: string, operationCurrency: string) {
    super(
      'WALLET_CURRENCY_MISMATCH',
      `Moeda da operação (${operationCurrency}) difere da moeda da carteira (${walletCurrency})`,
    );
  }
}

export class InvalidInitialBalanceError extends DomainError {
  constructor() {
    super('INVALID_INITIAL_BALANCE', 'Saldo inicial não pode ser negativo');
  }
}

export class InvalidAmountError extends DomainError {
  constructor() {
    super('INVALID_AMOUNT', 'O valor deve ser positivo');
  }
}

export class InvalidResultingBalanceError extends DomainError {
  constructor() {
    super(
      'INVALID_RESULTING_BALANCE',
      'O saldo resultante deve ser não negativo e usar a mesma moeda da transação.',
    );
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(transactionId: string, from: string, to: string) {
    super(
      'INVALID_TRANSACTION_STATE',
      `Transação ${transactionId} não pode passar de ${from} para ${to}`,
    );
  }
}

export class MissingTransactionReferenceError extends DomainError {
  constructor(type: string) {
    super(
      'MISSING_TRANSACTION_REFERENCE',
      `Transação do tipo ${type} exige uma referência externa`,
    );
  }
}

export class MissingProviderTransactionDataError extends DomainError {
  constructor() {
    super(
      'MISSING_PROVIDER_TRANSACTION_DATA',
      'Transação exige todos os dados de identificação do provedor',
    );
  }
}

export class InvalidLedgerAmountError extends DomainError {
  constructor() {
    super('INVALID_LEDGER_AMOUNT', 'O valor do lançamento deve ser positivo');
  }
}

export class LedgerCurrencyMismatchError extends DomainError {
  constructor(walletCurrency: string, operationCurrency: string) {
    super(
      'LEDGER_CURRENCY_MISMATCH',
      `Moeda do lançamento (${operationCurrency}) difere da moeda do saldo (${walletCurrency})`,
    );
  }
}

export class NegativeLedgerBalanceError extends DomainError {
  constructor() {
    super(
      'NEGATIVE_LEDGER_BALANCE',
      'Saldo do lançamento não pode ser negativo',
    );
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  constructor() {
    super(
      'UNBALANCED_LEDGER_ENTRY',
      'Lançamento do ledger não está balanceado',
    );
  }
}
