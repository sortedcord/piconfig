# ask-user Extension

A Pi extension that provides the `ask_user` tool and `/ask` slash command, allowing the agent to ask the user a question at any time with option selection or free-form text answers.

## Features

- **Option Select**: The agent provides a list of choices (strings or `{ label, value, description }` objects) for the user to pick from using arrow keys and Enter.
- **Custom Answer in Options**: Automatically includes an `Other (type custom answer)...` option when options are provided. If chosen, opens a text prompt for custom input, returning to the options list if the user cancels.
- **Free-Form Text Answer**: When no options are provided (or when `type: "text"` or `type: "editor"` is specified), prompts the user for single-line or multi-line text input.
- **Yes / No Confirmation**: Supports `type: "confirm"` for quick binary confirmations.
- **Interactive & RPC Support**: Uses Pi's native UI dialogs (`ctx.ui.select`, `ctx.ui.input`, `ctx.ui.editor`, `ctx.ui.confirm`), supporting both interactive TUI and headless JSON-RPC mode.
- **Clean Transcript Rendering**: Formats tool calls and answers nicely in the conversation transcript with status tags.
- **Slash Command**: `/ask [question]` command for manual testing and questions directly from the user prompt.

## Tool Definition: `ask_user`

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `question` | `string` | Yes | The question or prompt to present to the user. |
| `options` | `Array<string \| { label, value?, description? }>` | No | Choices for multiple choice selection. If omitted, prompts for text answer. |
| `allow_custom` | `boolean` | No | When options are provided, whether to include `Other (type custom answer)...` (default: `true`). |
| `multiline` | `boolean` | No | Whether to open a multi-line editor for text answers (default: `false`). |
| `placeholder` | `string` | No | Placeholder or prefill text for text inputs. |
| `type` | `"select" \| "text" \| "editor" \| "confirm"` | No | Explicit interaction mode (inferred if omitted). |

### Output

- `answer`: The selected option value or typed text (or `null` if cancelled).
- `cancelled`: `true` if the user cancelled without answering.
- `was_custom`: `true` if the user typed custom text.
- `selected_option`: The label of the selected option if chosen from the list.
- `confirmed`: Boolean result if in `confirm` mode.

## Testing

Run unit tests with:

```bash
node --input-type=module -e "
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jiti = require('/home/sortedcord/.pi/agent/install/releases/1.1.0/node_modules/jiti')('/home/sortedcord/.pi/agent/extensions/ask-user', {
  alias: {
    '@earendil-works/pi-coding-agent': '/home/sortedcord/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js',
    '@earendil-works/pi-tui': '/home/sortedcord/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-tui/dist/index.js',
    'typebox': '/home/sortedcord/.pi/agent/install/releases/1.1.0/node_modules/typebox/build/index.mjs',
  }
});
await jiti.import('./index.test.ts');
"
```
