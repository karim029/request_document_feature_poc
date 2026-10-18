import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropDocumentPath1792338338209 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\` DROP \`documentPath\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`document_request\` ADD \`documentPath\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `UPDATE \`document_request\` SET \`documentPath\` = \`storageKey\` WHERE \`storageKey\` IS NOT NULL`,
    );
  }
}
