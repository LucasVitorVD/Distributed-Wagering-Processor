import { Migration } from '@mikro-orm/migrations';

export class Migration20261106204348 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
      add column "resulting_balance_amount" numeric(18,2),
      add column "resulting_balance_currency" varchar(3);
    `);
    this.addSql(`
      update "wager_transactions" as transaction
      set
        "resulting_balance_amount" = coalesce(
          (
            select entry."balance_after_amount"
            from "wallet_ledger_entries" as entry
            where entry."transaction_id" = transaction."id"
          ),
          (
            select wallet."balance_amount"
            from "wallets" as wallet
            where wallet."id" = transaction."wallet_id"
          )
        ),
        "resulting_balance_currency" = coalesce(
          (
            select entry."balance_after_currency"
            from "wallet_ledger_entries" as entry
            where entry."transaction_id" = transaction."id"
          ),
          (
            select wallet."balance_currency"
            from "wallets" as wallet
            where wallet."id" = transaction."wallet_id"
          )
        );
    `);
    this.addSql(`
      alter table "wager_transactions"
      alter column "resulting_balance_amount" set not null,
      alter column "resulting_balance_currency" set not null;
    `);
    this.addSql(`
      alter table "wager_transactions"
      add constraint "chk_wager_result_balance_currency"
      check ("resulting_balance_currency" = "amount_currency"),
      add constraint "chk_wager_result_balance_non_negative"
      check ("resulting_balance_amount" >= 0);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
      drop constraint "chk_wager_result_balance_currency",
      drop constraint "chk_wager_result_balance_non_negative",
      drop column "resulting_balance_amount",
      drop column "resulting_balance_currency";
    `);
  }
}
