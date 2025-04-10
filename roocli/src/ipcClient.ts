import { EventEmitter } from "events"
import WebSocket from "ws"
import { readPortFromFile } from "./utils/config"

// Define the message types that can be sent/received
export interface WebviewMessage {
	type: string
	text?: string
	action?: string
	invoke?: string
	images?: string[]
	clientId?: string
	[key: string]: any
}

export interface ExtensionMessage {
	type: string
	text?: string
	action?: string
	state?: any
	partialMessage?: any
	[key: string]: any
}

export interface IpcClientEvents {
	connected: () => void
	disconnected: (reason?: string) => void
	reconnecting: () => void
	message: (message: ExtensionMessage) => void
	error: (error: Error) => void
	complete: () => void
}

export declare interface IpcClient {
	on<E extends keyof IpcClientEvents>(event: E, listener: IpcClientEvents[E]): this
	emit<E extends keyof IpcClientEvents>(event: E, ...args: Parameters<IpcClientEvents[E]>): boolean
}

/**
 * IpcClient handles WebSocket communication with the VS Code extension.
 * It manages connection, reconnection, and message sending/receiving.
 */
export class IpcClient extends EventEmitter {
	private ws: WebSocket | null = null
	private port: number | null = null
	private reconnectAttempts = 0
	private maxReconnectAttempts = 10
	private reconnectInterval = 2000 // 2 seconds
	private reconnectTimeoutId: NodeJS.Timeout | null = null
	private isReconnecting = false
	private isConnected = false
	private clientId: string | null = null

	constructor() {
		super()
	}

	/**
	 * Connects to the WebSocket server.
	 * @returns A promise that resolves when connected or rejects if connection fails.
	 */
	async connect(): Promise<void> {
		if (this.isConnected) {
			return
		}

		// Read the port number from the port file
		this.port = await readPortFromFile()
		if (!this.port) {
			throw new Error(
				"Failed to get WebSocket server port. Make sure VS Code is running with the Roo Code extension activated.",
			)
		}

		return new Promise((resolve, reject) => {
			try {
				// Create a new WebSocket connection
				this.ws = new WebSocket(`ws://localhost:${this.port}`)

				// Set up event handlers
				this.ws.on("open", () => {
					this.isConnected = true
					this.reconnectAttempts = 0
					this.emit("connected")
					resolve()
				})

				this.ws.on("message", (data: WebSocket.RawData) => {
					try {
						const message = JSON.parse(data.toString()) as ExtensionMessage

						// If this is a clientId message, set the client ID
						if (message.type === "clientId" && message.clientId) {
							this.setClientId(message.clientId)
							console.log(`Received client ID from server: ${message.clientId}`)
						}

						// Emit the message event for the REPL to handle
						this.emit("message", message)
					} catch (error) {
						console.error(`[ERROR] Failed to parse message: ${error}`)
						this.emit("error", new Error(`Failed to parse message: ${error}`))
					}
				})

				this.ws.on("close", (code: number, reason: Buffer) => {
					this.isConnected = false
					this.ws = null

					const reasonStr = reason.toString() || `Code: ${code}`
					this.emit("disconnected", reasonStr)

					// Attempt to reconnect unless this was a clean close
					if (code !== 1000) {
						this.scheduleReconnect()
					}
				})

				this.ws.on("error", (error: Error) => {
					this.emit("error", error)
					// The close event will be triggered after this, which will handle reconnection
				})
			} catch (error) {
				this.isConnected = false
				this.ws = null
				reject(error)
				this.scheduleReconnect()
			}
		})
	}

	/**
	 * Schedules a reconnection attempt.
	 */
	private scheduleReconnect(): void {
		if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
			return
		}

		this.isReconnecting = true
		this.reconnectAttempts++

		if (this.reconnectTimeoutId) {
			clearTimeout(this.reconnectTimeoutId)
		}

		this.reconnectTimeoutId = setTimeout(async () => {
			this.emit("reconnecting")
			try {
				await this.connect()
			} catch (error) {
				this.emit("error", new Error(`Reconnection attempt ${this.reconnectAttempts} failed: ${error}`))
			} finally {
				this.isReconnecting = false
			}
		}, this.reconnectInterval)
	}

	/**
	 * Sends a message to the WebSocket server.
	 * @param message The message to send.
	 * @returns A promise that resolves when the message is sent or rejects if sending fails.
	 */
	async sendMessage(message: WebviewMessage): Promise<void> {
		if (!this.isConnected || !this.ws) {
			throw new Error("Not connected to WebSocket server")
		}

		return new Promise((resolve, reject) => {
			// Add client ID to the message if available
			if (this.clientId) {
				message.clientId = this.clientId
			}

			this.ws!.send(JSON.stringify(message), (error) => {
				if (error) {
					reject(error)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * Disconnects from the WebSocket server.
	 */
	disconnect(): void {
		if (this.reconnectTimeoutId) {
			clearTimeout(this.reconnectTimeoutId)
			this.reconnectTimeoutId = null
		}

		if (this.ws) {
			this.ws.close(1000, "Client disconnected")
			this.ws = null
		}

		this.isConnected = false
		this.isReconnecting = false
	}

	/**
	 * Checks if the client is connected to the WebSocket server.
	 */
	isClientConnected(): boolean {
		return this.isConnected
	}

	/**
	 * Sets the client ID.
	 * @param clientId The client ID to set.
	 */
	setClientId(clientId: string): void {
		this.clientId = clientId
	}

	/**
	 * Gets the current client ID.
	 * @returns The current client ID or null if not set.
	 */
	getClientId(): string | null {
		return this.clientId
	}

	/**
	 * Configures a new profile with the specified name, mode, and provider.
	 * @param name The name of the profile.
	 * @param mode The mode slug to use for this profile.
	 * @param provider The provider ID to use for this profile.
	 * @returns A promise that resolves when the profile is configured.
	 */
	async configureProfile(name: string, mode: string, provider: string): Promise<void> {
		// Create a new API configuration
		const apiConfig: Record<string, any> = {
			apiProvider: provider.split("/")[0], // Extract provider type (e.g., 'openai' from 'openai/gpt-4')
		}

		// For specific provider types, set the model ID
		const providerParts = provider.split("/")
		if (providerParts.length > 1) {
			const providerType = providerParts[0]
			const modelId = providerParts[1]

			switch (providerType) {
				case "openai":
					apiConfig.openAiModelId = modelId
					break
				case "anthropic":
					apiConfig.anthropicModelId = modelId
					break
				// Add other provider types as needed
			}
		}

		// Save the configuration
		await this.sendMessage({
			type: "upsertApiConfiguration",
			text: name,
			apiConfiguration: apiConfig,
		})

		// Associate this profile with the specified mode
		await this.sendMessage({
			type: "mode",
			mode,
			text: name, // Use the profile name as the configuration ID
		})
	}

	/**
	 * Lists all configured profiles.
	 * @returns A promise that resolves with the list of profiles.
	 */
	async listProfiles(): Promise<any> {
		return new Promise((resolve, reject) => {
			// Set up a one-time listener for the profiles list response
			const onProfilesListReceived = (message: any) => {
				if (message.type === "listApiConfig") {
					this.removeListener("message", onProfilesListReceived)
					resolve(message.listApiConfig)
				}
			}

			this.on("message", onProfilesListReceived)

			// Send the request
			this.sendMessage({
				type: "getListApiConfiguration",
			}).catch((error) => {
				this.removeListener("message", onProfilesListReceived)
				reject(error)
			})

			// Set a timeout to prevent hanging if no response is received
			setTimeout(() => {
				this.removeListener("message", onProfilesListReceived)
				reject(new Error("Timeout waiting for profiles list"))
			}, 5000)
		})
	}

	/**
	 * Sets the default profile for subsequent commands.
	 * @param profile The name of the profile to set as default.
	 * @returns A promise that resolves when the default profile is set.
	 */
	async setDefaultProfile(profile: string): Promise<void> {
		return this.sendMessage({
			type: "currentApiConfigName",
			text: profile,
		})
	}

	/**
	 * Sends a message using a specific profile.
	 * @param profile The name of the profile to use.
	 * @param message The message to send.
	 * @returns A promise that resolves when the message is sent.
	 */
	async sendMessageWithProfile(profile: string, message: string): Promise<void> {
		// First load the profile configuration
		await this.sendMessage({
			type: "loadApiConfiguration",
			text: profile,
		})

		// Then send the message
		return this.sendMessage({
			type: "newTask",
			text: message,
		})
	}
}
