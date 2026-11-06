import { Migration } from '@mikro-orm/migrations';

export class Migration20261106120418 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "wallets"
      drop constraint "uq_wallets_player_currency";
    `);
    this.addSql(`
      alter table "wallets"
      alter column "player_id" type uuid using "player_id"::uuid;
    `);
    this.addSql(`
      alter table "wallets"
      add constraint "uq_wallets_player_currency"
      unique ("player_id", "balance_currency");
    `);

    this.addSql(`
      alter table "wager_transactions"
      alter column "provider_id" drop not null,
      alter column "external_transaction_id" drop not null,
      alter column "player_id" drop not null,
      alter column "round_id" drop not null,
      alter column "game_id" drop not null;
    `);
    this.addSql(`
      alter table "wager_transactions"
      add constraint "chk_wager_provider_fields_by_kind"
      check (
        (
          "kind" = 'OPENING'
          and "provider_id" is null
          and "external_transaction_id" is null
          and "player_id" is null
          and "round_id" is null
          and "game_id" is null
        )
        or
        (
          "kind" <> 'OPENING'
          and "provider_id" is not null
          and "external_transaction_id" is not null
          and "player_id" is not null
          and "round_id" is not null
          and "game_id" is not null
        )
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
      drop constraint "chk_wager_provider_fields_by_kind";
    `);
    this.addSql(`
      alter table "wager_transactions"
      alter column "provider_id" set not null,
      alter column "external_transaction_id" set not null,
      alter column "player_id" set not null,
      alter column "round_id" set not null,
      alter column "game_id" set not null;
    `);

    this.addSql(`
      alter table "wallets"
      drop constraint "uq_wallets_player_currency";
    `);
    this.addSql(`
      alter table "wallets"
      alter column "player_id" type varchar(255) using "player_id"::text;
    `);
    this.addSql(`
      alter table "wallets"
      add constraint "uq_wallets_player_currency"
      unique ("player_id", "balance_currency");
    `);
  }
}
