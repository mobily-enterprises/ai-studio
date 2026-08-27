import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  DATABASE_TOOL_ENVIRONMENT_CONTRACT
} from "@local/vibe64-project/server/resourceEnvironment";
import {
  databaseAssistantAvailability,
  runDatabaseAssistant
} from "./assistant.js";
import {
  resolveDatabaseConnection,
  withSessionKnex
} from "./connection.js";
import {
  searchDatabaseLookup
} from "./lookup.js";
import {
  cancelDatabaseQuery,
  deleteDatabaseRow,
  executeDatabaseQuery,
  insertDatabaseRow,
  updateDatabaseCell
} from "./queryExecutor.js";
import {
  inspectDatabaseSchema
} from "./schemaInspector.js";
import {
  deleteSnippet as deleteStoredSnippet,
  readErdLayout,
  readSchemaSnapshot,
  readWorkspace,
  recordQueryHistory,
  saveErdLayout,
  saveLookupDisplayColumn,
  saveSnippet as saveStoredSnippet,
  writeSchemaSnapshot
} from "./sessionState.js";
import {
  quoteQualifiedTable
} from "./sqlPolicy.js";

function databaseResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_database_operation_failed",
    fallbackMessage: "The session database operation failed."
  });
}

function databaseError(message, code, details = {}) {
  const error = vibe64Error(message, code);
  error.details = details;
  return error;
}

function requireOwner(vibe64User = null) {
  if (vibe64User && vibe64User.role !== "owner") {
    throw databaseError(
      "The session database tool is currently available only to the Vibe64 owner.",
      "vibe64_owner_required"
    );
  }
}

function actorId(vibe64User = null) {
  return normalizeText(
    vibe64User?.username ||
    vibe64User?.id ||
    vibe64User?.email ||
    "local-owner"
  );
}

function safeConnectionDescriptor(connection = {}, context = {}) {
  return {
    client: connection.client,
    database: connection.database,
    developmentDatabaseScope: context.developmentDatabaseScope || "",
    engine: connection.engine,
    label: connection.label,
    sourceLabel: normalizeText(context.source?.label)
  };
}

function defaultQuery(table = {}, engine = "postgresql") {
  return `SELECT *\nFROM ${quoteQualifiedTable(table, engine)};`;
}

function historyEntry(sql = "", result = {}, readOnly = true) {
  return {
    affectedRows: Number(result.affectedRows || 0),
    durationMs: Number(result.durationMs || 0),
    kind: result.kind || "",
    ok: result.ok !== false,
    readOnly,
    sql
  };
}

function auditSql(sql = "") {
  return String(sql || "").slice(0, 32 * 1024);
}

function createService({
  logger = null,
  projectService,
  terminalService = null,
  withKnex = withSessionKnex
} = {}) {
  if (
    !projectService ||
    typeof projectService.createSessionStore !== "function" ||
    typeof projectService.sessionDatabaseEnvironment !== "function"
  ) {
    throw new TypeError("createService requires the Vibe64 Project API with session database resolution.");
  }
  if (typeof withKnex !== "function") {
    throw new TypeError("createService requires a Knex session operation boundary.");
  }

  const activeQueries = new Map();

  function sessionQueries(sessionId = "") {
    const key = normalizeText(sessionId);
    if (!activeQueries.has(key)) {
      activeQueries.set(key, new Map());
    }
    return activeQueries.get(key);
  }

  function releaseSessionQueries(sessionId = "", queries) {
    const key = normalizeText(sessionId);
    if (queries?.size === 0 && activeQueries.get(key) === queries) {
      activeQueries.delete(key);
    }
  }

  async function sessionContext(input = {}) {
    requireOwner(input.vibe64User);
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      throw databaseError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const store = await projectService.createSessionStore();
    const session = await store.readSession(sessionId);
    const database = await projectService.sessionDatabaseEnvironment({
      session,
      sessionId
    });
    const toolEnvironment = database.databaseToolEnvironment;
    if (toolEnvironment?.contract !== DATABASE_TOOL_ENVIRONMENT_CONTRACT) {
      throw databaseError(
        "The selected session has no canonical database-tool connection.",
        "vibe64_session_database_unavailable"
      );
    }
    const readEndpoint = {
      kind: toolEnvironment.kind,
      ...toolEnvironment.read
    };
    const writeEndpoint = {
      kind: toolEnvironment.kind,
      ...toolEnvironment.write
    };
    const readConnection = resolveDatabaseConnection(readEndpoint);
    const writeConnection = resolveDatabaseConnection(writeEndpoint);
    return {
      ...database,
      actor: actorId(input.vibe64User),
      readConnection,
      readEndpoint,
      session,
      sessionId,
      store,
      vibe64User: input.vibe64User || null,
      writeEndpoint,
      writeConnection
    };
  }

  function logOperation(context = {}, fields = {}, level = "info") {
    logOperationalEvent(logger, level, {
      actor: context.actor,
      component: "vibe64-database-tools",
      database: context.writeConnection?.database,
      engine: context.writeConnection?.engine,
      event: "vibe64.database.operation",
      sessionId: context.sessionId,
      ...fields
    }, "Vibe64 session database operation");
  }

  async function refreshSchema(context, source = "user") {
    const startedAt = Date.now();
    try {
      const schema = await withKnex(context.readEndpoint, ({ connection, knex }) => (
        inspectDatabaseSchema({ connection, knex })
      ));
      await writeSchemaSnapshot(context.store, context.sessionId, schema);
      logOperation(context, {
        durationMs: Date.now() - startedAt,
        operation: "schema.refresh",
        source,
        status: "succeeded",
        tableCount: schema.tables.length
      });
      return schema;
    } catch (error) {
      logOperation(context, {
        code: error?.code,
        durationMs: Date.now() - startedAt,
        operation: "schema.refresh",
        source,
        status: "failed"
      }, "warn");
      throw error;
    }
  }

  async function currentSchema(context, { initialize = true } = {}) {
    const schema = await readSchemaSnapshot(context.store, context.sessionId);
    const matchesConnection = schema &&
      schema.engine === context.readConnection.engine &&
      schema.database === context.readConnection.database;
    if (matchesConnection || !initialize) {
      return schema;
    }
    return refreshSchema(
      context,
      schema ? "database-identity-changed" : "initial-missing-snapshot"
    );
  }

  function assertWriteQueryConfirmed(context, input = {}) {
    if (input.writeUnlocked !== true || input.confirmed !== true) {
      throw databaseError(
        "Unlock writes and confirm this statement before running it.",
        "vibe64_database_write_confirmation_required"
      );
    }
    if (normalizeText(input.confirmationDatabase) !== context.writeConnection.database) {
      throw databaseError(
        "The write confirmation does not match the selected session database.",
        "vibe64_database_write_target_mismatch",
        {
          database: context.writeConnection.database
        }
      );
    }
  }

  async function runMutation(input, operation, audit = {}) {
    const context = await sessionContext(input);
    const schema = await currentSchema(context);
    const startedAt = Date.now();
    try {
      const result = await withKnex(context.writeEndpoint, ({ knex }) => operation({
        context,
        knex,
        schema
      }));
      logOperation(context, {
        affectedRows: Number(result.affectedRows || 0),
        durationMs: Date.now() - startedAt,
        status: "succeeded",
        ...audit
      });
      return result;
    } catch (error) {
      logOperation(context, {
        code: error?.code,
        durationMs: Date.now() - startedAt,
        status: "failed",
        ...audit
      }, "warn");
      throw error;
    }
  }

  return Object.freeze({
    async readState(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const [layout, workspace] = await Promise.all([
          readErdLayout(context.store, context.sessionId, context.vibe64User),
          readWorkspace(context.store, context.sessionId, context.vibe64User)
        ]);
        return {
          assistant: databaseAssistantAvailability(context.session),
          connection: safeConnectionDescriptor(context.writeConnection, context),
          defaultQuery: schema.tables[0]
            ? defaultQuery(schema.tables[0], schema.engine)
            : "",
          layout,
          ok: true,
          schema,
          workspace,
          writeAccess: {
            available: true,
            confirmationDatabase: context.writeConnection.database,
            unlocked: false
          }
        };
      });
    },

    async refreshSchema(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        return {
          ok: true,
          schema: await refreshSchema(context, normalizeText(input.source) || "user")
        };
      });
    },

    async runQuery(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const readOnly = input.readOnly !== false;
        const automaticDefault = input.automatic === true && schema.tables.some((table) => (
          String(input.sql || "").trim() === defaultQuery(table, schema.engine)
        ));
        if (!readOnly) {
          assertWriteQueryConfirmed(context, input);
        }
        const startedAt = Date.now();
        const queries = sessionQueries(context.sessionId);
        try {
          const queryEnvironment = readOnly
            ? context.readEndpoint
            : context.writeEndpoint;
          const result = await withKnex(queryEnvironment, ({ connection, knex }) => (
            executeDatabaseQuery({
              activeQueries: queries,
              connection,
              knex,
              queryId: input.queryId,
              readOnly,
              schema,
              sql: input.sql
            })
          ));
          if (!automaticDefault) {
            await recordQueryHistory(
              context.store,
              context.sessionId,
              context.vibe64User,
              historyEntry(input.sql, result, readOnly)
            );
          }
          if (!automaticDefault) {
            logOperation(context, {
              affectedRows: Number(result.affectedRows || 0),
              durationMs: result.durationMs,
              operation: "query.run",
              queryId: result.queryId,
              readOnly,
              sql: auditSql(input.sql),
              status: "succeeded"
            });
          }
          return result;
        } catch (error) {
          if (!automaticDefault) {
            await recordQueryHistory(
              context.store,
              context.sessionId,
              context.vibe64User,
              historyEntry(input.sql, {
                durationMs: Date.now() - startedAt,
                kind: "error",
                ok: false
              }, readOnly)
            ).catch(() => null);
          }
          logOperation(context, {
            code: error?.code,
            durationMs: Date.now() - startedAt,
            operation: "query.run",
            queryId: normalizeText(input.queryId),
            readOnly,
            sql: auditSql(input.sql),
            status: "failed"
          }, "warn");
          throw error;
        } finally {
          releaseSessionQueries(context.sessionId, queries);
        }
      });
    },

    async cancelQuery(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const queries = sessionQueries(context.sessionId);
        const result = await cancelDatabaseQuery(queries, input.queryId);
        releaseSessionQueries(context.sessionId, queries);
        logOperation(context, {
          cancelled: result.cancelled,
          operation: "query.cancel",
          queryId: result.queryId,
          status: "succeeded"
        });
        return result;
      });
    },

    async updateCell(input = {}) {
      return databaseResult(() => runMutation(input, ({ knex, schema }) => updateDatabaseCell({
        edit: input.edit,
        knex,
        schema,
        value: input.value
      }), {
        operation: "cell.update",
        table: input.edit?.table
      }));
    },

    async insertRow(input = {}) {
      return databaseResult(() => runMutation(input, ({ knex, schema }) => insertDatabaseRow({
        knex,
        schema,
        table: input.table,
        values: input.values
      }), {
        operation: "row.insert",
        table: input.table
      }));
    },

    async deleteRow(input = {}) {
      return databaseResult(() => runMutation(input, ({ knex, schema }) => deleteDatabaseRow({
        confirmed: input.confirmed,
        key: input.key,
        knex,
        schema,
        table: input.table
      }), {
        operation: "row.delete",
        table: input.table
      }));
    },

    async searchLookup(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        const schema = await currentSchema(context);
        const preferred = normalizeText(input.displayColumn) || (
          await readWorkspace(context.store, context.sessionId, context.vibe64User)
        ).lookupDisplayColumns?.[normalizeText(input.relationshipId)] || "";
        const result = await withKnex(context.readEndpoint, ({ connection, knex }) => (
          searchDatabaseLookup({
            displayColumn: preferred,
            engine: connection.engine,
            knex,
            relationshipId: input.relationshipId,
            schema,
            search: input.search
          })
        ));
        if (normalizeText(input.displayColumn)) {
          await saveLookupDisplayColumn(
            context.store,
            context.sessionId,
            context.vibe64User,
            input.relationshipId,
            result.displayColumn
          );
        }
        return result;
      });
    },

    async saveLayout(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        return {
          layout: await saveErdLayout(
            context.store,
            context.sessionId,
            context.vibe64User,
            input.layout
          ),
          ok: true
        };
      });
    },

    async saveSnippet(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        return {
          ok: true,
          workspace: await saveStoredSnippet(
            context.store,
            context.sessionId,
            context.vibe64User,
            input.snippet
          )
        };
      });
    },

    async deleteSnippet(input = {}) {
      return databaseResult(async () => {
        const context = await sessionContext(input);
        return {
          ok: true,
          workspace: await deleteStoredSnippet(
            context.store,
            context.sessionId,
            context.vibe64User,
            input.snippetId
          )
        };
      });
    },

    async askAssistant(input = {}) {
      return databaseResult(async () => {
        if (
          typeof terminalService?.deleteDetachedAgentChatThread !== "function" ||
          typeof terminalService?.requireAssistantAccess !== "function" ||
          typeof terminalService?.runDetachedAgentChatTurn !== "function"
        ) {
          throw databaseError(
            "The selected session assistant is not available for the database copilot.",
            "vibe64_database_assistant_unavailable"
          );
        }
        const context = await sessionContext(input);
        await terminalService.requireAssistantAccess(context.sessionId, {
          session: context.session,
          vibe64User: context.vibe64User
        });
        const schema = await currentSchema(context);
        const startedAt = Date.now();
        const queries = sessionQueries(context.sessionId);
        try {
          const result = await runDatabaseAssistant({
            agentContext: {
              vibe64User: context.vibe64User
            },
            assistant: databaseAssistantAvailability(context.session),
            deleteThread: (threadInput, options) => terminalService.deleteDetachedAgentChatThread(
              context.sessionId,
              threadInput,
              options
            ),
            executeReadQuery: (sql) => withKnex(context.readEndpoint, ({ connection, knex }) => (
              executeDatabaseQuery({
                activeQueries: queries,
                connection,
                knex,
                readOnly: true,
                schema,
                sql
              })
            )),
            messages: input.messages,
            runAgentTurn: (turnInput, options) => terminalService.runDetachedAgentChatTurn(
              context.sessionId,
              turnInput,
              options
            ),
            schema
          });
          logOperation(context, {
            durationMs: Date.now() - startedAt,
            model: result.model,
            operation: "assistant.ask",
            queryCount: result.queries.length,
            status: "succeeded"
          });
          return result;
        } catch (error) {
          logOperation(context, {
            code: error?.code,
            durationMs: Date.now() - startedAt,
            operation: "assistant.ask",
            status: "failed"
          }, "warn");
          throw error;
        } finally {
          releaseSessionQueries(context.sessionId, queries);
        }
      });
    },

    async close() {
      const queries = [...activeQueries.values()].flatMap((session) => [...session.values()]);
      await Promise.allSettled(queries.map((query) => query.cancel()));
      activeQueries.clear();
    }
  });
}

export {
  createService,
  defaultQuery,
  requireOwner
};
