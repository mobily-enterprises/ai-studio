import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  parseEnvText
} from "../envFiles.js";

function databaseUrlSettings(url = "") {
  try {
    const parsed = new URL(url);
    return {
      databaseName: parsed.pathname.replace(/^\/+/u, "").split("/")[0] || "",
      host: parsed.hostname || "",
      password: decodeURIComponent(parsed.password || ""),
      port: parsed.port || "",
      user: decodeURIComponent(parsed.username || "")
    };
  } catch {
    return {
      databaseName: "",
      host: "",
      password: "",
      port: "",
      user: ""
    };
  }
}

function databaseConnectionFromEnv(env = {}, {
  databaseKey = "DB_NAME",
  hostKey = "DB_HOST",
  passwordKey = "DB_PASSWORD",
  portFallback = "3306",
  portKey = "DB_PORT",
  urlKey = "DATABASE_URL",
  userKey = "DB_USER"
} = {}) {
  const fromUrl = databaseUrlSettings(env[urlKey]);
  return {
    databaseName: String(env[databaseKey] || fromUrl.databaseName || "").trim(),
    host: String(env[hostKey] || fromUrl.host || "").trim(),
    password: String(env[passwordKey] ?? fromUrl.password ?? ""),
    port: String(env[portKey] || fromUrl.port || portFallback).trim(),
    user: String(env[userKey] || fromUrl.user || "").trim()
  };
}

function loopbackDatabaseHost(host = "") {
  const normalized = String(host || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function formatDatabaseEndpoint(database = {}) {
  return `${database.host || "(missing host)"}:${database.port || "(missing port)"}`;
}

function databaseHostFromEnvText(text = "", options = {}) {
  return databaseConnectionFromEnv(parseEnvText(text), options).host;
}

async function readDatabaseHostFromEnvFile(root = "", {
  relativePath = ".env",
  ...connectionOptions
} = {}) {
  try {
    return databaseHostFromEnvText(await readFile(path.join(root, relativePath), "utf8"), connectionOptions);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export {
  databaseConnectionFromEnv,
  databaseHostFromEnvText,
  databaseUrlSettings,
  formatDatabaseEndpoint,
  loopbackDatabaseHost,
  readDatabaseHostFromEnvFile
};
