# Roo CLI Refactor Plan (Direct File Access Approach)

**Goal:** Transform `roo-cli` into a persistent, mode-aware CLI (`roo`) that interacts directly with the VS Code extension's state files, deprecating the bridge approach.

**Key Decisions:**

- **Communication:** Use direct file access to read/write VS Code extension state (API config, task history) instead of an HTTP bridge.
- **Extension ID:** `mayalabs.roo-code-with-cli`
- **Config Key:** `roo_cline_config_api_config` (within VS Code secrets)
- **Task History File:** `api_conversation_history.json` located in `<globalStoragePath>/tasks/<taskId>/`.
- **CLI Logic:** The CLI will simulate the core logic of the extension's `Cline.ts` class, managing its own state and interacting directly with the LLM and filesystem.

**Implementation Plan:**

1.  **Refactor `direct-config` Logic:**
    - Update all references (paths, extension ID) from `rooveterinaryinc` to `mayalabs.roo-code-with-cli`.
    - Keep the configuration key as `roo_cline_config_api_config`.
    - Remove the `commander` setup.
    - Extract the core logic into reusable functions within a new utility module (e.g., `roo-cli/src/utils/vscode-storage.ts`):
        - `findExtensionGlobalStoragePath()`: Finds the default global storage path for `mayalabs.roo-code-with-cli`.
        - `findExtensionSecretsPath()`: Finds the secrets storage path.
        - `loadProviderProfiles(secretsPath)` / `saveProviderProfiles(secretsPath, profiles)`: Load/save API config from the secrets file.
        - `getTaskDirectoryPath(globalStoragePath, taskId)`: Returns `path.join(globalStoragePath, "tasks", taskId)`.
        - `getApiHistoryPath(taskDirectoryPath)`: Returns `path.join(taskDirectoryPath, "api_conversation_history.json")`.
        - `readApiHistory(historyPath)` / `writeApiHistory(historyPath, history)`: Read/write the task's API history file.
2.  **Refactor `cli.ts`:**
    - Use `yargs` to define the main `roo` command and the `config` subcommand with its own subcommands (`list`, `save`, `load`, `delete`, `assign-mode`, `get-mode`).
    - The `config` subcommand handlers will import and use the refactored functions from `vscode-storage.ts`.
    - The default behavior for `roo` (no subcommand) will be to initialize and start the REPL.
3.  **Refactor `repl.ts`:**
    - Maintain state locally for `currentTaskId` and `currentMode`. (Consider storing `currentTaskId` in a simple CLI config file like `~/.config/roo/cli-state.json` for persistence between sessions).
    - Implement command parsing:
        - `/new`: Generate a new UUID, update `currentTaskId`, inform the agent to start fresh.
        - `/ask`, `/code`, `/architect`, `/debug`: Update `currentMode`.
        - Other text: Treat as the task/prompt for the current mode and task ID.
    - Pass the user's input, `currentMode`, and `currentTaskId` to the agent.
4.  **Refactor `agent.ts` (CLI Agent):**
    - This agent will simulate the core loop of the extension's `Cline.ts`.
    - **On command:**
        - Use `vscode-storage.ts` functions to get the task directory path for the `currentTaskId`.
        - Load the API history from `api_conversation_history.json`.
        - Load the appropriate API configuration using `loadProviderProfiles`.
        - Construct the system prompt based on `currentMode`.
        - Call the LLM API directly with the history and prompt.
        - Parse the LLM response for text and tool usage syntax.
        - **Tool Simulation:**
            - If a tool is requested, attempt to execute a CLI-equivalent using Node.js APIs (e.g., `fs.readFile` for `read_file`, `glob` for `list_files`).
            - For tools requiring VS Code APIs (`apply_diff`, `execute_command`, `browser_action`, etc.), return a formatted error message indicating the tool is unavailable in the standalone CLI.
        - Append the user message, simulated tool results (or errors), and the assistant's text response to the loaded history.
        - Save the updated history back to `api_conversation_history.json`.
        - Format the assistant's text and any tool results/errors for display in the REPL.

**Diagram:**

```mermaid
graph TD
    subgraph CLI Process
        A[roo] --> B{Subcommand?};
        B -- Yes --> C{config?};
        B -- No --> D[Start REPL (repl.ts)];
        C -- Yes --> E[Execute Config Subcommand];
        E --> F[Call vscode-storage.ts functions];
        F --> G[Read/Write VS Code Config Files];

        D --> H[REPL Loop (manages taskId, mode)];
        H -- User Input --> I[Parse Input (/mode, /new, text)];
        I --> J[Agent (agent.ts)];

        subgraph Agent Logic (agent.ts)
            J --> K[Get Task Dir (vscode-storage.ts)];
            K --> L[Read History (vscode-storage.ts)];
            L --> M[Build Prompt (mode, history, input)];
            M --> N[Call LLM API (using API config from vscode-storage.ts)];
            N --> O[Parse LLM Response (text, tool_use)];
            O -- Tool Use --> P{Simulate Tool?};
            P -- Yes (fs, glob) --> Q[Execute Node.js Tool];
            P -- No (VSCode API needed) --> R[Generate Tool Error];
            Q --> S[Format Tool Result];
            R --> S;
            O -- Text --> T[Format Text Result];
            S --> U[Append to History];
            T --> U;
            U --> V[Write History (vscode-storage.ts)];
            V --> W[Format Output for REPL];
        end
        W --> H;
    end

    subgraph Filesystem (Extension Storage)
        G -.- G1[VS Code Secrets File (API Config)];
        K -.- K1[Task Directory];
        L -- Reads --> L1[api_conversation_history.json];
        V -- Writes --> L1;
    end

    style K1 fill:#ccf,stroke:#333,stroke-width:1px
    style G1 fill:#ffc,stroke:#333,stroke-width:1px
```
