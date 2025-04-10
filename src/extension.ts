import * as dotenvx from "@dotenvx/dotenvx"
import * as os from "os" // Added os import
import * as path from "path"
import * as vscode from "vscode"

// Load environment variables from .env file
try {
	// Specify path to .env file in the project root directory
	const envPath = path.join(__dirname, "..", ".env")
	dotenvx.config({ path: envPath })
} catch (e) {
	// Silently handle environment loading errors
	console.warn("Failed to load environment variables:", e)
}

import "./utils/path" // Necessary to have access to String.prototype.toPosix.

import { CodeActionProvider } from "./core/CodeActionProvider"
import { ClineProvider } from "./core/webview/ClineProvider"
import { API } from "./exports/api"
import { initializeI18n } from "./i18n"
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { TerminalRegistry } from "./integrations/terminal/TerminalRegistry"
import { ConfigBridgeServer } from "./services/bridge/ipc-server" // Use ConfigBridgeServer
import { CliInstaller } from "./services/cli/CliInstaller"
import { CliBridgeServer } from "./services/ipc/CliBridgeServer" // Import the new server
import { McpServerManager } from "./services/mcp/McpServerManager"
import { telemetryService } from "./services/telemetry/TelemetryService"
import { migrateSettings } from "./utils/migrateSettings"

import { handleUri, registerCodeActions, registerCommands, registerTerminalActions } from "./activate"
import { formatLanguage } from "./shared/language"

/**
 * Built using https://github.com/microsoft/vscode-webview-ui-toolkit
 *
 * Inspired by:
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra
 */

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext
let configBridgeServer: ConfigBridgeServer // Use ConfigBridgeServer type
let cliBridgeServer: CliBridgeServer // Declare the new server variable
let cliInstaller: CliInstaller

// This method is called when your extension is activated.
// Your extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel("Roo-Code")
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine("Roo-Code extension activated")

	// Migrate old settings to new
	await migrateSettings(context, outputChannel)

	// Initialize telemetry service after environment variables are loaded.
	telemetryService.initialize()

	// Initialize i18n for internationalization support
	initializeI18n(context.globalState.get("language") ?? formatLanguage(vscode.env.language))

	// Initialize terminal shell execution handlers.
	TerminalRegistry.initialize()

	// Get default commands from configuration.
	const defaultCommands =
		vscode.workspace.getConfiguration("roo-cline-with-cli").get<string[]>("allowedCommands") || []

	// Initialize global state if not already set.
	if (!context.globalState.get("allowedCommands")) {
		context.globalState.update("allowedCommands", defaultCommands)
	}

	const provider = new ClineProvider(context, outputChannel, "sidebar")
	telemetryService.setProvider(provider)

	// Initialize and start the configuration bridge server
	configBridgeServer = new ConfigBridgeServer(context, provider.providerSettingsManager, outputChannel)
	configBridgeServer.start().catch((error: Error) => {
		// Add type to error
		outputChannel.appendLine(`Failed to start Roo Configuration Bridge: ${error.message}`)
	})

	// Initialize and install the CLI
	cliInstaller = new CliInstaller(context, outputChannel)
	cliInstaller.installCli().catch((error) => {
		outputChannel.appendLine(`Failed to install Roo CLI: ${error}`)
	})

	// Initialize and start the CLI Bridge server
	cliBridgeServer = new CliBridgeServer(context, provider)
	cliBridgeServer.start().catch((error: Error) => {
		outputChannel.appendLine(`Failed to start Roo CLI Bridge: ${error.message}`)
	})

	// Connect the CliBridgeServer to the ClineProvider for message broadcasting
	provider.setCliBridgeServer(cliBridgeServer)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	registerCommands({ context, outputChannel, provider })

	/**
	 * Diff View Content Provider Setup
	 */
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
	)

	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register code actions provider.
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new CodeActionProvider(), {
			providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
		}),
	)

	registerCodeActions(context)
	registerTerminalActions(context)

	// Allows other extensions to activate once Roo is ready.
	vscode.commands.executeCommand("roo-cline-with-cli.activationCompleted")

	// Implements the `RooCodeAPI` interface and starts the IpcServer for tasks.
	const getDefaultTaskSocketPath = (): string => {
		const tmpDir = os.tmpdir()
		// Use a distinct name for this task-oriented IPC bridge
		return path.join(tmpDir, `roo-task-bridge.sock`) // Keep task bridge name
	}

	const envSocketPath = process.env.ROO_CODE_IPC_SOCKET_PATH
	const socketPath = envSocketPath || getDefaultTaskSocketPath()
	// Enable logging if the socket path is explicitly set via env or if we are using the default path
	const enableLogging = typeof envSocketPath === "string" || !envSocketPath

	if (enableLogging) {
		outputChannel.appendLine(`[API] Starting IpcServer on socket: ${socketPath}`)
	}

	// Instantiate API with its own IpcServer
	const api = new API(outputChannel, provider, socketPath, enableLogging) // Pass socketPath and enableLogging

	// Connect the CliBridgeServer to the API instance for client registration
	cliBridgeServer.setApiInstance(api)

	// Create an exports object that includes both the API and the CliBridgeServer
	const exports = {
		...api,
		cliBridgeServer,
		// Add a direct method to register WebSocket clients
		registerWebSocketClientForTask: (taskId: string, clientId: string) => {
			outputChannel.appendLine(`[API Export] Registering WebSocket client ${clientId} for task ${taskId}`)
			api.registerWebSocketClientForTask(taskId, clientId)
		},
	}

	return exports
}

// This method is called when your extension is deactivated
export async function deactivate() {
	outputChannel.appendLine("Roo-Code extension deactivated")
	// Clean up MCP server manager
	await McpServerManager.cleanup(extensionContext)
	telemetryService.shutdown()

	// Clean up terminal handlers
	TerminalRegistry.cleanup()

	// Stop the configuration bridge server
	await configBridgeServer?.stop() // Stop the config bridge

	// Stop the CLI bridge server
	await cliBridgeServer?.stop() // Stop the CLI bridge

	// Uninstall the CLI
	try {
		await cliInstaller?.uninstallCli()
	} catch (error) {
		outputChannel.appendLine(`Failed to uninstall Roo CLI: ${error}`)
	}
	// API's internal IpcServer should stop automatically or via API disposal if implemented
}
