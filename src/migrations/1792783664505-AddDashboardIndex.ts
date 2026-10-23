import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDashboardIndex1792783664505 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\`
         ADD INDEX \`IDX_request_dashboard\` (\`accountantId\`, \`status\`, \`dueDate\`, \`clientId\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\` DROP INDEX \`IDX_request_dashboard\``,
    );
  }
}
