import prompts from "prompts"
import * as readline from "readline"
import { display } from "./display"
import { IpcClient } from "./ipcClient"

/**
 * REPL (Read-Eval-Print-Loop) class for interactive chat mode.
 */
export class Repl {
	// Static property to track if we've created the initial session
	private static hasCreatedInitialSession = false

	private rl: readline.Interface
	private ipcClient: IpcClient
	private isStreaming = false
	private currentStreamedMessage = ""
	private isExiting = false
	private currentTaskId: string | null = null
	private hasDisplayedPrefix = false // Track whether we've displayed the "Roo: " prefix
	private lastMessageId: string | null = null // Track the last message ID to avoid duplicates
	private lastAskMessageId: string | null = null // Track the last ask message ID to avoid duplicates
	private isWaitingForUserInput = false // Track whether we're waiting for user input in response to an "ask" message

	constructor(ipcClient: IpcClient) {
		this.ipcClient = ipcClient

		// Enable keypress events on stdin
		readline.emitKeypressEvents(process.stdin)
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true)
		}

		// Create readline interface
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: "> ",
			historySize: 100,
		})

		// Increase max listeners to prevent memory leak warnings
		process.stdin.setMaxListeners(20)

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

		// Handle keyboard shortcuts
		process.stdin.on("keypress", (str, key) => {
			// Handle CTRL+SHIFT+C (cancel current operation)
			if (key && key.ctrl && key.shift && key.name === "c") {
				if (this.isWaitingForUserInput) {
					// If we're waiting for user input, send a cancellation response
					display.info("\nOperation cancelled by user (Ctrl+Shift+C)")
					this.sendCancellationResponse().catch((error) => {
						display.error(`Failed to send cancellation: ${error}`)
					})
				} else if (this.isStreaming) {
					// If we're streaming, just stop the streaming
					display.log("\n\nInterrupted streaming (Ctrl+Shift+C).")
					this.isStreaming = false
					this.currentStreamedMessage = ""
					this.hasDisplayedPrefix = false
					this.rl.prompt()
				}
			}
		})

		// Handle CTRL+C (exit CLI)
		this.rl.on("SIGINT", () => {
			if (this.isStreaming) {
				// If we're streaming, just stop the streaming
				display.log("\n\nInterrupted streaming (Ctrl+C).")
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
			// Create the message object with taskId
			const messageObj = {
				type: "mode",
				text: mode,
				taskId: this.currentTaskId, // Include the current task ID
			}

			// Log the message for debugging
			display.debug(`Sending mode switch message: ${JSON.stringify(messageObj)}`)

			// Send the message
			await this.ipcClient.sendMessage(messageObj)
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

			// Check if we have a current task ID
			if (this.currentTaskId) {
				// If we have a task ID, send the response
				await this.sendResponse(message)
			} else {
				// If we don't have a task ID yet, we need to create one first
				// This should only happen on the first message after starting the CLI
				// or when explicitly requested with /new

				// Check if this is the first message after starting the CLI
				// We'll use a static flag to track this
				if (!Repl.hasCreatedInitialSession) {
					display.info("Creating new session...")
					Repl.hasCreatedInitialSession = true
					await this.startNewTask(message)
					return
				} else {
					// If we've already created an initial session, but lost the task ID somehow,
					// inform the user they need to use /new
					display.error("Session ID not found. Please use /new to start a new session.")
					this.rl.prompt()
					return
				}
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

					// Log the task ID for debugging
					display.debug(`Task ID set to: ${this.currentTaskId} (from taskCreated message)`)

					// Register this client ID with the task ID
					const clientId = this.ipcClient.getClientId()
					if (clientId) {
						// Send a special registerClientId message to ensure the mapping is set
						display.debug(`Registering client ID ${clientId} with task ID ${message.taskId}`)

						// Use await to ensure the registration completes
						try {
							await this.ipcClient.sendMessage({
								type: "registerClientId",
								clientId: clientId,
								taskId: message.taskId,
							})
							display.debug(`Successfully registered client ID with task ID`)
						} catch (error) {
							display.error(`Failed to register client ID: ${error}`)
						}
					} else {
						display.warn(`No client ID available to register with task ID ${message.taskId}`)
					}
				} else {
					display.warn("Received taskCreated message without a taskId")
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

		// Check if this is a partial message that should be streamed (only text/ai_response)
		const isStreamableType =
			message.partialMessage?.type === "say" &&
			(message.partialMessage.say === "text" ||
				message.partialMessage.say === "ai_response" ||
				message.partialMessage.say === "completion_result")

		// Only initialize streaming for streamable types
		if (isStreamableType && !this.isStreaming) {
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

			// Check if this is a complete message (not partial) or a streamable type
			const isComplete = !message.partialMessage.partial

			// For non-streamable types, only process complete messages
			// For streamable types, process all messages
			if (isComplete || isStreamableType) {
				// Handle different say types
				switch (sayType) {
					case "reasoning":
						// Only display reasoning when it's complete
						if (isComplete) {
							display.displayReasoning(content)
							this.hasDisplayedPrefix = false
						}
						break

					case "error":
						display.error(content)
						this.hasDisplayedPrefix = false
						this.isStreaming = false
						this.rl.prompt()
						break

					case "command_output":
						// Only display command output when it's complete
						if (isComplete) {
							display.displayCommandOutput(content)
							this.hasDisplayedPrefix = false
						}
						break

					case "task":
					case "new_task":
						// Only display task messages when they're complete
						if (isComplete) {
							display.info(`[Task] ${content}`)
							this.hasDisplayedPrefix = false
						}
						break

					case "checkpoint_saved":
						// Only display checkpoint messages when they're complete
						if (isComplete) {
							display.info(`[Checkpoint] ${content || "Saved"}`)
							this.hasDisplayedPrefix = false
						}
						break

					case "browser_action":
					case "browser_action_result":
						// Only display browser action messages when they're complete
						if (isComplete) {
							display.info(`[Browser] ${content}`)
							this.hasDisplayedPrefix = false
						}
						break

					case "completion_result":
						// Always stream completion results
						this.handleStreamedContent(content)
						break

					case "text":
					case "ai_response":
						// Always stream text/ai_response
						this.handleStreamedContent(content)
						break

					default:
						// Only display other message types when they're complete
						if (isComplete) {
							display.info(`[${sayType}] ${content}`)
							this.hasDisplayedPrefix = false
						}
						break
				}
			}
		} else if (message.partialMessage?.type === "ask") {
			// Only process ask messages when they're complete
			if (!message.partialMessage.partial) {
				// Instead of handling ask types here, call the new handleInteractiveAsk method
				await this.handleInteractiveAsk(message.partialMessage)
			} else {
				display.debug("Skipping partial ask message")
			}
		}
	}

	/**
	 * Handles streamed content display for text, ai_response, and completion_result
	 * @param content The content to display
	 */
	private handleStreamedContent(content: string): void {
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
	}

	/**
	 * Handles interactive ask messages with prompts.
	 * @param askMessage The ask message to handle.
	 */
	/**
	 * Extracts tool and path information from a tool message
	 * @param text The tool message text
	 * @returns An object with tool and path properties
	 */
	private extractToolInfo(text: string): { tool: string; path: string } {
		// Default values
		let tool = "tool"
		let path = ""

		// Try to parse JSON from the text
		try {
			// Look for JSON-like content in the message
			const jsonMatch = text.match(/\{.*\}/s)
			if (jsonMatch) {
				const jsonContent = JSON.parse(jsonMatch[0])
				tool = jsonContent.tool || "tool"
				path = jsonContent.path || ""
			}
		} catch (error) {
			// If parsing fails, use default values
			display.debug(`Failed to parse tool info: ${error}`)
		}

		return { tool, path }
	}

	/**
	 * Checks if an ask message is a duplicate
	 * @param askMessage The ask message to check
	 * @returns True if the message is a duplicate, false otherwise
	 */
	private isDuplicateAskMessage(askMessage: any): boolean {
		if (!askMessage) return false

		// Generate a message ID based on the ask type and text
		const askType = askMessage.ask || ""
		const text = askMessage.text || ""
		const messageId = this.generateMessageId(`${askType}:${text}`)

		// Check if this is a duplicate
		const isDuplicate = messageId === this.lastAskMessageId

		// Update the last ask message ID
		this.lastAskMessageId = messageId

		return isDuplicate
	}

	/**
	 * Handles interactive ask messages with prompts.
	 * @param askMessage The ask message to handle.
	 */
	private async handleInteractiveAsk(askMessage: any): Promise<void> {
		// Check for duplicate ask messages
		if (this.isDuplicateAskMessage(askMessage)) {
			return
		}

		// Store current state of stdin listeners
		const currentListenerCount = process.stdin.listenerCount("data")
		display.debug(`Current stdin listener count before prompt: ${currentListenerCount}`)

		// Set flag to indicate we're waiting for user input
		this.isWaitingForUserInput = true

		// Pause readline to avoid interference with prompts
		this.rl.pause()

		try {
			let responseValue: string | undefined

			// Display the appropriate prompt based on ask type
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

					// Show selection prompt with prompts library
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
					} else if (response.value === undefined) {
						// Handle cancellation
						responseValue = undefined
					} else {
						responseValue = response.value
					}
					break

				case "command":
				case "tool":
				case "browser_action_launch":
					// For tool messages, extract tool and path info and display in a collapsible box
					if (askMessage.ask === "tool") {
						const { tool, path } = this.extractToolInfo(askMessage.text || "")
						display.displayToolUse(tool, path, askMessage.text || "")
					} else {
						// For other types, display as before
						display.info(`\n${askMessage.text || ""}`)
					}

					// Show approval prompt with prompts library
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
					} else if (approvalResponse.value === undefined) {
						// Handle cancellation
						responseValue = undefined
					} else {
						responseValue = approvalResponse.value
					}
					break

				default:
					// Display the text
					display.info(`\n${askMessage.text || ""}`)

					// Show text input prompt with prompts library
					const textResponse = await prompts({
						type: "text",
						name: "value",
						message: "Your response:",
					})

					if (textResponse.value === undefined) {
						// Handle cancellation
						responseValue = undefined
					} else {
						responseValue = textResponse.value
					}
					break
			}

			// Handle cancellation or empty response
			if (responseValue === undefined || responseValue?.trim() === "") {
				display.info("\nResponse cancelled or empty.")
				return
			}

			display.debug(`User selected: ${responseValue}`)

			// Send the response with explicit debugging
			display.debug(`Sending response: "${responseValue}"`)
			await this.sendResponse(responseValue)
		} catch (error) {
			display.error(`Error handling interactive prompt: ${error}`)
		} finally {
			// Reset flags
			this.isWaitingForUserInput = false

			// Check for any listener leaks
			const afterListenerCount = process.stdin.listenerCount("data")
			display.debug(`Stdin listener count after prompt: ${afterListenerCount}`)

			try {
				// Clean up any lingering listeners to be safe
				// This is more aggressive but ensures we don't have listener leaks
				process.stdin.removeAllListeners("data")
				process.stdin.removeAllListeners("keypress")

				// Re-enable keypress events
				readline.emitKeypressEvents(process.stdin)
				if (process.stdin.isTTY) {
					process.stdin.setRawMode(true)
				}

				// Re-create the readline interface
				this.rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
					prompt: "> ",
					historySize: 100,
				})

				// Increase max listeners again
				process.stdin.setMaxListeners(20)

				// Set up event handlers again
				this.setupEventHandlers()

				display.debug("Readline interface reset and ready for next input")
			} catch (cleanupError) {
				display.error(`Error during cleanup: ${cleanupError}`)
			}

			// Always try to prompt, even if cleanup failed
			try {
				this.rl.prompt()
			} catch (promptError) {
				display.error(`Error prompting: ${promptError}`)

				try {
					// Re-enable keypress events
					readline.emitKeypressEvents(process.stdin)
					if (process.stdin.isTTY) {
						process.stdin.setRawMode(true)
					}

					// Last resort - create a new readline interface
					this.rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
						prompt: "> ",
					})

					// Set up basic event handlers
					this.rl.on("SIGINT", () => this.exit())

					this.rl.prompt()
				} catch (finalError) {
					display.error(`Critical error recreating readline: ${finalError}`)
					// At this point, we can't recover - exit gracefully
					this.exit()
				}
			}
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

				// Only start streaming for text messages
				const isTextMessage = messagePayload.message.type === "text" || !messagePayload.message.type // Default to text if no type

				if (isTextMessage && !this.isStreaming) {
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
						partial: isTextMessage, // Only mark as partial if it's a text message
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

	/**
	 * Sends a cancellation response to the current task.
	 * This is used when the user presses Ctrl+Shift+C to cancel the current operation.
	 */
	private async sendCancellationResponse(): Promise<void> {
		try {
			// Get client ID
			const clientId = this.ipcClient.getClientId()

			// Create the cancellation message
			const messageObj = {
				type: "sendMessage",
				text: "__CANCEL__", // Special value to indicate cancellation
				clientId: clientId || undefined,
				taskId: this.currentTaskId,
			}

			// Log the cancellation
			display.debug(`Sending cancellation: ${JSON.stringify(messageObj)}`)

			// Send the cancellation
			await this.ipcClient.sendMessage(messageObj)

			// Reset waiting state
			this.isWaitingForUserInput = false

			// Prompt for next input
			this.rl.prompt()
		} catch (error) {
			display.error(`Failed to send cancellation: ${error}`)
			this.rl.prompt()
		}
	}
	/**
	 * Gets direct user input using readline
	 * @param prompt The prompt to display
	 * @returns A promise that resolves with the user's input
	 */

	/**
	 * Sends a response to the current task.
	 * @param responseText The response text to send.
	 */
	private async sendResponse(responseText: string): Promise<void> {
		try {
			// Get client ID
			const clientId = this.ipcClient.getClientId()

			// Log the response being sent for debugging
			display.debug(`Sending response: ${responseText}`)

			// Ensure we have a task ID
			if (!this.currentTaskId) {
				display.warn("No task ID available when sending response. This may cause issues with message routing.")

				// Try to recover by checking if we're in the initial session
				if (Repl.hasCreatedInitialSession) {
					display.debug("Attempting to recover task ID for initial session...")

					// Create a new task ID as a fallback
					const fallbackTaskId = `fallback-${Date.now()}`
					this.currentTaskId = fallbackTaskId

					display.info(`Created fallback session ID: ${this.currentTaskId}`)

					// Register this client ID with the fallback task ID
					if (clientId) {
						try {
							await this.ipcClient.sendMessage({
								type: "registerClientId",
								clientId: clientId,
								taskId: fallbackTaskId,
							})
							display.debug(`Registered client ID with fallback task ID`)
						} catch (error) {
							display.error(`Failed to register client ID with fallback task ID: ${error}`)
						}
					}
				}
			} else {
				display.debug(`Using task ID: ${this.currentTaskId} for response`)
			}

			// Create the message object
			const messageObj = {
				type: "sendMessage",
				text: responseText,
				clientId: clientId || undefined, // Get the latest client ID
				taskId: this.currentTaskId, // Always include the task ID for existing sessions
			}

			// Log the full message object
			display.debug(`Full message object: ${JSON.stringify(messageObj)}`)

			// Send message to VS Code extension with client ID and task ID
			await this.ipcClient.sendMessage(messageObj)

			display.debug(`Response sent successfully`)

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
			this.lastMessageId = null // Reset the last message ID
			this.lastAskMessageId = null // Reset the last ask message ID

			// Only display user message if it's not empty and we haven't already displayed it
			// (handleMessage already displays the user message)
			if (message.trim() && !message.startsWith("/")) {
				// Don't display again if it's a regular message (already displayed in handleMessage)
				// Only display if it's a command like /new with a message
				display.userMessage(message)
			}

			// Get client ID
			const clientId = this.ipcClient.getClientId()

			// Send message to VS Code extension with client ID
			try {
				await this.ipcClient.sendMessage({
					type: "newTask",
					text: message,
					clientId: clientId || undefined, // Get the latest client ID
				})
			} catch (error) {
				display.error(`Failed to create new task: ${error}`)
				this.rl.prompt()
				return
			}

			// Start streaming indicator if there's a message
			if (message.trim()) {
				this.isStreaming = true
				this.currentStreamedMessage = ""
				this.hasDisplayedPrefix = false // Reset the prefix flag for a new message
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

		// Disable raw mode if it was enabled
		if (process.stdin.isTTY && process.stdin.setRawMode) {
			try {
				process.stdin.setRawMode(false)
			} catch (error) {
				display.debug(`Error disabling raw mode: ${error}`)
			}
		}

		this.rl.close()
		this.ipcClient.disconnect()
		process.exit(0)
	}
}

// Import chalk here to avoid TypeScript errors
import chalk from "chalk"
