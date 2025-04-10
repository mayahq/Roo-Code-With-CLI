import { randomBytes } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { WebSocket, WebSocketServer } from "ws" // Use named imports
import { ClineProvider } from "../../core/webview/ClineProvider" // To interact with the main provider
import { ExtensionMessage } from "../../shared/ExtensionMessage" // Correct path
import { WebviewMessage } from "../../shared/WebviewMessage" // Correct path

// Define a type for the messages we expect from the CLI
// This might need refinement based on actual CLI commands
type CliMessage = WebviewMessage & {
	clientId?: string
	taskId?: string // Add taskId for task-specific messages
}

const PORT_FILE_NAME = "roo_cli_bridge.port"

export class CliBridgeServer {
	private wss: WebSocketServer | null = null // Use WebSocketServer type
	private connectedClients = new Map<string, WebSocket>() // Map client ID to WebSocket
	private port: number | null = null
	private portFilePath: string | null = null
	private logger: vscode.LogOutputChannel
	private providerRef: WeakRef<ClineProvider> // Weak reference to avoid cycles
	private apiRef: WeakRef<any> | null = null // Weak reference to API instance

	constructor(
		private context: vscode.ExtensionContext,
		provider: ClineProvider,
	) {
		this.logger = vscode.window.createOutputChannel("Roo CLI Bridge", { log: true })
		this.providerRef = new WeakRef(provider)
		this.logger.info("CLI Bridge Server initialized.")
	}

	/**
	 * Sets the API instance to enable client registration.
	 * @param api The API instance
	 */
	public setApiInstance(api: any) {
		this.apiRef = new WeakRef(api)
		this.logger.info("API instance set for CLI Bridge Server")
	}

	public async start(): Promise<void> {
		if (this.wss) {
			this.logger.warn("Server already running.")
			return
		}

		try {
			// Find an available port (0 lets the OS choose)
			this.wss = new WebSocketServer({ port: 0 }) // Use WebSocketServer constructor

			this.wss.on("listening", async () => {
				const address = this.wss?.address()
				if (typeof address === "string" || !address) {
					this.logger.error("Failed to get server address.")
					await this.stop()
					return
				}
				this.port = address.port
				this.logger.info(`WebSocket server listening on port ${this.port}`)

				// Write port to file for CLI discovery
				await this.writePortFile()

				this.setupEventHandlers()
			})

			this.wss.on("error", (error: Error) => {
				// Add type to error
				this.logger.error(`WebSocket server error: ${error?.message}`) // Add null check
				vscode.window.showErrorMessage(`Roo CLI Bridge failed to start: ${error?.message}`) // Add null check
				this.stop() // Ensure cleanup on error
			})
		} catch (error: any) {
			this.logger.error(`Failed to start WebSocket server: ${error.message}`)
			vscode.window.showErrorMessage(`Roo CLI Bridge failed to start: ${error.message}`)
			this.wss = null // Ensure wss is null if start failed
		}
	}

	private setupEventHandlers(): void {
		if (!this.wss) return

		this.wss.on("connection", (ws: WebSocket) => {
			// Use WebSocket type from 'ws'
			const clientId = randomBytes(8).toString("hex") // Simple unique ID for logging/debugging
			this.logger.info(`CLI client connected: ${clientId}`)
			this.connectedClients.set(clientId, ws)

			// Register this client with the API if available
			const api = this.apiRef?.deref()
			if (api && typeof api.registerWebSocketClientForTask === "function") {
				// Get the current task ID from the provider if available
				const provider = this.providerRef.deref()
				if (provider) {
					const currentCline = provider.getCurrentCline()
					if (currentCline) {
						const taskId = currentCline.taskId
						this.logger.info(`Registering WebSocket client ${clientId} for current task ${taskId}`)
						api.registerWebSocketClientForTask(taskId, clientId)
					}
				}
			} else {
				// Try to register through the extension's exports
				try {
					const extension = vscode.extensions.getExtension("mayalabs.roo-cline-with-cli")
					if (
						extension &&
						extension.exports &&
						typeof extension.exports.registerWebSocketClientForTask === "function"
					) {
						// Get the current task ID from the provider if available
						const provider = this.providerRef.deref()
						if (provider) {
							const currentCline = provider.getCurrentCline()
							if (currentCline) {
								const taskId = currentCline.taskId
								this.logger.info(
									`Registering WebSocket client ${clientId} for current task ${taskId} via extension exports`,
								)
								extension.exports.registerWebSocketClientForTask(taskId, clientId)
							}
						}
					} else {
						this.logger.info(
							`Extension exports not available or missing registerWebSocketClientForTask method`,
						)
					}
				} catch (error) {
					this.logger.error(`Error registering client via extension exports: ${error}`)
				}
			}

			// Send the client ID to the client immediately after connection
			this.sendMessageToClient(ws, {
				type: "clientId",
				clientId: clientId,
				text: "Connection established",
			})

			ws.on("message", (message: WebSocket.RawData) => {
				// Add type
				this.handleCliMessage(message, ws, clientId)
			})

			ws.on("close", () => {
				// No parameters needed
				this.logger.info(`CLI client disconnected: ${clientId}`)
				this.connectedClients.delete(clientId)
			})

			ws.on("error", (error: Error) => {
				// Add type
				this.logger.error(`WebSocket error for client ${clientId}: ${error.message}`)
				this.connectedClients.delete(clientId) // Ensure removal on error
			})

			// Send initial welcome message
			this.sendMessageToClient(ws, {
				type: "action",
				action: "welcome",
				text: "Connected to Roo CLI Bridge",
			})
		})
	}

	private async handleCliMessage(message: WebSocket.RawData, ws: WebSocket, clientId: string): Promise<void> {
		// ws is WebSocket from 'ws'
		let parsedMessage: CliMessage
		try {
			// Assuming messages are JSON strings
			parsedMessage = JSON.parse(message.toString()) as CliMessage
			parsedMessage.clientId = clientId // Add clientId for potential backend use
			this.logger.debug(`Received message from ${clientId}: ${JSON.stringify(parsedMessage)}`)

			// If this is a message for a specific task, register this client with the API
			if (parsedMessage.taskId) {
				this.logger.info(`Message contains taskId: ${parsedMessage.taskId}, registering client ${clientId}`)
				const api = this.apiRef?.deref()
				if (api && typeof api.registerWebSocketClientForTask === "function") {
					this.logger.info(`Registering WebSocket client ${clientId} for task ${parsedMessage.taskId}`)
					api.registerWebSocketClientForTask(parsedMessage.taskId, clientId)
				}
			}

			// --- Crucial Step: Route message to the extension's core logic ---
			// This needs to mimic how messages from the webview are handled.
			// We'll likely call a method on the ClineProvider instance.
			const provider = this.providerRef.deref()
			if (provider) {
				// Route the message to the ClineProvider's handleExternalMessage method
				// which will process it through the standard webviewMessageHandler
				await provider.handleExternalMessage(parsedMessage)
			} else {
				this.logger.warn("ClineProvider reference lost. Cannot process message.")
			}
			// --- End Crucial Step ---
		} catch (error: any) {
			this.logger.error(`Failed to parse or handle message from ${clientId}: ${error.message}`)
			this.sendMessageToClient(ws, {
				type: "action",
				action: "didBecomeVisible", // Using a standard action
				text: `Failed to process message: ${error.message}`,
			})
		}
	}

	// Method to be called by the extension backend to broadcast messages
	public broadcastMessage(message: ExtensionMessage): void {
		if (!this.wss) {
			this.logger.warn(`Cannot broadcast message: WebSocket server not initialized`)
			return
		}

		if (this.connectedClients.size === 0) {
			this.logger.warn(`Cannot broadcast message: No connected clients`)
			return
		}

		const messageString = JSON.stringify(message)
		this.logger.info(`Broadcasting message to ${this.connectedClients.size} clients: ${message.type}`)
		this.logger.debug(`Message details: ${messageString}`)

		// Extract task ID from message if available
		let taskId: string | undefined = undefined
		if (message.type === "state" && message.state && message.state.currentTaskItem) {
			taskId = message.state.currentTaskItem.id
		}

		// Register all clients with the API for this task if available
		if (taskId) {
			const api = this.apiRef?.deref()
			if (api && typeof api.registerWebSocketClientForTask === "function") {
				for (const clientId of this.connectedClients.keys()) {
					api.registerWebSocketClientForTask(taskId, clientId)
				}
			}
		}

		this.connectedClients.forEach((client: WebSocket, clientId: string) => {
			// Use WebSocket type
			if (client.readyState === WebSocket.OPEN) {
				// Ensure WebSocket.OPEN is used
				client.send(messageString, (error?: Error) => {
					// Correct callback signature
					if (error) {
						this.logger.error(`Failed to send message to client ${clientId}: ${error.message}`)
						// Optionally remove the client if send fails repeatedly
						// this.connectedClients.delete(clientId);
					}
				})
			} else {
				// Clean up disconnected clients proactively
				this.logger.warn(`Attempted to send message to a non-open client ${clientId}. Removing.`)
				this.connectedClients.delete(clientId)
			}
		})
	}

	// Send message to a specific client
	private sendMessageToClient(ws: WebSocket, message: ExtensionMessage): void {
		// ws is WebSocket from 'ws'
		if (ws.readyState === WebSocket.OPEN) {
			// Ensure WebSocket.OPEN is used
			ws.send(JSON.stringify(message))
		}
	}

	// Send message to a specific client by ID
	public sendMessageToClientById(clientId: string, message: ExtensionMessage): boolean {
		const ws = this.connectedClients.get(clientId)
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(message))
			return true
		}
		return false
	}

	private async writePortFile(): Promise<void> {
		if (!this.port) return
		try {
			// Use extension's global storage path for consistency
			const storagePath = this.context.globalStorageUri.fsPath
			await fs.mkdir(storagePath, { recursive: true })
			this.portFilePath = path.join(storagePath, PORT_FILE_NAME)
			await fs.writeFile(this.portFilePath, JSON.stringify({ port: this.port }), "utf-8")
			this.logger.info(`Port file written to: ${this.portFilePath}`)
		} catch (error: any) {
			this.logger.error(`Failed to write port file: ${error.message}`)
			vscode.window.showErrorMessage(`Roo CLI Bridge failed to write port file: ${error.message}`)
			// Consider stopping the server if port file is critical
			await this.stop()
		}
	}

	private async removePortFile(): Promise<void> {
		if (this.portFilePath) {
			try {
				await fs.unlink(this.portFilePath)
				this.logger.info(`Port file removed: ${this.portFilePath}`)
			} catch (error: any) {
				// Ignore errors if file doesn't exist (e.g., during shutdown)
				if (error.code !== "ENOENT") {
					this.logger.error(`Failed to remove port file: ${error.message}`)
				}
			} finally {
				this.portFilePath = null
			}
		}
	}

	public async stop(): Promise<void> {
		this.logger.info("Stopping CLI Bridge Server...")
		await this.removePortFile()
		return new Promise((resolve) => {
			if (this.wss) {
				// Close all client connections gracefully
				this.connectedClients.forEach((client) => {
					client.terminate() // Force close if needed, or use client.close()
				})
				this.connectedClients.clear()

				this.wss.close((err) => {
					if (err) {
						this.logger.error(`Error closing WebSocket server: ${err.message}`)
					} else {
						this.logger.info("WebSocket server closed.")
					}
					this.wss = null
					this.port = null
					resolve()
				})
			} else {
				this.logger.info("Server already stopped.")
				resolve()
			}
		})
	}
}
