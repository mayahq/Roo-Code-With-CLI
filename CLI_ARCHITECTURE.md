# Roo CLI Architecture Plan

This document outlines the proposed architecture for the `roo-cli`, a command-line interface for interacting with the Roo agent.

## Requirements Summary

1.  **Interaction:** REPL-style interface (`roo` command starts a session).
2.  **Commands:** Use slash commands like `/code` and `/ask`.
3.  **Context:** Parse `@filepath` mentions relative to the current working directory where `roo` was launched.
4.  **Confirmation:** Default to interactive Y/N prompts for potentially destructive actions (like file changes), but allow a `--yes` flag passed at the start (`roo --yes`) to bypass these prompts.
5.  **Output:** Use Markdown formatting with syntax highlighting for code and diffs.
6.  **Configuration:** Store settings (API keys, model preferences) in `~/.config/roo/config.json`.
7.  **History/Checkpoints:** Deferring session history persistence and checkpoint functionality for the initial version.

## Proposed Architecture

The CLI will be structured into several key components:

1.  **`main.ts` / `cli.ts`:**

    - **Responsibility:** Entry point of the application.
    - **Details:**
        - Uses a library like `yargs` or `commander` to parse command-line arguments (e.g., `--yes`, `--version`, `--help`).
        - Initializes the configuration loader (`config.ts`).
        - Starts the REPL loop (`repl.ts`).
        - Handles global error handling and exit codes.

2.  **`repl.ts`:**

    - **Responsibility:** Manages the interactive Read-Eval-Print Loop.
    - **Details:**
        - Uses a library like `inquirer` or Node.js `readline` for user input.
        - Displays the prompt (e.g., `>`).
        - Parses user input to identify commands (`/code`, `/ask`, potentially `/help`, `/exit`).
        - Extracts the task description and `@filepath` mentions.
        - Resolves `@filepath` mentions to absolute paths based on the current working directory (`process.cwd()`).
        - Instantiates and interacts with the `Agent` class (`agent.ts`), passing the parsed command, task, and context (file paths).
        - Receives structured output (Markdown, code blocks, diffs) from the `Agent`.
        - Uses libraries like `marked` and a syntax highlighter (`chalk`, `highlight.js`, `prismjs`, or `shiki`) to render the output correctly in the terminal.
        - Handles the interactive confirmation prompts based on the `Agent`'s requests and the `--yes` flag.
        - Manages the conversation history _for the current session_.

3.  **`config.ts`:**

    - **Responsibility:** Loading, validating, and providing access to configuration.
    - **Details:**
        - Defines the expected structure of the configuration file (`~/.config/roo/config.json`).
        - Reads and parses the JSON configuration file.
        - Provides functions to access specific settings (e.g., `getApiKey()`, `getModel()`).
        - Handles potential errors like missing file or invalid JSON.
        - Could include logic for creating a default config file if one doesn't exist.

4.  **`agent.ts`:** (Refactored from `vscode-extension/src/agent/cline.ts`)

    - **Responsibility:** Core agent logic, orchestrating the interaction with the LLM and tools.
    - **Details:**
        - Receives user commands, task descriptions, and resolved file paths from `repl.ts`.
        - Constructs prompts for the LLM, incorporating context (like file contents read via `fs`).
        - Interacts with the LLM API via `llm-api.ts`.
        - Parses LLM responses to identify text, code blocks, and tool execution plans.
        - Manages the execution flow, calling `tool-executor.ts` when necessary.
        - Requests confirmation from `repl.ts` before executing potentially destructive tool actions.
        - Formats the final output (text, code, diffs) in Markdown for `repl.ts`.
        - Manages the internal conversation state required for multi-turn interactions with the LLM.
        - **Key Changes from `Cline.ts`:** Remove all `vscode` dependencies. Replace UI interactions with function calls/returns. Accept context explicitly.

5.  **`llm-api.ts`:**

    - **Responsibility:** Abstracting communication with the specific LLM backend.
    - **Details:**
        - Takes the formatted prompt from `agent.ts`.
        - Uses the API key from `config.ts`.
        - Makes the actual HTTP request to the LLM API.
        - Handles potential API errors (rate limits, authentication issues).
        - Returns the raw LLM response to `agent.ts`.

6.  **`tool-executor.ts`:**

    - **Responsibility:** Executing tools based on the LLM's plan.
    - **Details:**
        - Receives tool execution requests from `agent.ts`.
        - Imports and calls the refactored tool functions from the `tools/` directory.
        - Uses standard Node.js modules (`fs` for file operations, `child_process` or libraries like `execa` for running shell commands) instead of VS Code APIs.
        - Returns the results of tool execution (e.g., file content, command output, diff patches) back to `agent.ts`.

7.  **`tools/` directory:**
    - **Responsibility:** Contains individual, self-contained tool implementations.
    - **Details:**
        - Each tool (e.g., `readFileTool.ts`, `executeCommandTool.ts`, `applyDiffTool.ts`) is refactored to be environment-agnostic.
        - They accept necessary context (like file paths, command strings, diff content) as function arguments.
        - They return structured results.
