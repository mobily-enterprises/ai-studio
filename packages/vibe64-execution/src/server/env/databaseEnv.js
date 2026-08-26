import {
  envRecord
} from "../normalize.js";

const DATABASE_ENV_NAMES = Object.freeze([
  "DATABASE_URL",
  "DB_CLIENT",
  "DB_DATABASE",
  "DB_HOST",
  "DB_NAME",
  "DB_PASSWORD",
  "DB_PORT",
  "DB_USER",
  "DB_USERNAME",
  "MYSQL_DATABASE",
  "MYSQL_HOST",
  "MYSQL_PWD",
  "MYSQL_TCP_PORT",
  "PGDATABASE",
  "PGHOST",
  "PGPASSWORD",
  "PGPORT",
  "PGUSER",
  "VIBE64_MYSQL_USER"
]);
function databaseEnv(...records) {
  const output = {};
  for (const record of records) {
    const env = envRecord(record);
    for (const name of DATABASE_ENV_NAMES) {
      if (env[name] !== undefined) {
        output[name] = env[name];
      }
    }
  }
  return output;
}

export {
  DATABASE_ENV_NAMES,
  databaseEnv
};
