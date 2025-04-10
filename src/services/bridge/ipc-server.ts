import * as fs from "fs"
import ipc from "node-ipc"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { telemetryService } from "../telemetry/TelemetryService"

/**
 * ConfigBridgeServer provides an IPC server that allows CLI tools to interact with
 * the Roo VS Code extension's configuration management.
 */
export class ConfigBridgeServer {
	private readonly context: vscode.ExtensionContext
	private readonly providerSettingsManager: ProviderSettingsManager
	private readonly outputChannel: vscode.OutputChannel
	private isRunning: boolean = false

	// IPC server ID
	private static readonly SERVER_ID = "roo-config-bridge" // Original ID

	// Socket path
	private static getSocketPath(): string {
		const tmpDir = os.tmpdir()
		return path.join(tmpDir, `${ConfigBridgeServer.SERVER_ID}.sock`)
	}

	constructor(
		context: vscode.ExtensionContext,
		providerSettingsManager: ProviderSettingsManager,
		outputChannel: vscode.OutputChannel,
	) {
		this.context = context
		this.providerSettingsManager = providerSettingsManager
		this.outputChannel = outputChannel
	}

	/**
	 * Start the IPC server if enabled in settings
	 */
	public async start(): Promise<void> {
		const config = vscode.workspace.getConfiguration()
		const enabled = config.get<boolean>("roo.bridge.enabled", false)

		if (!enabled) {
			this.outputChannel.appendLine("Roo Configuration Bridge is disabled")
			return
		}

		if (this.isRunning) {
			this.outputChannel.appendLine("Roo Configuration Bridge is already running")
			return
		}

		try {
			// Configure IPC
			ipc.config.id = ConfigBridgeServer.SERVER_ID
			ipc.config.retry = 1500
			ipc.config.silent = true

			// Start the IPC server
			ipc.serve(ConfigBridgeServer.getSocketPath(), () => {
				const socketPath = ConfigBridgeServer.getSocketPath()

				// Set socket permissions to 666 (read/write for all users)
				try {
					fs.chmodSync(socketPath, 0o666)
					this.outputChannel.appendLine(`[ConfigBridge] Set permissions 666 on socket file: ${socketPath}`) // Log context
				} catch (error) {
					this.outputChannel.appendLine(`[ConfigBridge] Failed to set permissions on socket file: ${error}`)
				}

				this.outputChannel.appendLine(`Roo Configuration Bridge IPC server started at ${socketPath}`)
				this.isRunning = true

				// Handle messages (Original simple structure)
				ipc.server.on("message", async (data: string, socket) => {
					try {
						const message = JSON.parse(data)
						// Expecting { command: string, params: any }
						const { command, params } = message

						if (!command || typeof command !== "string") {
							throw new Error("Invalid message format: Missing or invalid 'command'")
						}

						this.outputChannel.appendLine(`[ConfigBridge] Received command: ${command}`)

						let response: any

						switch (command) {
							case "list":
								response = await this.handleListConfig()
								break
							case "save":
								response = await this.handleSaveConfig(params)
								break
							case "load":
								response = await this.handleLoadConfig(params)
								break
							case "delete":
								response = await this.handleDeleteConfig(params)
								break
							case "setMode":
								response = await this.handleSetModeConfig(params)
								break
							case "getMode":
								response = await this.handleGetModeConfig(params)
								break
							default:
								response = { error: `Unknown command: ${command}` }
						}

						// Send response back to client
						ipc.server.emit(socket, "message", JSON.stringify(response))
					} catch (error) {
						this.outputChannel.appendLine(`[ConfigBridge] Error handling message: ${error}`)
						telemetryService.captureEvent("Bridge Server Error", { error: String(error) })

						// Send error response
						ipc.server.emit(
							socket,
							"message",
							JSON.stringify({
								error: `Error: ${error instanceof Error ? error.message : String(error)}`,
							}),
						)
					}
				})

				ipc.server.on("connect", (socket) => {
					this.outputChannel.appendLine(`[ConfigBridge] Client connected.`)
					// No Ack needed for this simple server
				})

				ipc.server.on("socket.disconnected", (socket, destroyedSocketID) => {
					this.outputChannel.appendLine(`[ConfigBridge] Client disconnected: ${destroyedSocketID}`)
				})

				ipc.server.on("error", (err) => {
					this.outputChannel.appendLine(`[ConfigBridge] Server error: ${err}`)
				})
			})

			// Start the server
			ipc.server.start()
		} catch (error) {
			this.outputChannel.appendLine(`Failed to start Roo Configuration Bridge: ${error}`)
			telemetryService.captureEvent("Bridge Server Error", { error: String(error) })
		}
	}

	/**
	 * Stop the IPC server
	 */
	public stop(): void {
		if (this.isRunning) {
			ipc.server.stop()
			this.isRunning = false
			this.outputChannel.appendLine("Roo Configuration Bridge IPC server stopped")
		}
	}

	// --- Config Command Handlers (Original) ---
	private async handleListConfig(): Promise<any> {
		try {
			const configs = await this.providerSettingsManager.listConfig()
			return { configs }
		} catch (error) {
			return { error: (error as Error).message }
		}
	}

	private async handleSaveConfig(params: any): Promise<any> {
		try {
			const { name, config } = params
			if (!name || !config) return { error: "Missing required parameters: name and config" }
			await this.providerSettingsManager.saveConfig(name, config)
			return { success: true }
		} catch (error) {
			return { error: (error as Error).message }
		}
	}

	private async handleLoadConfig(params: any): Promise<any> {
		try {
			const { name } = params
			if (!name) return { error: "Missing required parameter: name" }
			const config = await this.providerSettingsManager.loadConfig(name)
			return { success: true, config }
		} catch (error) {
			return { error: (error as Error).message }
		}
	}

	private async handleDeleteConfig(params: any): Promise<any> {
		try {
			const { name } = params
			if (!name) return { error: "Missing required parameter: name" }
			await this.providerSettingsManager.deleteConfig(name)
			return { success: true }
		} catch (error) {
			return { error: (error as Error).message }
		}
	}

	private async handleSetModeConfig(params: any): Promise<any> {
		try {
			const { mode, configId } = params
			if (!mode || !configId) return { error: "Missing required parameters: mode and configId" }
			await this.providerSettingsManager.setModeConfig(mode, configId)
			return { success: true }
		} catch (error) {
			return { error: (error as Error).message }
		}
	}

	private async handleGetModeConfig(params: any): Promise<any> {
		try {
			const { mode } = params
			if (!mode) return { error: "Missing required parameter: mode" }
			const configId = await this.providerSettingsManager.getModeConfigId(mode)
			return { configId }
		} catch (error) {
			return { error: (error as Error).message }
		}
	}
}
