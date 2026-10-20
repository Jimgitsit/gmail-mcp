import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runOAuthFlow } from "./auth.js";
import { registerTools } from "./tools.js";

const args = process.argv.slice(2);

// CLI helper: --add-account [email]
if (args[0] === "--add-account") {
  const email = args[1];
  runOAuthFlow(email)
    .then((resolved) => {
      console.log(`Authorized: ${resolved}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
} else {
  const server = new McpServer({
    name: "gmail-mcp",
    version: "1.0.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });
}
