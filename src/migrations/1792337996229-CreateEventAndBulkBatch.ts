import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventAndBulkBatch1792337996229 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`document_request_event\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`requestId\` int NOT NULL,
          \`fromStatus\` enum ('pending', 'reviewing', 'rejected', 'approved') NULL,
          \`toStatus\` enum ('pending', 'reviewing', 'rejected', 'approved') NOT NULL,
          \`reason\` text NULL,
          \`actorAccountantId\` int NULL,
          \`actorClientId\` int NULL,
          \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_event_request_history\` (\`requestId\`, \`createdAt\`, \`id\`),
          CONSTRAINT \`FK_event_request\` FOREIGN KEY (\`requestId\`) REFERENCES \`document_request\`(\`id\`),
          CONSTRAINT \`FK_event_actor_accountant\` FOREIGN KEY (\`actorAccountantId\`) REFERENCES \`accountant\`(\`id\`),
          CONSTRAINT \`FK_event_actor_client\` FOREIGN KEY (\`actorClientId\`) REFERENCES \`client\`(\`id\`),
          CONSTRAINT \`CHK_event_one_actor\` CHECK ((\`actorAccountantId\` IS NOT NULL) + (\`actorClientId\` IS NOT NULL) = 1)
        ) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`bulk_batch\` (
          \`id\` int NOT NULL AUTO_INCREMENT,
          \`idempotencyKey\` varchar(64) NOT NULL,
          \`requestHash\` char(64) NOT NULL,
          \`response\` text NOT NULL,
          \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`UQ_bulk_batch_key\` (\`idempotencyKey\`)
        ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`bulk_batch\``);
    await queryRunner.query(`DROP TABLE \`document_request_event\``);
  }
}
