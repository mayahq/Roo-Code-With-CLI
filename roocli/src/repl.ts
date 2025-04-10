import prompts from "prompts"
import * as readline from "readline"
import { display } from "./display"
import { IpcClient } from "./ipcClient"

/**
 * REPL (Read-Eval-Print-Loop) class for interactive chat mode.
 */
export class Repl {
	private rl: readline.Interface
	private ipcClient: IpcClient
	private isStreaming = false
	private currentStreamedMessage = ""
	private isExiting = false
	private currentTaskId: string | null = null
	private hasDisplayedPrefix = false // Track whether we've displayed the "Roo: " prefix
	private lastMessageId: string | null = null // Track the last message ID to avoid duplicates
	private isWaitingForUserInput = false // Track whether we're waiting for user input in response to an "ask" message

	constructor(ipcClient: IpcClient) {
		this.ipcClient = ipcClient

		// Create readline interface
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: "> ",
			historySize: 100,
		})

		// Set up event handlers
		this.setupEventHandlers()
	}

	/**
	 * Sets up event handlers for the REPL.
	 */
	private setupEventHandlers(): void {
		// Handle line input
		this.rl.on("line", (line) => {
			// Skip empty lines
			if (!line.trim()) {
				this.rl.prompt()
				return
			}

			// Handle special commands
			if (line.startsWith("/")) {
				this.handleCommand(line)
				return
			}

			// Handle regular message
			this.handleMessage(line)
		})

		// Handle CTRL+C
		this.rl.on("SIGINT", () => {
			if (this.isStreaming) {
				// If we're streaming, just stop the streaming
				display.log("\n\nInterrupted streaming.")
				this.isStreaming = false
				this.currentStreamedMessage = ""
				this.hasDisplayedPrefix = false
				this.isWaitingForUserInput = false
				this.rl.prompt()
			} else {
				// Otherwise, exit the REPL
				this.exit()
			}
		})

		// Handle IPC client messages
		this.ipcClient.on("message", async (message) => {
			await this.handleIpcMessage(message)
		})

		this.ipcClient.on("disconnected", (reason) => {
			if (!this.isExiting) {
				display.error(`Disconnected from VS Code extension: ${reason}`)
				display.info("Attempting to reconnect...")
			}
		})

		this.ipcClient.on("reconnecting", () => {
			display.info("Reconnecting to VS Code extension...")
		})

		this.ipcClient.on("connected", () => {
			display.success("Connected to VS Code extension.")
			this.rl.prompt()
		})

		this.ipcClient.on("error", (error) => {
			display.error(`Error: ${error.message}`)
		})
	}

	/**
	 * Handles a special command.
	 * @param line The command line.
	 */
	private handleCommand(line: string): void {
		const [command, ...args] = line.slice(1).split(" ")

		switch (command.toLowerCase()) {
			case "exit":
			case "quit":
			case "q":
				this.exit()
				break
			case "help":
			case "h":
				display.help()
				this.rl.prompt()
				break
			case "clear":
			case "cls":
				display.clear()
				this.rl.prompt()
				break
			case "mode":
				this.handleModeSwitch(args.join(" "))
				break
			case "new":
				// Start a new task/conversation
				this.startNewTask(args.join(" "))
				break
			case "verbose":
				// Toggle verbose mode using the Display class
				const isVerbose = display.toggleVerbose()
				display.info(`Verbose mode ${isVerbose ? "enabled" : "disabled"}.`)
				this.rl.prompt()
				break
			default:
				display.error(`Unknown command: ${command}`)
				display.info("Type /help to see available commands.")
				this.rl.prompt()
				break
		}
	}

	/**
	 * Handles a mode switch command.
	 * @param mode The mode to switch to.
	 */
	private async handleModeSwitch(mode: string): Promise<void> {
		if (!mode) {
			display.error("Please specify a mode.")
			display.info("Usage: /mode <mode>")
			this.rl.prompt()
			return
		}

		try {
			await this.ipcClient.sendMessage({
				type: "mode",
				text: mode,
			})
			display.info(`Switching to mode: ${mode}`)
		} catch (error) {
			display.error(`Failed to switch mode: ${error}`)
		}
		this.rl.prompt()
	}

	/**
	 * Handles a regular message.
	 * @param message The message to send.
	 */
	private async handleMessage(message: string): Promise<void> {
		try {
			// Display user message
			display.userMessage(message)

			// Always check if we have a current task ID
			if (this.currentTaskId) {
				// If we have a task ID, send the response
				await this.sendResponse(message)
			} else {
				// If we don't have a task ID yet, we need to create one first
				// This should only happen on the first message after starting the CLI
				display.info("Creating new session...")
				await this.startNewTask(message)
				return
			}

			// Don't prompt until we get a response
		} catch (error) {
			display.error(`Failed to send message: ${error}`)
			this.rl.prompt()
		}
	}

	/**
	 * Generates a simple hash for a message to detect duplicates
	 * @param content The message content to hash
	 * @returns A string hash of the message
	 */
	private generateMessageId(content: string): string {
		// Simple hash function for strings
		let hash = 0
		if (content.length === 0) return hash.toString()

		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash // Convert to 32bit integer
		}

		return hash.toString()
	}

	/**
	 * Checks if a message is a duplicate of the last message
	 * @param content The message content to check
	 * @returns True if the message is a duplicate, false otherwise
	 */
	private isDuplicateMessage(content: string): boolean {
		if (!content) return false

		const messageId = this.generateMessageId(content)
		const isDuplicate = messageId === this.lastMessageId

		// Update the last message ID
		this.lastMessageId = messageId

		return isDuplicate
	}

	/**
	 * Handles a message from the IPC client.
	 * @param message The message from the IPC client.
	 */
	private async handleIpcMessage(message: any): Promise<void> {
		// Debug logs are handled by the display class which checks verbose mode internally

		switch (message.type) {
			case "partialMessage":
				await this.handlePartialMessage(message)
				break
			case "state":
				this.handleStateUpdate(message)
				break
			case "action":
				this.handleAction(message)
				break
			case "taskEvent":
				this.handleTaskEvent(message)
				break
			case "taskCreated":
				// Store the task ID for this session
				if (message.taskId) {
					this.currentTaskId = message.taskId
					display.info(`Session ID set to: ${this.currentTaskId}`)

					// Register this client ID with the task ID
					const clientId = this.ipcClient.getClientId()
					if (clientId) {
						// Send a special registerClientId message to ensure the mapping is set
						// Don't await this message to avoid hanging
						this.ipcClient
							.sendMessage({
								type: "registerClientId",
								clientId: clientId,
								taskId: message.taskId,
							})
							.catch((error) => {
								// Error handled silently
							})
					}
				}
				break
			case "clientId":
				// Update the client ID if provided by the server
				if (message.clientId) {
					this.ipcClient.setClientId(message.clientId)
				}
				break
			default:
				// Ignore other message types
				break
		}
	}

	/**
	 * Handles a partial message from the IPC client.
	 * @param message The partial message.
	 */
	private async handlePartialMessage(message: any): Promise<void> {
		// Debug logs are handled by the display class which checks verbose mode internally

		// Only initialize streaming if we're not already streaming
		// This prevents resetting the state for each partial message
		if (!this.isStreaming) {
			this.isStreaming = true
			this.currentStreamedMessage = ""
			this.hasDisplayedPrefix = false
			process.stdout.write("\n")
		}

		if (message.partialMessage?.type === "say") {
			const sayType = message.partialMessage.say
			const content =
				message.partialMessage.text || message.partialMessage.content || message.partialMessage.reasoning || ""

			// Skip empty content messages
			if (content.trim() === "") {
				return
			}

			// Handle different say types
			switch (sayType) {
				case "reasoning":
					// Use the new displayReasoning method
					display.displayReasoning(content)
					this.hasDisplayedPrefix = false
					break

				case "error":
					display.error(content)
					this.hasDisplayedPrefix = false
					this.isStreaming = false
					this.rl.prompt()
					break

				case "command_output":
					// Use the new displayCommandOutput method
					display.displayCommandOutput(content)
					this.hasDisplayedPrefix = false
					break

				case "task":
				case "new_task":
					display.info(`[Task] ${content}`)
					this.hasDisplayedPrefix = false
					break

				case "checkpoint_saved":
					display.info(`[Checkpoint] ${content || "Saved"}`)
					this.hasDisplayedPrefix = false
					break

				case "browser_action":
				case "browser_action_result":
					display.info(`[Browser] ${content}`)
					this.hasDisplayedPrefix = false
					break

				case "text":
				case "ai_response":
					// Handle AI response (text) with existing streaming logic
					// Check if this is a duplicate message
					if (this.isDuplicateMessage(content)) {
						return
					}

					// If we haven't displayed the prefix yet, print the "Roo: " prefix
					if (!this.hasDisplayedPrefix) {
						process.stdout.write(chalk.bold.blue("Roo: "))
						this.hasDisplayedPrefix = true
					}

					// Calculate the new content by comparing with what we've already displayed
					let newContent = ""
					if (content.startsWith(this.currentStreamedMessage)) {
						// Normal case: new content is appended
						newContent = content.slice(this.currentStreamedMessage.length)
					} else if (this.currentStreamedMessage.startsWith(content)) {
						// Content is a subset of what we already have - ignore
						return
					} else {
						// Handle case where content might be completely different
						newContent = content
						// Clear line and reprint if needed
						if (this.currentStreamedMessage.length > 0) {
							// Don't add another "Roo: " prefix, we already have one
							process.stdout.write("\r\n")
							// Only print the prefix if we haven't already
							if (!this.hasDisplayedPrefix) {
								process.stdout.write(chalk.bold.blue("Roo: "))
								this.hasDisplayedPrefix = true
							}
						}
					}

					// Only print if there's new content
					if (newContent.length > 0) {
						process.stdout.write(newContent)
						// Update the current streamed message
						this.currentStreamedMessage = content
					}
					break

				default:
					// Handle all other say types
					display.info(`[${sayType}] ${content}`)
					this.hasDisplayedPrefix = false
					break
			}
		} else if (message.partialMessage?.type === "ask") {
			// Instead of handling ask types here, call the new handleInteractiveAsk method
			await this.handleInteractiveAsk(message.partialMessage)
		}
	}

	/**
	 * Handles interactive ask messages with prompts.
	 * @param askMessage The ask message to handle.
	 */
	private async handleInteractiveAsk(askMessage: any): Promise<void> {
		// Pause readline to avoid interference with prompts
		this.rl.pause()

		try {
			let responseValue: string | undefined

			switch (askMessage.ask) {
				case "followup":
					// Parse question and suggestions
					const question = askMessage.text || "Please select an option:"
					const suggestions = askMessage.suggestions || []

					// Create choices for prompts
					const choices = [
						...suggestions.map((suggestion: string) => ({ title: suggestion, value: suggestion })),
						{ title: "(Provide custom response)", value: "__CUSTOM__" },
					]

					// Show selection prompt
					const response = await prompts({
						type: "select",
						name: "value",
						message: question,
						choices: choices,
					})

					// Handle custom response
					if (response.value === "__CUSTOM__") {
						const customResponse = await prompts({
							type: "text",
							name: "value",
							message: "Your custom response:",
						})
						responseValue = customResponse.value
					} else {
						responseValue = response.value
					}
					break

				case "command":
				case "tool":
				case "browser_action_launch":
					// Display the text
					display.info(`\n${askMessage.text || ""}`)

					// Show approval prompt
					const approvalResponse = await prompts({
						type: "select",
						name: "value",
						message: "Do you want to approve this action?",
						choices: [
							{ title: "Approve", value: "approve" },
							{ title: "Reject", value: "reject" },
							{ title: "(Provide custom response)", value: "__CUSTOM__" },
						],
					})

					// Handle custom response
					if (approvalResponse.value === "__CUSTOM__") {
						const customResponse = await prompts({
							type: "text",
							name: "value",
							message: "Your custom response:",
						})
						responseValue = customResponse.value
					} else {
						responseValue = approvalResponse.value
					}
					break

				default:
					// Display the text
					display.info(`\n${askMessage.text || ""}`)

					// Show text input prompt
					const textResponse = await prompts({
						type: "text",
						name: "value",
						message: "Your response:",
					})
					responseValue = textResponse.value
					break
			}

			// Handle cancellation
			if (responseValue === undefined) {
				display.info("\nResponse cancelled.")
				return
			}

			// Send the response
			await this.sendResponse(responseValue)
		} catch (error) {
			display.error(`Error handling interactive prompt: ${error}`)
		} finally {
			// Reset flags
			this.isWaitingForUserInput = false

			// Resume readline
			this.rl.resume()
			this.rl.prompt()
		}
	}

	/**
	 * Handles a state update from the IPC client.
	 * @param message The state update message.
	 */
	private handleStateUpdate(message: any): void {
		// State updates don't need special handling for the CLI

		// Only end streaming if this is a final state update
		// (e.g., when the task is completed or aborted)
		if (this.isStreaming && message.state && (message.state.taskCompleted || message.state.taskAborted)) {
			this.isStreaming = false
			this.hasDisplayedPrefix = false
			this.isWaitingForUserInput = false
			process.stdout.write("\n\n")
			this.rl.prompt()
		}
	}

	/**
	 * Handles a taskEvent message from the IPC client.
	 * @param message The taskEvent message.
	 */
	private handleTaskEvent(message: any): void {
		// Check if this is a message event
		if (message.eventName === "message" && message.payload && message.payload.length > 0) {
			const messagePayload = message.payload[0]

			// If this is an AI response, format it as a partialMessage and handle it
			if (messagePayload.message && messagePayload.message.content) {
				// Skip empty messages
				if (!messagePayload.message.content.trim()) {
					return
				}

				// If we're not already streaming, start streaming
				if (!this.isStreaming) {
					this.isStreaming = true
					this.currentStreamedMessage = ""
					this.hasDisplayedPrefix = false
					process.stdout.write("\n")
				}

				const partialMessage = {
					partialMessage: {
						ts: Date.now(),
						type: "say",
						say: "text",
						text: messagePayload.message.content,
						partial: true,
					},
				}

				// Process the message
				this.handlePartialMessage(partialMessage)
			}
		}

		// End streaming if we were streaming (for certain event types)
		if (message.eventName === "taskCompleted" || message.eventName === "taskAborted") {
			if (this.isStreaming) {
				this.isStreaming = false
				this.hasDisplayedPrefix = false
				this.isWaitingForUserInput = false
				process.stdout.write("\n\n")
				this.rl.prompt()
			}
		}
	}

	/**
	 * Handles an action message from the IPC client.
	 * @param message The action message.
	 */
	private handleAction(message: any): void {
		// Action messages don't need special handling for the CLI

		// Only end streaming for specific actions that indicate completion
		// like "taskCompleted" or "taskAborted"
		if (
			this.isStreaming &&
			message.action &&
			(message.action === "taskCompleted" || message.action === "taskAborted")
		) {
			this.isStreaming = false
			this.hasDisplayedPrefix = false
			this.isWaitingForUserInput = false
			process.stdout.write("\n\n")
			this.rl.prompt()
		}
	}

	/**
	 * Sends a response to the current task.
	 * @param responseText The response text to send.
	 */
	private async sendResponse(responseText: string): Promise<void> {
		try {
			// Get client ID
			const clientId = this.ipcClient.getClientId()

			// Send message to VS Code extension with client ID and task ID
			await this.ipcClient.sendMessage({
				type: "sendMessage",
				text: responseText,
				clientId: clientId || undefined, // Get the latest client ID
				taskId: this.currentTaskId, // Always include the task ID for existing sessions
			})

			// Also send a registerClientId message to ensure the mapping is set
			if (clientId) {
				this.ipcClient
					.sendMessage({
						type: "registerClientId",
						clientId: clientId,
						taskId: this.currentTaskId,
					})
					.catch((error) => {
						display.debug(`Error registering client ID: ${error}`)
					})
			}

			// Start streaming indicator
			this.isStreaming = true
			this.currentStreamedMessage = ""
			this.hasDisplayedPrefix = false // Reset the prefix flag for a new message
			this.lastMessageId = null // Reset the last message ID
		} catch (error) {
			display.error(`Failed to send response: ${error}`)
			this.rl.prompt()
		}
	}

	/**
	 * Starts a new task with the given message.
	 * @param message The message to send.
	 */
	private async startNewTask(message: string): Promise<void> {
		try {
			// Reset task ID and flags
			this.currentTaskId = null
			this.isWaitingForUserInput = false

			// Only display user message if it's not empty
			if (message.trim()) {
				display.userMessage(message)
			}

			// Get client ID
			const clientId = this.ipcClient.getClientId()

			// Send message to VS Code extension with client ID
			// Don't await this message to avoid hanging
			this.ipcClient
				.sendMessage({
					type: "newTask",
					text: message,
					clientId: clientId || undefined, // Get the latest client ID
				})
				.catch((error) => {
					display.error(`Failed to create new task: ${error}`)
					this.rl.prompt()
					return
				})

			// Start streaming indicator if there's a message
			if (message.trim()) {
				this.isStreaming = true
				this.currentStreamedMessage = ""
				this.hasDisplayedPrefix = false // Reset the prefix flag for a new message
				this.lastMessageId = null // Reset the last message ID
			}
		} catch (error) {
			display.error(`Failed to create new task: ${error}`)
			this.rl.prompt()
		}
	}

	/**
	 * Starts the REPL.
	 */
	start(): void {
		display.welcome()

		// If we have a current task ID, display it
		if (this.currentTaskId) {
			display.info(`Current session ID: ${this.currentTaskId}`)
		} else {
			display.info("Starting new session...")
		}

		this.rl.prompt()
	}

	/**
	 * Exits the REPL.
	 */
	exit(): void {
		this.isExiting = true
		display.info("Exiting...")
		this.rl.close()
		this.ipcClient.disconnect()
		process.exit(0)
	}
}

// Import chalk here to avoid TypeScript errors
import chalk from "chalk"
