export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class NegativeBalanceError extends DomainError {
  constructor(walletId: string) {
    super(
      "NEGATIVE_BALANCE",
      `Saldo ficaria negativo para a carteira ${walletId}`,
    );
  }
}

export class WalletCurrencyMismatchError extends DomainError {
  constructor(walletCurrency: string, operationCurrency: string) {
    super(
      "WALLET_CURRENCY_MISMATCH",
      `Moeda da operação (${operationCurrency}) difere da moeda da carteira (${walletCurrency})`,
    );
  }
}

export class InvalidInitialBalanceError extends DomainError {
  constructor() {
    super(
      "INVALID_INITIAL_BALANCE",
      "Saldo inicial não pode ser negativo",
    );
  }
}

export class InvalidAmountError extends DomainError {
  constructor() {
    super("INVALID_AMOUNT", "O valor deve ser positivo");
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(transactionId: string, from: string, to: string) {
    super(
      "INVALID_TRANSACTION_STATE",
      `Transação ${transactionId} não pode passar de ${from} para ${to}`,
    );
  }
}
