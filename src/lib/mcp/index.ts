import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";

export default defineMcp({
  name: "tropik-fresh-flow-mcp",
  title: "Tropik Fresh Flow MCP",
  version: "0.1.0",
  instructions:
    "Tools for Tropik Fresh Flow. Use `echo` to verify connectivity. Additional tools can be added to expose app data.",
  tools: [echoTool],
});
