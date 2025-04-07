import * as vscode from "vscode"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { telemetryService } from "../telemetry/TelemetryService"

// Declare Node.js modules to avoid TypeScript errors
declare const require: any
const http = require("http")
const { URL } = require("url")
const Buffer = require("buffer").Buffer

/**
 * ConfigBridgeServer provides an HTTP server that allows CLI tools to interact with
 * the Roo VS Code extension's configuration management.
 */
export class ConfigBridgeServer {
	private server: any = null
	private readonly context: vscode.ExtensionContext
	private readonly providerSettingsManager: ProviderSettingsManager
	private readonly outputChannel: vscode.OutputChannel

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
	 * Start the HTTP server if enabled in settings
	 */
	public async start(): Promise<void> {
		const config = vscode.workspace.getConfiguration()
		const enabled = config.get<boolean>("roo.bridge.enabled", false)

		if (!enabled) {
			this.outputChannel.appendLine("Roo Configuration Bridge is disabled")
			return
		}

		const port = config.get<number>("roo.bridge.port", 30001)

		// Get secret from settings or secrets storage
		let secret = config.get<string>("roo.bridge.secret", "")
		if (!secret) {
			// Try to get from secrets storage
			secret = (await this.context.secrets.get("roo.bridge.secret")) || ""
		}

		this.server = http.createServer(async (req: any, res: any) => {
			try {
				// Set CORS headers
				res.setHeader("Access-Control-Allow-Origin", "*")
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Roo-Bridge-Secret")

				// Handle preflight requests
				if (req.method === "OPTIONS") {
					res.writeHead(204)
					res.end()
					return
				}

				// Authenticate request if secret is set
				if (secret && req.headers["x-roo-bridge-secret"] !== secret) {
					res.writeHead(401, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Unauthorized" }))
					return
				}

				// Parse URL
				const url = new URL(req.url || "/", `http://localhost:${port}`)
				const path = url.pathname

				// Handle request based on path and method
				await this.handleRequest(req, res, path)
			} catch (error) {
				this.outputChannel.appendLine(`Roo Configuration Bridge error: ${error}`)
				telemetryService.captureEvent("Bridge Server Error", { error: String(error) })
				res.writeHead(500, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Internal server error" }))
			}
		})

		// Only bind to localhost for security
		this.server.listen(port, "127.0.0.1", () => {
			this.outputChannel.appendLine(`Roo Configuration Bridge server started on port ${port}`)
		})

		this.server.on("error", (error: Error) => {
			this.outputChannel.appendLine(`Roo Configuration Bridge server error: ${error}`)
			telemetryService.captureEvent("Bridge Server Error", { error: String(error) })
		})
	}

	/**
	 * Stop the HTTP server
	 */
	public stop(): void {
		if (this.server) {
			this.server.close()
			this.server = null
			this.outputChannel.appendLine("Roo Configuration Bridge server stopped")
		}
	}

	/**
	 * Handle incoming HTTP requests
	 */
	private async handleRequest(req: any, res: any, path: string): Promise<void> {
		// Parse request body for POST requests
		let body: any = {}
		if (req.method === "POST") {
			body = await this.parseRequestBody(req)
		}

		// Parse query parameters for GET requests
		const url = new URL(req.url || "/", `http://localhost:${req.socket.localPort}`)
		const query = Object.fromEntries(url.searchParams)

		// Handle different endpoints
		switch (true) {
			case path === "/config/save" && req.method === "POST":
				await this.handleSaveConfig(res, body)
				break

			case path === "/config/load" && req.method === "POST":
				await this.handleLoadConfig(res, body)
				break

			case path === "/config/list" && req.method === "GET":
				await this.handleListConfig(res)
				break

			case path === "/config/delete" && req.method === "POST":
				await this.handleDeleteConfig(res, body)
				break

			case path === "/config/setMode" && req.method === "POST":
				await this.handleSetModeConfig(res, body)
				break

			case path === "/config/getMode" && req.method === "GET":
				await this.handleGetModeConfig(res, query)
				break

			default:
				res.writeHead(404, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Not found" }))
		}
	}

	/**
	 * Parse request body from incoming request
	 */
	private parseRequestBody(req: any): Promise<any> {
		return new Promise((resolve, reject) => {
			const chunks: any[] = []

			req.on("data", (chunk: any) => {
				chunks.push(chunk)
			})

			req.on("end", () => {
				try {
					const body = Buffer.concat(chunks).toString()
					resolve(body ? JSON.parse(body) : {})
				} catch (error) {
					reject(new Error("Invalid JSON"))
				}
			})

			req.on("error", reject)
		})
	}

	/**
	 * Handle save config endpoint
	 */
	private async handleSaveConfig(res: any, body: any): Promise<void> {
		try {
			if (!body.name || !body.config) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing required parameters: name and config" }))
				return
			}

			await this.providerSettingsManager.saveConfig(body.name, body.config)

			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ success: true }))
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: (error as Error).message }))
		}
	}

	/**
	 * Handle load config endpoint
	 */
	private async handleLoadConfig(res: any, body: any): Promise<void> {
		try {
			if (!body.name) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing required parameter: name" }))
				return
			}

			const config = await this.providerSettingsManager.loadConfig(body.name)

			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ success: true, config }))
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: (error as Error).message }))
		}
	}

	/**
	 * Handle list config endpoint
	 */
	private async handleListConfig(res: any): Promise<void> {
		try {
			const configs = await this.providerSettingsManager.listConfig()

			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ configs }))
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: (error as Error).message }))
		}
	}

	/**
	 * Handle delete config endpoint
	 */
	private async handleDeleteConfig(res: any, body: any): Promise<void> {
		try {
			if (!body.name) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing required parameter: name" }))
				return
			}

			await this.providerSettingsManager.deleteConfig(body.name)

			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ success: true }))
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: (error as Error).message }))
		}
	}

	/**
	 * Handle set mode config endpoint
	 */
	private async handleSetModeConfig(res: any, body: any): Promise<void> {
		try {
			if (!body.mode || !body.configId) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing required parameters: mode and configId" }))
				return
			}

			await this.providerSettingsManager.setModeConfig(body.mode, body.configId)

			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ success: true }))
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: (error as Error).message }))
		}
	}

	/**
	 * Handle get mode config endpoint
	 */
	private async handleGetModeConfig(res: any, query: any): Promise<void> {
		try {
			if (!query.mode) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing required parameter: mode" }))
				return
			}

			const configId = await this.providerSettingsManager.getModeConfigId(query.mode)

			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ configId }))
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: (error as Error).message }))
		}
	}
}
