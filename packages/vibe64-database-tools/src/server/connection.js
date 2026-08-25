import knexFactory from "knex";

import {
  vibe64Error
} from "@local/vibe64-core/server/core";

const DATABASE_POOL_MAX = 3;
const DATABASE_POOL_ACQUIRE_TIMEOUT_MS = 8_000;

function text(value = "") {
  return String(value ?? "").trim();
}

function urlProtocol(value = "") {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).protocol.replace(/:$/u, "").toLowerCase();
  } catch {
    throw vibe64Error(
      "The session database URL is invalid.",
      "vibe64_session_database_url_invalid"
    );
  }
}

function normalizedDatabaseClient(kind = "") {
  const candidate = text(kind).toLowerCase();
  if (candidate === "postgresql") {
    return {
      client: "pg",
      engine: "postgresql",
      label: "PostgreSQL"
    };
  }
  if (candidate === "mysql") {
    return {
      client: "mysql2",
      engine: "mysql",
      label: "MySQL / MariaDB"
    };
  }
  throw vibe64Error(
    candidate
      ? `The session database kind is not supported: ${candidate}.`
      : "The session has no canonical database-tool connection.",
    candidate
      ? "vibe64_session_database_client_unsupported"
      : "vibe64_session_database_unavailable"
  );
}

function databaseNameFromUrl(connectionUrl = "") {
  if (!connectionUrl) {
    return "";
  }
  try {
    return decodeURIComponent(new URL(connectionUrl).pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

function safeConnectionUrl(connectionUrl = "", engine = "") {
  if (!connectionUrl || engine !== "mysql") {
    return connectionUrl;
  }
  const parsed = new URL(connectionUrl);
  parsed.searchParams.delete("multipleStatements");
  return parsed.toString();
}

function structuredConnection(endpoint = {}, engine = "") {
  const host = text(endpoint.host);
  const database = text(endpoint.database);
  const user = text(endpoint.username);
  const password = String(endpoint.password ?? "");
  const port = Number(endpoint.port);
  if (!host || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw vibe64Error(
      "The session database configuration is incomplete.",
      "vibe64_session_database_configuration_incomplete"
    );
  }
  return {
    database,
    host,
    password,
    port,
    user,
    ...(engine === "mysql"
      ? {
          bigNumberStrings: true,
          dateStrings: true,
          multipleStatements: false,
          supportBigNumbers: true
        }
      : {})
  };
}

function resolveDatabaseConnection(endpoint = {}) {
  const dialect = normalizedDatabaseClient(endpoint.kind);
  const connectionUrl = text(endpoint.url);
  if (connectionUrl) {
    const expectedProtocols = dialect.engine === "mysql"
      ? ["maria", "mariadb", "mysql"]
      : ["postgres", "postgresql"];
    const protocol = urlProtocol(connectionUrl);
    if (!expectedProtocols.includes(protocol) || Object.keys(endpoint).some((name) => !["kind", "url"].includes(name))) {
      throw vibe64Error(
        "The canonical database-tool URL does not match its declared database kind.",
        "vibe64_session_database_url_kind_mismatch"
      );
    }
  } else if (Object.keys(endpoint).some((name) => ![
    "database",
    "host",
    "kind",
    "password",
    "port",
    "username"
  ].includes(name))) {
    throw vibe64Error(
      "The canonical database-tool connection contains unsupported fields.",
      "vibe64_session_database_connection_invalid"
    );
  }
  const name = connectionUrl
    ? databaseNameFromUrl(connectionUrl)
    : text(endpoint.database);
  if (!name) {
    throw vibe64Error(
      "The session database name is missing.",
      "vibe64_session_database_name_missing"
    );
  }
  return Object.freeze({
    ...dialect,
    connection: connectionUrl
      ? safeConnectionUrl(connectionUrl, dialect.engine)
      : structuredConnection(endpoint, dialect.engine),
    database: name
  });
}

function createSessionKnex(connection = {}) {
  return knexFactory({
    acquireConnectionTimeout: DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
    client: connection.client,
    connection: connection.connection,
    pool: {
      idleTimeoutMillis: 10_000,
      max: DATABASE_POOL_MAX,
      min: 0
    }
  });
}

async function withSessionKnex(endpoint = {}, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("withSessionKnex requires an operation.");
  }
  const connection = resolveDatabaseConnection(endpoint);
  const knex = createSessionKnex(connection);
  try {
    return await operation({
      connection,
      knex
    });
  } finally {
    await knex.destroy();
  }
}

export {
  DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
  DATABASE_POOL_MAX,
  createSessionKnex,
  resolveDatabaseConnection,
  safeConnectionUrl,
  withSessionKnex
};
