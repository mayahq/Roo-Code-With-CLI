import chalk from "chalk"
import { display } from "./display"
import { IpcClient } from "./ipcClient"

/**
 * Scripting class for non-interactive command execution.
 */
export class Scripting {
	private ipcClient: IpcClient
	private message: string
	private timeout: number
	private isComplete = false
	private exitCode = 0
	private timeoutId: NodeJS.Timeout | null = null
	private currentTaskId: string | null = null
	private isStreaming = false
	private currentStreamedMessage = ""

	/**
	 * Creates a new Scripting instance.
	 * @param ipcClient The IPC client to use.
	 * @param message The message to send.
	 * @param timeout The timeout in milliseconds.
	 */
	constructor(ipcClient: IpcClient, message: string, timeout: number = 60000) {
		this.ipcClient = ipcClient
		this.message = message
		this.timeout = timeout
	}

	/**
	 * Executes the script.
	 * @returns A promise that resolves when the script completes.
	 */
	async execute(): Promise<number> {
		return new Promise<number>((resolve) => {
			// Set up event handlers
			this.setupEventHandlers(resolve)

			// Set timeout
			this.timeoutId = setTimeout(() => {
				if (!this.isComplete) {
					display.error("Timeout waiting for response.")
					this.complete(1)
				}
			}, this.timeout)

			// Send message
			this.sendMessage().catch((error) => {
				display.error(`Failed to send message: ${error}`)
				this.complete(1)
			})
		})
	}

	/**
	 * Sets up event handlers for the script.
	 * @param resolve The promise resolve function.
	 */
	private setupEventHandlers(resolve: (exitCode: number) => void): void {
		// Handle IPC client messages
		this.ipcClient.on("message", async (message) => {
			await this.handleIpcMessage(message)
		})

		this.ipcClient.on("disconnected", (reason) => {
			display.error(`Disconnected from VS Code extension: ${reason}`)
			this.complete(1)
		})

		this.ipcClient.on("error", (error) => {
			display.error(`Error: ${error.message}`)
			this.complete(1)
		})

		// Handle completion
		this.ipcClient.on("complete", () => {
			this.complete(0)
		})

		// Override the complete method to resolve the promise
		this.complete = (exitCode: number) => {
			if (!this.isComplete) {
				this.isComplete = true
				this.exitCode = exitCode

				// Clear timeout
				if (this.timeoutId) {
					clearTimeout(this.timeoutId)
					this.timeoutId = null
				}

				// Disconnect from IPC client
				this.ipcClient.disconnect()

				// Resolve the promise
				resolve(exitCode)
			}
		}
	}

	/**
	 * Sends the message to the IPC client.
	 */
	private async sendMessage(): Promise<void> {
		// Send message to VS Code extension with client ID
		const clientId = this.ipcClient.getClientId()

		if (!clientId) {
			display.debug("No client ID available. Waiting for server to assign one...")
			// Wait a short time for the client ID to be assigned if it's not available yet
			await new Promise((resolve) => setTimeout(resolve, 500))
		}

		// Always use newTask for scripting mode since it's a one-time execution
		await this.ipcClient.sendMessage({
			type: "newTask",
			text: this.message,
			clientId: this.ipcClient.getClientId() || undefined, // Get the latest client ID
		})

		display.debug(`Sent newTask with client ID: ${this.ipcClient.getClientId() || "none"}`)
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
				// Check if this is a final state update
				if (message.state && message.state.clineMessages && message.state.clineMessages.length > 0) {
					const lastMessage = message.state.clineMessages[message.state.clineMessages.length - 1]
					if (lastMessage.type === "say" && lastMessage.say === "ai_response") {
						// This is the final AI response
						if (!this.isStreaming) {
							display.aiResponse(lastMessage.content || "")
						} else {
							// Ensure we have a newline after streaming
							process.stdout.write("\n\n")
						}
						this.complete(0)
					}
				}
				break
			case "action":
				if (message.action === "didBecomeVisible") {
					// VS Code webview became visible, which usually means the task is complete
					this.complete(0)
				}
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
						await this.ipcClient.sendMessage({
							type: "registerClientId",
							clientId: clientId,
							taskId: message.taskId,
						})
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
		if (message.partialMessage?.type === "say") {
			// Handle AI response
			if (message.partialMessage.say === "ai_response") {
				const content = message.partialMessage.content || ""

				// Handle streaming
				if (!this.isStreaming) {
					this.isStreaming = true
					this.currentStreamedMessage = ""
					process.stdout.write(chalk.bold.blue("Roo: "))
				}

				// Calculate the new content
				let newContent = ""
				if (content.startsWith(this.currentStreamedMessage)) {
					newContent = content.slice(this.currentStreamedMessage.length)
				} else {
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

				// If we were streaming AI response, add a newline
				if (this.isStreaming) {
					process.stdout.write("\n\n")
					this.isStreaming = false
				}

				display.toolExecution(tool, content)
			}
		} else if (message.partialMessage?.type === "ask") {
			// Handle ask messages (e.g., asking for user input)
			display.error(
				`Script mode doesn't support interactive prompts: ${message.partialMessage.content || "Input required"}`,
			)
			this.complete(1)
		}
	}

	/**
	 * Completes the script.
	 * @param exitCode The exit code.
	 */
	private complete(exitCode: number): void {
		// This method is overridden in setupEventHandlers
		this.isComplete = true
		this.exitCode = exitCode
	}
}
