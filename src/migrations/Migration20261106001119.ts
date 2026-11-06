import { Migration } from "@mikro-orm/migrations";

export class Migration20261106001119 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" varchar(255) not null,
        "balance_amount" numeric(18, 2) not null,
        "balance_currency" varchar(3) not null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "chk_wallets_balance_non_negative" check ("balance_amount" >= 0),
        constraint "uq_wallets_player_currency" unique ("player_id", "balance_currency")
      );
    `);

    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "kind" varchar(10) not null,
        "amount_amount" numeric(18, 2) not null,
        "amount_currency" varchar(3) not null,
        "status" varchar(30) not null,
        "idempotency_key" text not null,
        "payload_hash" text not null,
        "reference_external_transaction_id" text null,
        "reference_transaction_id" uuid null,
        "provider_id" text not null,
        "external_transaction_id" text not null,
        "player_id" text not null,
        "round_id" text not null,
        "game_id" text not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "processed_at" timestamptz null,
        "failure_code" varchar(50) null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "chk_wager_amount_positive" check ("amount_amount" > 0),
        constraint "uq_wager_transactions_provider_external" unique ("provider_id", "external_transaction_id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_wallet_id_foreign"
          foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wager_transactions_reference_foreign"
          foreign key ("reference_transaction_id") references "wager_transactions" ("id")
      );
    `);

    this.addSql(`
      create index "idx_wager_transactions_wallet"
      on "wager_transactions" ("wallet_id");
    `);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "type" varchar(10) not null,
        "direction" varchar(10) not null,
        "money_amount" numeric(18, 2) not null,
        "money_currency" varchar(3) not null,
        "balance_before_amount" numeric(18, 2) not null,
        "balance_before_currency" varchar(3) not null,
        "balance_after_amount" numeric(18, 2) not null,
        "balance_after_currency" varchar(3) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "chk_ledger_money_positive" check ("money_amount" > 0),
        constraint "chk_ledger_balance_non_negative"
          check ("balance_before_amount" >= 0 and "balance_after_amount" >= 0),
        constraint "chk_ledger_currency_consistency"
          check (
            "money_currency" = "balance_before_currency"
            and "money_currency" = "balance_after_currency"
          ),
        constraint "uq_wallet_ledger_entries_wallet_transaction"
          unique ("wallet_id", "transaction_id"),
        constraint "wallet_ledger_entries_wallet_id_foreign"
          foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wallet_ledger_entries_transaction_id_foreign"
          foreign key ("transaction_id") references "wager_transactions" ("id")
      );
    `);

    this.addSql(`
      create index "idx_wallet_ledger_entries_transaction"
      on "wallet_ledger_entries" ("transaction_id");
    `);

    this.addSql(`
      create function prevent_wallet_ledger_entries_mutation()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'wallet_ledger_entries is immutable'
          using errcode = '55000';
      end;
      $$;
    `);

    this.addSql(`
      create trigger wallet_ledger_entries_immutable
      before update or delete on "wallet_ledger_entries"
      for each row execute function prevent_wallet_ledger_entries_mutation();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      drop trigger if exists wallet_ledger_entries_immutable
      on "wallet_ledger_entries";
    `);
    this.addSql("drop function if exists prevent_wallet_ledger_entries_mutation();");
    this.addSql('drop table if exists "wallet_ledger_entries";');
    this.addSql('drop table if exists "wager_transactions";');
    this.addSql('drop table if exists "wallets";');
  }
}
