import { DataSource } from "typeorm"
import { loadEnvFile } from "node:process"

loadEnvFile()

export const AppDataSource = new DataSource({
    type: 'mariadb',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    synchronize: false,
    entities: [
        __dirname + "/**/*.entity{.ts,.js}"
    ],
    migrations: [
        __dirname + "/migrations/**/*{.js,.ts}"
    ]
})


