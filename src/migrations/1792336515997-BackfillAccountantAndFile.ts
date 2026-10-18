import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillAccountantAndFile1792336515997 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE \`document_request\` dr
         JOIN \`client\` c ON dr.\`clientId\` = c.\`id\`
         SET dr.\`accountantId\` = c.\`accountantId\`
         WHERE dr.\`accountantId\` IS NULL`
        )
        await queryRunner.query(
            `UPDATE \`document_request\`
         SET \`storageKey\` = \`documentPath\`
         WHERE \`documentPath\` IS NOT NULL AND \`storageKey\` IS NULL`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
