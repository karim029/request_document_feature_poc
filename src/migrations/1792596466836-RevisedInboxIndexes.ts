import { MigrationInterface, QueryRunner } from 'typeorm';

export class RevisedInboxIndexes1792596466836 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\`
            DROP INDEX \`IDX_request_inbox_created\`,
            ADD INDEX \`IDX_request_inbox_created\` (\`accountantId\`, \`createdAt\`, \`id\`),
            DROP INDEX IF EXISTS \`IDX_request_inbox_status_created\`,
            ADD INDEX \`IDX_request_inbox_status_created\` (\`accountantId\`, \`status\`, \`createdAt\`, \`id\`),
            DROP INDEX \`IDX_request_inbox_due\`,
            ADD INDEX \`IDX_request_inbox_due\` (\`accountantId\`, \`dueDate\`, \`id\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\`
            DROP INDEX \`IDX_request_inbox_created\`,
            ADD INDEX \`IDX_request_inbox_created\` (\`accountantId\`, \`status\`, \`createdAt\`),
            DROP INDEX \`IDX_request_inbox_status_created\`,
            DROP INDEX \`IDX_request_inbox_due\`,
            ADD INDEX \`IDX_request_inbox_due\` (\`accountantId\`, \`status\`, \`dueDate\`)`,
    );
  }
}
