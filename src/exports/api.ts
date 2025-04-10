import { EventEmitter } from "events"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { openClineInNewTab } from "../activate/registerCommands"
import { ClineProvider } from "../core/webview/ClineProvider"
import { RooCodeEventName, RooCodeEvents, RooCodeSettings, TokenUsage } from "../schemas"
import { CliCommandName, IpcMessage, IpcMessageType, IpcOrigin, TaskEvent } from "../schemas/ipc.js"
import { getWorkspacePath } from "../utils/path"

import { RooCodeAPI } from "./interface"
import { IpcServer } from "./ipc.js"
import { outputChannelLog } from "./log"

// Define structure for message event args based on ClineEvents
type MessageEventArgs = { taskId: string; action: "created" | "updated"; message: any } // Use 'any' for message temporarily

export class API extends EventEmitter<RooCodeEvents> implements RooCodeAPI {
	private readonly outputChannel: vscode.OutputChannel
	private readonly sidebarProvider: ClineProvider
	private tabProvider?: ClineProvider
	private readonly context: vscode.ExtensionContext
	private readonly ipc?: IpcServer
	private readonly taskIdToClientIdMap = new Map<string, string[]>() // Changed to store multiple clients per task
	private readonly taskMap = new Map<string, ClineProvider>()
	private readonly log: (...args: unknown[]) => void
	private readonly WEBVIEW_CLIENT_ID = "webview-ui" // Special client ID for the webview
	private readonly WS_CLIENT_PREFIX = "ws-" // Prefix for WebSocket clients
	private logfile?: string

	constructor(
		outputChannel: vscode.OutputChannel,
		provider: ClineProvider,
		socketPath?: string,
		enableLogging = false,
	) {
		super()

		this.outputChannel = outputChannel
		this.sidebarProvider = provider
		this.context = provider.context

		if (enableLogging) {
			this.log = (...args: unknown[]) => {
				outputChannelLog(this.outputChannel, ...args)
				console.log(args)
			}
			this.logfile = path.join(getWorkspacePath(), "roo-code-messages.log")
		} else {
			this.log = () => {}
		}

		// Register listeners AFTER potential IPC server setup
		// this.registerListeners(this.sidebarProvider); // Moved registration after IPC setup

		if (socketPath) {
			const ipc = (this.ipc = new IpcServer(socketPath, this.log))
			ipc.listen()
			this.log(`[API] ipc server started: socketPath=${socketPath}, pid=${process.pid}, ppid=${process.ppid}`)

			ipc.on(IpcMessageType.CliCommand, async (clientId, { commandName, data }) => {
				switch (commandName) {
					case CliCommandName.StartNewTask:
						this.log(`[API] IPC StartNewTask from clientId: ${clientId} -> ${data.text}`)
						try {
							// Pass the clientId in the configuration object
							const enhancedData = {
								...data,
								configuration: {
									...(data.configuration || {}),
									clientId: clientId, // Add clientId to configuration
								},
							}

							const taskId = await this.startNewTask(enhancedData)
							if (taskId) {
								// Explicitly set the mapping - always include both CLI client and webview
								this.taskIdToClientIdMap.set(taskId, [clientId, this.WEBVIEW_CLIENT_ID])
								this.log(
									`[API] IPC StartNewTask created taskId: ${taskId} for clients [${clientId}, ${this.WEBVIEW_CLIENT_ID}]`,
								)
								this.log(
									`[API DEBUG] Current taskIdToClientIdMap: ${JSON.stringify([...this.taskIdToClientIdMap.entries()])}`,
								)
								// Send TaskStarted event back immediately
								this.sendIpcEvent(RooCodeEventName.TaskStarted, taskId, [taskId])
							} else {
								this.log(`[API] IPC StartNewTask Error: Task creation failed`)
							}
						} catch (error) {
							this.log(`[API] IPC StartNewTask Error: ${error}`)
						}
						break
					case CliCommandName.SendMessage:
						this.log(
							`[API] IPC SendMessage from clientId: ${clientId} -> TaskID: ${data.taskId}, Text: ${data.text}`,
						)
						if (data.taskId) {
							const clientIds = this.taskIdToClientIdMap.get(data.taskId) || []
							if (!clientIds.includes(clientId)) {
								this.log(
									`[API] IPC SendMessage Warning: clientId ${clientId} not found in clients for TaskID: ${data.taskId}.`,
								)
								// Add this client to the list for future messages
								clientIds.push(clientId)
								this.taskIdToClientIdMap.set(data.taskId, clientIds)
							}
							const provider = this.getProviderForTask(data.taskId)
							if (provider) {
								const cline = provider.getCurrentCline()
								if (cline && cline.processUserInput) {
									await cline.processUserInput(data.text, data.files)
									this.log(`[API] IPC SendMessage processed for TaskID: ${data.taskId}`)
								} else {
									this.log(
										`[API] IPC SendMessage Error: Cline instance or processUserInput method not found for TaskID: ${data.taskId}`,
									)
								}
							} else {
								this.log(`[API] IPC SendMessage Error: Provider not found for TaskID: ${data.taskId}`)
							}
						} else {
							this.log(`[API] IPC SendMessage Error: TaskID missing in data`)
						}
						break
					case CliCommandName.CancelTask:
						this.log(`[API] IPC CancelTask -> ${data}`)
						await this.cancelTask(data)
						break
					case CliCommandName.CloseTask:
						this.log(`[API] IPC CloseTask -> ${data}`)
						await vscode.commands.executeCommand("workbench.action.files.saveFiles")
						await vscode.commands.executeCommand("workbench.action.closeWindow")
						break
					default:
						this.log(`[API] IPC Unhandled CliCommand: ${commandName}`)
				}
			})
		}
		// Register listeners AFTER IPC server might be set up
		this.registerListeners(this.sidebarProvider)
	}

	// REMOVED overridden emit method

	// Helper to send events via IPC
	private sendIpcEvent(eventName: RooCodeEventName, taskId: string | undefined, args: any[]) {
		if (taskId && this.ipc) {
			this.log(`[API DEBUG] Looking for clientIds for taskId: ${taskId}`)
			this.log(
				`[API DEBUG] Current taskIdToClientIdMap: ${JSON.stringify([...this.taskIdToClientIdMap.entries()])}`,
			)
			const clientIds = this.taskIdToClientIdMap.get(taskId) || []

			// Always ensure webview is included
			if (!clientIds.includes(this.WEBVIEW_CLIENT_ID)) {
				clientIds.push(this.WEBVIEW_CLIENT_ID)
				this.taskIdToClientIdMap.set(taskId, clientIds)
			}

			if (clientIds.length > 0) {
				// Construct the payload array based on the event name and args received
				let payload: any[] // Use any[] for now, specific casting below if needed

				// Ensure args matches the expected tuple structure for the payload
				switch (eventName) {
					case RooCodeEventName.Message:
						payload = args as RooCodeEvents["message"] // args should be [{ taskId, action, message }]
						break
					case RooCodeEventName.TaskCreated:
					case RooCodeEventName.TaskStarted:
					case RooCodeEventName.TaskPaused:
					case RooCodeEventName.TaskUnpaused:
					case RooCodeEventName.TaskAskResponded:
					case RooCodeEventName.TaskAborted:
						payload = args as RooCodeEvents["taskCreated"] // All expect [string]
						break
					case RooCodeEventName.TaskModeSwitched:
						payload = args as RooCodeEvents["taskModeSwitched"] // Expects [string, string]
						break
					case RooCodeEventName.TaskSpawned:
						payload = args as RooCodeEvents["taskSpawned"] // Expects [string, string]
						break
					case RooCodeEventName.TaskCompleted:
						payload = args as RooCodeEvents["taskCompleted"] // Expects [string, TokenUsage]
						break
					case RooCodeEventName.TaskTokenUsageUpdated:
						payload = args as RooCodeEvents["taskTokenUsageUpdated"] // Expects [string, TokenUsage]
						break
					default:
						this.log(`[API Send IPC] Unknown event name for payload construction: ${eventName}`)
						return // Don't send if we don't know the payload structure
				}

				const taskEventData: TaskEvent = { eventName, payload }
				const message: IpcMessage = {
					type: IpcMessageType.TaskEvent,
					origin: IpcOrigin.Server,
					data: taskEventData,
				}

				// Send to all registered clients for this task
				for (const clientId of clientIds) {
					// Check if this is a WebSocket client (has the WS_CLIENT_PREFIX)
					if (clientId.startsWith(this.WS_CLIENT_PREFIX)) {
						// Extract the actual client ID without the prefix
						const wsClientId = clientId.substring(this.WS_CLIENT_PREFIX.length)
						// Get the extension instance to access the CliBridgeServer
						const extension = vscode.extensions.getExtension("mayalabs.roo-cline-with-cli")
						if (extension && extension.exports && extension.exports.cliBridgeServer) {
							// Send the message to the WebSocket client
							// For message events, we need to format it as a partialMessage for the CLI
							let messageToSend
							if (eventName === RooCodeEventName.Message) {
								// Format as partialMessage for the CLI
								const messagePayload = args[0] // Extract the message payload

								// Make sure we have content to send
								const content = messagePayload.message.content || ""
								if (content.trim()) {
									messageToSend = {
										type: "partialMessage",
										partialMessage: {
											ts: Date.now(),
											type: "say",
											say: "text",
											text: content,
											partial: true,
										},
									}
									this.log(
										`[API Emit WS] Formatted message event as partialMessage for CLI client ${wsClientId}: ${content.substring(0, 50)}...`,
									)
								} else {
									this.log(`[API Emit WS] Skipping empty message for CLI client ${wsClientId}`)
									return // Skip sending empty messages
								}
							} else {
								// For other events, use the standard format
								messageToSend = {
									type: "taskEvent",
									eventName,
									payload: args,
								}
							}

							const sent = extension.exports.cliBridgeServer.sendMessageToClientById(
								wsClientId,
								messageToSend,
							)
							if (sent) {
								this.log(
									`[API Emit WS] Sent ${eventName} for task ${taskId} to WebSocket client ${wsClientId}`,
								)
							} else {
								this.log(
									`[API Emit WS] Failed to send ${eventName} for task ${taskId} to WebSocket client ${wsClientId}`,
								)
							}
						} else {
							this.log(
								`[API Emit WS] CliBridgeServer not available to send ${eventName} to WebSocket client ${wsClientId}`,
							)
						}
					} else {
						// Regular IPC client
						this.ipc.send(clientId, message)
						this.log(`[API Emit IPC] Sent ${eventName} for task ${taskId} to IPC client ${clientId}`)
					}
				}
			} else {
				// If we can't find a client ID for this task, it might be a task created via the UI
				// Let's try broadcasting the message to all connected clients
				this.log(`[API Emit IPC] No client found for taskId: ${taskId}. Attempting broadcast.`)

				// Get all connected clients
				const connectedClients = this.ipc.getConnectedClients ? [...this.ipc.getConnectedClients()] : []

				// If we have connected clients, update the mapping and send to them
				if (connectedClients.length > 0) {
					// Always include the webview client
					if (!connectedClients.includes(this.WEBVIEW_CLIENT_ID)) {
						connectedClients.push(this.WEBVIEW_CLIENT_ID)
					}

					// Update the mapping for future messages
					this.taskIdToClientIdMap.set(taskId, connectedClients)
					this.log(
						`[API DEBUG] Updated taskIdToClientIdMap with all clients: ${connectedClients.join(", ")} for task ${taskId}`,
					)

					// Recreate the message object in this scope
					const taskEventData: TaskEvent = { eventName, payload: args }
					const message: IpcMessage = {
						type: IpcMessageType.TaskEvent,
						origin: IpcOrigin.Server,
						data: taskEventData,
					}

					// Send to all connected clients
					for (const clientId of connectedClients) {
						this.ipc.send(clientId, message)
						this.log(`[API Emit IPC] Sent ${eventName} for task ${taskId} to client ${clientId}`)
					}
				} else if (this.ipc.broadcast) {
					// If no specific clients but broadcast is available, use it
					const taskEventData: TaskEvent = { eventName, payload: args }
					const broadcastMessage: IpcMessage = {
						type: IpcMessageType.TaskEvent,
						origin: IpcOrigin.Server,
						data: taskEventData,
					}

					this.ipc.broadcast(broadcastMessage)
					this.log(`[API Emit IPC] Broadcasted ${eventName} for task ${taskId} to all clients`)

					// Since we're broadcasting, let's also update our mapping for future messages
					// Include all connected clients and the webview
					const connectedClients = [...this.ipc.getConnectedClients()]
					if (connectedClients.length > 0) {
						// Always include the webview client
						if (!connectedClients.includes(this.WEBVIEW_CLIENT_ID)) {
							connectedClients.push(this.WEBVIEW_CLIENT_ID)
						}
						this.taskIdToClientIdMap.set(taskId, connectedClients)
						this.log(
							`[API DEBUG] Updated taskIdToClientIdMap with all clients: ${connectedClients.join(", ")} for task ${taskId}`,
						)
					}
				} else {
					this.log(`[API Emit IPC] No broadcast method available. Event ${eventName} not sent.`)
				}
			}
		} else {
			this.log(`[API Emit IPC] Event ${eventName} has no taskId or IPC not active. Not sent.`)
		}
	}

	public async startNewTask({
		configuration,
		text,
		images,
		newTab,
	}: {
		configuration?: RooCodeSettings
		text?: string
		images?: string[]
		newTab?: boolean
	}): Promise<string> {
		let provider: ClineProvider
		if (newTab || !this.tabProvider) {
			this.tabProvider = await openClineInNewTab({ context: this.context, outputChannel: this.outputChannel })
			this.registerListeners(this.tabProvider) // Register listeners for new tab provider
			provider = this.tabProvider
		} else {
			provider = this.sidebarProvider
		}

		if (configuration) {
			await provider.setValues(configuration)
			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration("roo-cline-with-cli")
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}
		}

		await provider.removeClineFromStack()
		await provider.postStateToWebview()
		await provider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await provider.postMessageToWebview({ type: "invoke", invoke: "newChat", text, images })

		const { taskId } = await provider.initClineWithTask(text, images, undefined, {
			consecutiveMistakeLimit: Number.MAX_SAFE_INTEGER,
		})

		// Add the task to the taskMap
		this.taskMap.set(taskId, provider)
		this.log(`[API] Task ${taskId} added to taskMap.`)
		// Note: The taskIdToClientIdMap is now set by the caller (StartNewTask handler)
		// rather than here to avoid redundancy and potential race conditions

		return taskId
	}

	public getCurrentTaskStack(): string[] {
		return this.sidebarProvider.getCurrentTaskStack()
	}

	public async clearCurrentTask(lastMessage?: string) {
		await this.sidebarProvider.finishSubTask(lastMessage)
		await this.sidebarProvider.postStateToWebview()
	}

	public async cancelCurrentTask() {
		await this.sidebarProvider.cancelTask()
	}

	public async cancelTask(taskId: string): Promise<void> {
		const providerToCancel = this.taskMap.get(taskId)
		if (providerToCancel) {
			await providerToCancel.cancelTask()
		}
	}

	public async sendMessage(text?: string, images?: string[]) {
		// Use 'invoke' pattern
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text, images })
	}

	public async pressPrimaryButton() {
		// Use 'invoke' pattern
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "primaryButtonClick" })
	}

	public async pressSecondaryButton() {
		// Use 'invoke' pattern
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "secondaryButtonClick" })
	}

	public getConfiguration() {
		return this.sidebarProvider.getValues()
	}

	public async setConfiguration(values: RooCodeSettings) {
		await this.sidebarProvider.setValues(values)
		await this.sidebarProvider.providerSettingsManager.saveConfig(values.currentApiConfigName || "default", values)
		await this.sidebarProvider.postStateToWebview()
	}

	public async createProfile(name: string) {
		if (!name || !name.trim()) {
			throw new Error("Profile name cannot be empty")
		}
		const currentSettings = this.getConfiguration()
		const profiles = currentSettings.listApiConfigMeta || []
		if (profiles.some((profile) => profile.name === name)) {
			throw new Error(`A profile with the name "${name}" already exists`)
		}
		const id = this.sidebarProvider.providerSettingsManager.generateId()
		await this.setConfiguration({
			...currentSettings,
			listApiConfigMeta: [...profiles, { id, name: name.trim(), apiProvider: "openai" as const }],
		})
		return id
	}

	public getProviderForTask(taskId: string): ClineProvider | undefined {
		return this.taskMap.get(taskId)
	}

	public getProfiles(): string[] {
		return (this.getConfiguration().listApiConfigMeta || []).map((profile) => profile.name)
	}

	public async setActiveProfile(name: string) {
		const currentSettings = this.getConfiguration()
		const profiles = currentSettings.listApiConfigMeta || []
		const profile = profiles.find((p) => p.name === name)
		if (!profile) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}
		await this.setConfiguration({ ...currentSettings, currentApiConfigName: profile.name })
	}

	public getActiveProfile() {
		return this.getConfiguration().currentApiConfigName
	}

	public async deleteProfile(name: string) {
		const currentSettings = this.getConfiguration()
		const profiles = currentSettings.listApiConfigMeta || []
		const targetIndex = profiles.findIndex((p) => p.name === name)
		if (targetIndex === -1) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}
		const profileToDelete = profiles[targetIndex]
		profiles.splice(targetIndex, 1)
		const newSettings: RooCodeSettings = {
			...currentSettings,
			listApiConfigMeta: profiles,
			currentApiConfigName:
				currentSettings.currentApiConfigName === profileToDelete.name
					? undefined
					: currentSettings.currentApiConfigName,
		}
		await this.setConfiguration(newSettings)
	}

	public isReady(): boolean {
		return this.sidebarProvider.viewLaunched
	}

	/**
	 * Explicitly register a client ID for a task ID.
	 * This is used by the CLI to ensure it receives messages for a task.
	 * @param taskId The task ID to register the client for
	 * @param clientId The client ID to register
	 */
	/**
	 * Registers a WebSocket client for a task.
	 * This is used by the CliBridgeServer to ensure WebSocket clients receive messages for a task.
	 * @param taskId The task ID to register the client for
	 * @param wsClientId The WebSocket client ID to register
	 */
	public registerWebSocketClientForTask(taskId: string, wsClientId: string): void {
		const wsClientIdWithPrefix = `${this.WS_CLIENT_PREFIX}${wsClientId}`
		this.log(`[API] Registering WebSocket client ${wsClientIdWithPrefix} for task ${taskId}`)

		// Check if the task exists in the taskMap
		const provider = this.getProviderForTask(taskId)
		if (provider) {
			this.log(`[API] Found provider for task ${taskId}, registering WebSocket client ${wsClientIdWithPrefix}`)
		} else {
			this.log(
				`[API] Warning: No provider found for task ${taskId}, but still registering WebSocket client ${wsClientIdWithPrefix}`,
			)
		}

		// Register the client
		this.registerClientForTask(taskId, wsClientIdWithPrefix)

		// Log the current state after registration
		this.log(
			`[API] After registration - taskIdToClientIdMap for task ${taskId}: ${JSON.stringify(this.taskIdToClientIdMap.get(taskId) || [])}`,
		)
	}

	/**
	 * Explicitly register a client ID for a task ID.
	 * This is used by the CLI to ensure it receives messages for a task.
	 * @param taskId The task ID to register the client for
	 * @param clientId The client ID to register
	 */
	public registerClientForTask(taskId: string, clientId: string): void {
		this.log(`[API] registerClientForTask called with taskId: ${taskId}, clientId: ${clientId}`)

		// Check if the task exists in the taskMap
		const provider = this.getProviderForTask(taskId)
		if (provider) {
			this.log(`[API] Found provider for task ${taskId} in taskMap`)
		} else {
			this.log(`[API] Warning: No provider found for task ${taskId} in taskMap`)

			// Check if this is a new task that hasn't been added to the taskMap yet
			// If so, we'll add it to the taskIdToClientIdMap anyway
			if (!this.taskIdToClientIdMap.has(taskId)) {
				this.log(`[API] Creating new entry in taskIdToClientIdMap for task ${taskId}`)
				this.taskIdToClientIdMap.set(taskId, [])
			}
		}

		const clientIds = this.taskIdToClientIdMap.get(taskId) || []
		this.log(`[API] Existing clients for task ${taskId}: ${JSON.stringify(clientIds)}`)

		// Add the client ID if it's not already in the list
		if (!clientIds.includes(clientId)) {
			clientIds.push(clientId)
			this.taskIdToClientIdMap.set(taskId, clientIds)
			this.log(`[API] Explicitly registered client ${clientId} for task ${taskId}`)
		} else {
			this.log(`[API] Client ${clientId} already registered for task ${taskId}`)
		}

		// Always ensure webview is included
		if (!clientIds.includes(this.WEBVIEW_CLIENT_ID)) {
			clientIds.push(this.WEBVIEW_CLIENT_ID)
			this.taskIdToClientIdMap.set(taskId, clientIds)
			this.log(`[API] Added webview client for task ${taskId}`)
		}

		this.log(`[API DEBUG] Current taskIdToClientIdMap: ${JSON.stringify([...this.taskIdToClientIdMap.entries()])}`)
	}

	// Updated registerListeners with correct signatures and IPC forwarding via sendIpcEvent helper
	private registerListeners(provider: ClineProvider) {
		provider.on("clineCreated", (cline) => {
			const taskId = cline.taskId
			super.emit(RooCodeEventName.TaskCreated, taskId) // Emit locally first
			// Check if this task was created via CLI (has a client ID mapping)
			// If not, it might be a task created via the UI, so we need to preserve any existing mapping
			if (!this.taskIdToClientIdMap.has(taskId)) {
				this.log(`[API DEBUG] No client mapping found for new task ${taskId}, assuming UI-created task`)

				// Always ensure the webview client is registered for this task
				this.taskIdToClientIdMap.set(taskId, [this.WEBVIEW_CLIENT_ID])

				// Try to find any connected CLI clients and add them to the mapping
				if (this.ipc) {
					const connectedClients = [...this.ipc.getConnectedClients()]
					if (connectedClients.length > 0) {
						// Filter out the webview client if it's already in the list
						const cliClients = connectedClients.filter((id) => id !== this.WEBVIEW_CLIENT_ID)
						if (cliClients.length > 0) {
							// Add all CLI clients to the mapping
							this.taskIdToClientIdMap.set(taskId, [...cliClients, this.WEBVIEW_CLIENT_ID])
							this.log(`[API DEBUG] Added CLI clients ${cliClients.join(", ")} to task ${taskId}`)
						}
					}
				}
			}

			// Send taskCreated event to all clients
			this.sendIpcEvent(RooCodeEventName.TaskCreated, taskId, [taskId]) // Forward via IPC

			cline.on("taskStarted", async () => {
				// No args
				const taskId = cline.taskId // Get taskId from cline instance
				super.emit(RooCodeEventName.TaskStarted, taskId) // Pass args individually

				// Ensure the task is in the taskMap
				this.taskMap.set(taskId, provider)

				// Log the current mapping state
				this.log(
					`[API DEBUG] Task started - taskId: ${taskId}, clientId: ${this.taskIdToClientIdMap.get(taskId) || "not found"}`,
				)
				this.log(
					`[API DEBUG] Current taskIdToClientIdMap: ${JSON.stringify([...this.taskIdToClientIdMap.entries()])}`,
				)

				// Forward the event via IPC
				this.sendIpcEvent(RooCodeEventName.TaskStarted, taskId, [taskId])

				await this.fileLog(`[${new Date().toISOString()}] taskStarted -> ${taskId}\n`)
			})

			// Correct signature for 'message' event based on ClineEvents
			cline.on("message", async (messageArgs: { action: "created" | "updated"; message: any }) => {
				const taskId = cline.taskId // Get taskId from cline instance

				// Log the message content for debugging
				this.log(
					`[API] Message event from cline: action=${messageArgs.action}, content=${messageArgs.message.content?.substring(0, 100) || "none"}...`,
				)

				// Construct the payload expected by RooCodeEvents["message"]
				const payload: RooCodeEvents["message"] = [{ taskId: taskId, ...messageArgs }]

				// Emit locally with correct payload structure (pass object)
				super.emit(RooCodeEventName.Message, payload[0])

				// Check if there are any WebSocket clients registered for this task
				const clientIds = this.taskIdToClientIdMap.get(taskId) || []
				const wsClients = clientIds.filter((id) => id.startsWith(this.WS_CLIENT_PREFIX))
				if (wsClients.length > 0) {
					this.log(`[API] Sending message event to ${wsClients.length} WebSocket clients for task ${taskId}`)
				}

				// Forward via IPC (pass array)
				this.sendIpcEvent(RooCodeEventName.Message, taskId, payload)

				if (messageArgs.message.partial !== true) {
					await this.fileLog(
						`[${new Date().toISOString()}] ${JSON.stringify(messageArgs.message, null, 2)}\n`,
					)
				}
			})

			cline.on("taskModeSwitched", (taskIdFromEvent, mode) => {
				// Correct args
				super.emit(RooCodeEventName.TaskModeSwitched, taskIdFromEvent, mode) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskModeSwitched, taskIdFromEvent, [taskIdFromEvent, mode]) // Pass args as array
			})

			// Correct listener signature for taskTokenUsageUpdated
			cline.on("taskTokenUsageUpdated", (taskIdFromEvent: string, usage: TokenUsage) => {
				super.emit(RooCodeEventName.TaskTokenUsageUpdated, taskIdFromEvent, usage) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskTokenUsageUpdated, taskIdFromEvent, [taskIdFromEvent, usage]) // Pass args as array
			})

			// Correct listener signature for taskAskResponded (no args)
			cline.on("taskAskResponded", () => {
				const taskId = cline.taskId
				super.emit(RooCodeEventName.TaskAskResponded, taskId) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskAskResponded, taskId, [taskId]) // Pass args as array
			})

			// Correct listener signature for taskAborted (no args)
			cline.on("taskAborted", () => {
				const taskId = cline.taskId
				super.emit(RooCodeEventName.TaskAborted, taskId) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskAborted, taskId, [taskId]) // Pass args as array
				this.log(`[API DEBUG] Task aborted - removing taskId: ${taskId} from maps`)
				this.taskMap.delete(taskId)
				this.taskIdToClientIdMap.delete(taskId)
			})

			// Correct listener signature for taskCompleted
			cline.on("taskCompleted", async (taskIdFromEvent: string, usage: TokenUsage) => {
				super.emit(RooCodeEventName.TaskCompleted, taskIdFromEvent, usage) // Pass args individually
				const clientIds = this.taskIdToClientIdMap.get(taskIdFromEvent) || []
				this.log(
					`[API DEBUG] Task completed - taskId: ${taskIdFromEvent}, clients: ${clientIds.join(", ") || "not found"}`,
				)
				this.sendIpcEvent(RooCodeEventName.TaskCompleted, taskIdFromEvent, [taskIdFromEvent, usage]) // Pass args as array
				this.taskMap.delete(taskIdFromEvent)
				this.taskIdToClientIdMap.delete(taskIdFromEvent)
				await this.fileLog(
					`[${new Date().toISOString()}] taskCompleted -> ${taskIdFromEvent} | ${JSON.stringify(usage, null, 2)}\n`,
				)
			})

			// Correct listener signature for taskSpawned
			cline.on("taskSpawned", (childTaskId: string) => {
				// Only childTaskId is emitted
				const parentTaskId = cline.taskId
				super.emit(RooCodeEventName.TaskSpawned, parentTaskId, childTaskId) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskSpawned, parentTaskId, [parentTaskId, childTaskId]) // Pass args as array
			})

			// Correct listener signature for taskPaused (no args)
			cline.on("taskPaused", () => {
				const taskId = cline.taskId
				super.emit(RooCodeEventName.TaskPaused, taskId) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskPaused, taskId, [taskId]) // Pass args as array
			})

			// Correct listener signature for taskUnpaused (no args)
			cline.on("taskUnpaused", () => {
				const taskId = cline.taskId
				super.emit(RooCodeEventName.TaskUnpaused, taskId) // Pass args individually
				this.sendIpcEvent(RooCodeEventName.TaskUnpaused, taskId, [taskId]) // Pass args as array
			})
		})
	}

	private async fileLog(message: string) {
		if (!this.logfile) {
			return
		}

		try {
			await fs.appendFile(this.logfile, message, "utf-8")
		} catch (_) {
			this.logfile = undefined
		}
	}
}
