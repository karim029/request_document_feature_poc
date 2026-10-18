import { MigrationInterface, QueryRunner } from 'typeorm';

export class Baseline1792330660627 implements MigrationInterface {
  name = 'Baseline1792330660627';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`document_request\` (\`id\` int NOT NULL AUTO_INCREMENT, \`title\` varchar(255) NOT NULL, \`description\` varchar(255) NULL, \`status\` enum ('pending', 'reviewing', 'rejected', 'approved') NOT NULL DEFAULT 'pending', \`rejectionReason\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`documentPath\` varchar(255) NULL, \`clientId\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`client\` (\`id\` int NOT NULL AUTO_INCREMENT, \`username\` varchar(255) NOT NULL, \`email\` varchar(255) NOT NULL, \`accountantId\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`accountant\` (\`id\` int NOT NULL AUTO_INCREMENT, \`username\` varchar(255) NOT NULL, \`email\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`document_request\` ADD CONSTRAINT \`FK_e1a023811a35e967b82cc7ed22e\` FOREIGN KEY (\`clientId\`) REFERENCES \`client\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`client\` ADD CONSTRAINT \`FK_85af0fdcae13c0359a62fab2a1a\` FOREIGN KEY (\`accountantId\`) REFERENCES \`accountant\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`client\` DROP FOREIGN KEY \`FK_85af0fdcae13c0359a62fab2a1a\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`document_request\` DROP FOREIGN KEY \`FK_e1a023811a35e967b82cc7ed22e\``,
    );
    await queryRunner.query(`DROP TABLE \`accountant\``);
    await queryRunner.query(`DROP TABLE \`client\``);
    await queryRunner.query(`DROP TABLE \`document_request\``);
  }
}
