import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRequestColumns1792333848066 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`document_request\`
         ADD \`dueDate\` date NULL,
         ADD \`reviewerId\` int NULL,
         ADD \`reviewedAt\` datetime(6) NULL,
         ADD \`storageKey\` varchar(255) NULL,
         ADD \`originalName\` varchar(255) NULL,
         ADD \`mimeType\` varchar(100) NULL,
         ADD \`fileSize\` int NULL,
         ADD \`checksum\` char(64) NULL,
         ADD \`version\` int NOT NULL DEFAULT 0,
         ADD \`accountantId\` int NULL,
         ALGORITHM=INSTANT`
        )
        await queryRunner.query(
            `ALTER TABLE \`document_request\` MODIFY \`description\` text NULL`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`document_request\` MODIFY \`description\` varchar(255) NULL`
        )
        await queryRunner.query(
            `ALTER TABLE \`document_request\`
         DROP \`dueDate\`,
         DROP \`reviewerId\`,
         DROP \`reviewedAt\`,
         DROP \`storageKey\`,
         DROP \`originalName\`,
         DROP \`mimeType\`,
         DROP \`fileSize\`,
         DROP \`checksum\`,
         DROP \`version\`,
         DROP \`accountantId\``
        )
    }

}