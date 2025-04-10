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

			// Get client ID
			const clientId = this.ipcClient.getClientId()

			if (!clientId) {
				display.debug("No client ID available. Waiting for server to assign one...")
				// Wait a short time for the client ID to be assigned if it's not available yet
				await new Promise((resolve) => setTimeout(resolve, 500))
			}

			// Always check if we have a current task ID
			if (this.currentTaskId) {
				display.debug(`Continuing with existing session ID: ${this.currentTaskId}`)

				const clientId = this.ipcClient.getClientId()
				display.info(`Sending message with client ID: ${clientId || "none"}, task ID: ${this.currentTaskId}`)

				// Send message to VS Code extension with client ID and task ID
				// Don't await this message to avoid hanging
				this.ipcClient
					.sendMessage({
						type: "sendMessage",
						text: message,
						clientId: clientId || undefined, // Get the latest client ID
						taskId: this.currentTaskId, // Always include the task ID for existing sessions
					})
					.catch((error) => {
						display.error(`Failed to send message: ${error}`)
						this.rl.prompt()
						return
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

				display.debug(`Sent sendMessage with client ID: ${clientId || "none"}, task ID: ${this.currentTaskId}`)
			} else {
				display.debug("Starting new task...")

				// Send message to VS Code extension with client ID
				// Don't await this message to avoid hanging
				this.ipcClient
					.sendMessage({
						type: "newTask",
						text: message,
						clientId: this.ipcClient.getClientId() || undefined, // Get the latest client ID
					})
					.catch((error) => {
						display.error(`Failed to send message: ${error}`)
						this.rl.prompt()
						return
					})

				display.debug(`Sent newTask with client ID: ${this.ipcClient.getClientId() || "none"}`)
			}

			// Start streaming indicator
			this.isStreaming = true
			this.currentStreamedMessage = ""

			// Don't prompt until we get a response
		} catch (error) {
			display.error(`Failed to send message: ${error}`)
			this.rl.prompt()
		}
	}

	/**
	 * Handles a message from the IPC client.
	 * @param message The message from the IPC client.
	 */
	private async handleIpcMessage(message: any): Promise<void> {
		switch (message.type) {
			case "partialMessage":
				this.handlePartialMessage(message)
				break
			case "state":
				this.handleStateUpdate(message)
				break
			case "action":
				this.handleAction(message)
				break
			case "taskCreated":
				// Store the task ID for this session
				if (message.taskId) {
					this.currentTaskId = message.taskId
					display.info(`Session ID set to: ${this.currentTaskId}`)

					// Register this client ID with the task ID
					const clientId = this.ipcClient.getClientId()
					if (clientId) {
						display.debug(`Registering client ID ${clientId} for task ${message.taskId}`)
						// Send a special registerClientId message to ensure the mapping is set
						// Don't await this message to avoid hanging
						this.ipcClient
							.sendMessage({
								type: "registerClientId",
								clientId: clientId,
								taskId: message.taskId,
							})
							.catch((error) => {
								display.debug(`Error registering client ID: ${error}`)
							})

						// Also log the registration attempt
						display.info(`Registering client ID ${clientId} for task ${message.taskId}`)
					}
				}
				break
			case "clientId":
				// Update the client ID if provided by the server
				if (message.clientId) {
					this.ipcClient.setClientId(message.clientId)
					display.debug(`Using server-provided client ID: ${message.clientId}`)
				}
				break
			default:
				display.debug(`Received message of type: ${message.type}`)
				break
		}
	}

	/**
	 * Handles a partial message from the IPC client.
	 * @param message The partial message.
	 */
	private handlePartialMessage(message: any): void {
		if (!this.isStreaming) {
			this.isStreaming = true
			this.currentStreamedMessage = ""
			process.stdout.write("\n")
		}

		if (message.partialMessage?.type === "say") {
			// Handle AI response
			if (message.partialMessage.say === "ai_response") {
				const content = message.partialMessage.content || ""

				// If this is the first chunk, print the "Roo: " prefix
				if (this.currentStreamedMessage === "") {
					process.stdout.write(chalk.bold.blue("Roo: "))
				}

				// Calculate the new content by comparing with what we've already displayed
				let newContent = ""
				if (content.startsWith(this.currentStreamedMessage)) {
					// Normal case: new content is appended
					newContent = content.slice(this.currentStreamedMessage.length)
				} else {
					// Handle case where content might be completely different
					newContent = content
					// Clear line and reprint if needed
					if (this.currentStreamedMessage.length > 0) {
						process.stdout.write("\r\n" + chalk.bold.blue("Roo: "))
					}
				}

				// Print the new content
				process.stdout.write(newContent)

				// Update the current streamed message
				this.currentStreamedMessage = content
			}
			// Handle tool execution
			else if (message.partialMessage.say === "tool_execution") {
				const tool = message.partialMessage.tool?.tool || "unknown"
				const content = message.partialMessage.content || ""

				// If this is a new tool execution, print a new line and the tool header
				if (!this.currentStreamedMessage.includes(tool)) {
					process.stdout.write("\n\n")
					display.toolExecution(tool, "")
				}

				// Calculate the new content
				let newContent = ""
				if (content.startsWith(this.currentStreamedMessage)) {
					newContent = content.slice(this.currentStreamedMessage.length)
				} else {
					newContent = content
					// Clear line and reprint if needed
					if (this.currentStreamedMessage.length > 0) {
						process.stdout.write("\r\n")
						display.toolExecution(tool, "")
					}
				}

				// Print the new content
				process.stdout.write(newContent)

				// Update the current streamed message
				this.currentStreamedMessage = content
			}
		} else if (message.partialMessage?.type === "ask") {
			// Handle ask messages (e.g., asking for user input)
			display.info(`\n${message.partialMessage.content || "Input required:"}`)
			this.isStreaming = false
			this.rl.prompt()
		}
	}

	/**
	 * Handles a state update from the IPC client.
	 * @param message The state update message.
	 */
	private handleStateUpdate(message: any): void {
		if (message.state) {
			// Handle state updates if needed
			display.debug("Received state update")
		}

		// End streaming if we were streaming
		if (this.isStreaming) {
			this.isStreaming = false
			process.stdout.write("\n\n")
			this.rl.prompt()
		}
	}

	/**
	 * Handles an action message from the IPC client.
	 * @param message The action message.
	 */
	private handleAction(message: any): void {
		if (message.action === "didBecomeVisible") {
			// VS Code webview became visible
			display.debug("VS Code webview became visible")
		}

		// End streaming if we were streaming
		if (this.isStreaming) {
			this.isStreaming = false
			process.stdout.write("\n\n")
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
