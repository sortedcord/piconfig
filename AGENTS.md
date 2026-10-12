# Guidelines for AI Agents

## Configuration Changes
- Always commit and push to `origin main` whenever a configuration change or update is successfully made and verified.
- **Never commit secrets**: Real credentials (`auth.json`, `mcp-auth.json`, session histories, and runtime caches) must remain untracked and strictly local. Only dummy/empty templates (`auth.json.example`) may be committed.
