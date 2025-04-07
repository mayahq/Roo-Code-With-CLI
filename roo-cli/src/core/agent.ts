// Core Agent logic for Roo CLI

import { callLlmApi } from "./llm-api.js" // Import LLM API function
// import { executeTool } from './tool-executor.js'; // Import tool executor
import chalk from "chalk" // Import chalk
import fs from "fs/promises"
import path from "path"

// Define the structure for the agent's response
interface AgentResponse {
	outputMarkdown: string // Formatted output for the user
	// Add other potential response fields, e.g., status, errors
}

// Define the structure for tool execution requests (if needed)
interface ToolRequest {
	toolName: string
	args: any
}

// Define a basic structure for conversation history messages
interface ChatMessage {
	role: "user" | "assistant"
	content: string
}

export class Agent {
	private conversationHistory: ChatMessage[] = [] // Use defined ChatMessage type
	private skipConfirmation: boolean

	constructor(options: { skipConfirmation?: boolean } = {}) {
		this.skipConfirmation = options.skipConfirmation ?? false
	}

	/**
	 * Processes a command received from the REPL.
	 * Orchestrates interaction with LLM and tools.
	 * @param command The parsed command (e.g., 'code', 'ask').
	 * @param task The user's task description.
	 * @param filePaths Absolute paths to mentioned files.
	 * @returns A promise resolving to the agent's formatted response.
	 */
	async processCommand(command: string | null, task: string, filePaths: string[]): Promise<AgentResponse> {
		console.log(`Agent processing command: ${command || "none"}, Task: ${task}, Files: ${filePaths.join(", ")}`)

		// 1. Read file contents if paths are provided
		let fileContents = ""
		if (filePaths.length > 0) {
			try {
				const contents = await Promise.all(
					filePaths.map(async (filePath) => {
						const content = await fs.readFile(filePath, "utf-8")
						// Add file path marker for clarity in the prompt
						return `--- START FILE: ${path.relative(process.cwd(), filePath)} ---\n${content}\n--- END FILE: ${path.relative(process.cwd(), filePath)} ---`
					}),
				)
				fileContents = contents.join("\n\n")
			} catch (error) {
				console.error(chalk.red(`Error reading file contents: ${error}`))
				return { outputMarkdown: `Error: Could not read file contents. ${error}` }
			}
		}

		// 2. Construct prompt for LLM
		// TODO: Refine prompt structure based on command and context
		// Include system message/role definition if needed
		const userPrompt = `Command: ${command || "User Query"}\nTask: ${task}\n\n${fileContents ? `Relevant File Contents:\n${fileContents}` : ""}`
		console.log("--- User Prompt for LLM ---")
		console.log(userPrompt)
		console.log("---------------------------")

		// 3. Call LLM API
		let llmResponse: string
		try {
			llmResponse = await callLlmApi(userPrompt, this.conversationHistory)
		} catch (error) {
			return { outputMarkdown: `Error communicating with LLM: ${error}` }
		}

		// 4. Update conversation history
		this.conversationHistory.push({ role: "user", content: userPrompt })
		this.conversationHistory.push({ role: "assistant", content: llmResponse })
		// TODO: Implement history truncation/management if needed

		// 5. Parse LLM response for tool usage (Placeholder)
		// TODO: Implement logic to detect tool requests (e.g., apply diff)

		// 6. Execute tools if needed (Placeholder)
		// if (toolRequest) {
		//   if (!this.skipConfirmation) {
		//     // TODO: Request confirmation from REPL
		//   }
		//   const toolResult = await executeTool(toolRequest.toolName, toolRequest.args);
		//   // TODO: Potentially send toolResult back to LLM for final response
		// }

		// 7. Format final output
		const outputMarkdown = `**Roo:**\n${llmResponse}` // Basic formatting

		return { outputMarkdown }
	}
}
