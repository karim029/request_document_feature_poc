import { MigrationInterface, QueryRunner } from 'typeorm';

export class RequireAccountantAddIndexes1792337372634 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\` MODIFY \`accountantId\` int NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_request_inbox_created\` ON \`document_request\` (\`accountantId\`, \`status\`, \`createdAt\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_request_inbox_due\` ON \`document_request\` (\`accountantId\`, \`status\`, \`dueDate\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_request_reviewer\` ON \`document_request\` (\`reviewerId\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`document_request\`
         ADD CONSTRAINT \`FK_request_accountant\` FOREIGN KEY (\`accountantId\`) REFERENCES \`accountant\`(\`id\`),
         ADD CONSTRAINT \`FK_request_reviewer\` FOREIGN KEY (\`reviewerId\`) REFERENCES \`accountant\`(\`id\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\`
         DROP FOREIGN KEY \`FK_request_reviewer\`,
         DROP FOREIGN KEY \`FK_request_accountant\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_request_reviewer\` ON \`document_request\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_request_inbox_due\` ON \`document_request\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_request_inbox_created\` ON \`document_request\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`document_request\` MODIFY \`accountantId\` int NULL`,
    );
  }
}
