import { DataSource, DataSourceOptions } from 'typeorm';

export const OrmConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT),
  username: process.env.PG_USER,
  password: process.env.PG_PASS,
  database: process.env.PG_DB,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
  migrationsTableName: 'db_migrations',
  synchronize: false,
};

export default new DataSource(OrmConfig);
