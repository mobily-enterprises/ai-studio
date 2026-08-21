function agentEnvWrapperSource({
  contractVersion = "1"
} = {}) {
  return `#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import process from "node:process";

const commandName = path.basename(process.argv[1] || "");
const contractVersion = ${JSON.stringify(String(contractVersion || "1"))};
const socketPath = String(process.env.VIBE64_AGENT_ENV_COMMAND_SOCKET || "").trim();
const sessionId = String(process.env.VIBE64_AGENT_ENV_COMMAND_SESSION_ID || "").trim();
const token = String(process.env.VIBE64_AGENT_ENV_COMMAND_TOKEN || "").trim();
const activeContractVersion = String(process.env.VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION || "").trim();

function fail(message, code = 1) {
  process.stderr.write(String(message || "Vibe64 Env command failed.") + "\\n");
  process.exit(code);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestSocket(body) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path: "/agent-env-command/run",
      socketPath
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => resolve(text));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

function parsedResponse(responseText = "") {
  try {
    return JSON.parse(responseText || "{}");
  } catch {
    throw new Error("Vibe64 Env command returned invalid JSON.");
  }
}

function writePayload(payload = {}) {
  if (payload.stdout) {
    process.stdout.write(String(payload.stdout));
    if (!String(payload.stdout).endsWith("\\n")) {
      process.stdout.write("\\n");
    }
  }
  if (payload.stderr) {
    process.stderr.write(String(payload.stderr));
    if (!String(payload.stderr).endsWith("\\n")) {
      process.stderr.write("\\n");
    }
  } else if (payload.ok === false && payload.error) {
    process.stderr.write(String(payload.error) + "\\n");
  }
}

if (commandName !== "vibe64-env") {
  fail("Vibe64 Env command wrapper was invoked with an unsupported command.");
}
if (!socketPath || !sessionId || !token) {
  fail("Vibe64 Env command identity is not available for this session.");
}
if (activeContractVersion !== contractVersion) {
  fail("Vibe64 Env command contract does not match this session.");
}

const args = process.argv.slice(2);
const command = args.find((arg) => !String(arg || "").startsWith("-")) || "";
const stdin = command === "set" ? await readStdin() : "";
const response = await requestSocket({
  args,
  sessionId,
  stdin,
  token
}).catch((error) => {
  fail(error?.message || error);
});
const payload = parsedResponse(response);
writePayload(payload);
process.exit(Number.isInteger(payload.exitCode) ? payload.exitCode : (payload.ok === false ? 1 : 0));
`;
}

export {
  agentEnvWrapperSource
};
