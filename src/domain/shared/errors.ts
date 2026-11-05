export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(amount: unknown, reason: string) {
    super('INVALID_MONEY', `Valor monetário inválido ${JSON.stringify(amount)}: ${reason}`);
  }
}

export class DifferentCurrencyError extends DomainError {
  constructor(a: string, b: string) {
    super('DIFFERENT_CURRENCY', `Moedas incompatíveis: ${a} vs ${b}`);
  }
}

export class NegativeBalanceError extends DomainError {
  constructor(walletId: string) {
    super('NEGATIVE_BALANCE', `Saldo ficaria negativo para a carteira ${walletId}`);
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(walletId: string, requested: string, available: string) {
    super(
      'INSUFFICIENT_BALANCE',
      `Saldo insuficiente na carteira ${walletId}: solicitado ${requested}, disponível ${available}`,
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

export class DuplicateWalletError extends DomainError {
  constructor(playerId: string, currency: string) {
    super(
      'DUPLICATE_WALLET',
      `Já existe uma carteira para player ${playerId} na moeda ${currency}`,
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

export class DuplicateReferenceReversalError extends DomainError {
  constructor(referenceId: string, kind: string) {
    super(
      'DUPLICATE_REFERENCE_REVERSAL',
      `Referência ${referenceId} já foi revertida por ${kind}`,
    );
  }
}

export class MissingReferenceError extends DomainError {
  constructor(referenceId: string) {
    super('MISSING_REFERENCE', `Referência não encontrada: ${referenceId}`);
  }
}

export class InvalidReferenceError extends DomainError {
  constructor(reason: string) {
    super('INVALID_REFERENCE', `Referência inválida: ${reason}`);
  }
}
