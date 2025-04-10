import * as crypto from "node:crypto"
import EventEmitter from "node:events"
import * as fs from "node:fs" // Import fs
import { Socket } from "node:net"

import ipc from "node-ipc"

// Import corrected types from schema
import {
	CliCommand,
	IpcMessage,
	ipcMessageSchema,
	IpcMessageType,
	IpcOrigin, // Import CliCommandName
	TaskEvent,
} from "../schemas/ipc.js" // Use .js extension

/**
 * IpcServer
 */

type IpcServerEvents = {
	[IpcMessageType.Connect]: [clientId: string]
	[IpcMessageType.Disconnect]: [clientId: string]
	[IpcMessageType.CliCommand]: [clientId: string, data: CliCommand] // Use CliCommand type
	[IpcMessageType.TaskEvent]: [relayClientId: string | undefined, data: TaskEvent]
}

export class IpcServer extends EventEmitter<IpcServerEvents> {
	private readonly _socketPath: string
	private readonly _log: (...args: unknown[]) => void
	private readonly _clients: Map<string, Socket>

	private _isListening = false

	constructor(socketPath: string, log = console.log) {
		super()

		this._socketPath = socketPath
		this._log = log
		this._clients = new Map()
	}

	public listen() {
		this._isListening = true

		ipc.config.silent = true

		ipc.serve(this.socketPath, () => {
			this.log(`[IpcServer] ipc.serve callback executed for ${this.socketPath}`)
			// Set socket permissions after server starts listening
			try {
				fs.chmodSync(this.socketPath, 0o666)
				this.log(`[IpcServer] Set permissions 666 on socket file: ${this.socketPath}`)
			} catch (error) {
				this.log(`[IpcServer] Failed to set permissions on socket file: ${error}`)
			}

			ipc.server.on("connect", (socket) => this.onConnect(socket))
			ipc.server.on("socket.disconnected", (socket) => this.onDisconnect(socket))
			ipc.server.on("message", (data) => this.onMessage(data))
		})

		ipc.server.start()
	}

	private onConnect(socket: Socket) {
		const clientId = crypto.randomBytes(6).toString("hex")
		this._clients.set(clientId, socket)
		this.log(`[server#onConnect] clientId = ${clientId}, # clients = ${this._clients.size}`)

		this.log(`[server#onConnect] Sending Ack to clientId: ${clientId}`)
		this.send(socket, {
			type: IpcMessageType.Ack,
			origin: IpcOrigin.Server,
			data: { clientId, pid: process.pid, ppid: process.ppid },
		})

		this.emit(IpcMessageType.Connect, clientId)
	}

	private onDisconnect(destroyedSocket: Socket) {
		let disconnectedClientId: string | undefined

		for (const [clientId, socket] of this._clients.entries()) {
			if (socket === destroyedSocket) {
				disconnectedClientId = clientId
				this._clients.delete(clientId)
				break
			}
		}

		this.log(`[server#socket.disconnected] clientId = ${disconnectedClientId}, # clients = ${this._clients.size}`)

		if (disconnectedClientId) {
			this.emit(IpcMessageType.Disconnect, disconnectedClientId)
		}
	}

	private onMessage(data: unknown) {
		if (typeof data !== "object") {
			this.log("[server#onMessage] invalid data", data)
			return
		}

		const result = ipcMessageSchema.safeParse(data)

		if (!result.success) {
			this.log("[server#onMessage] invalid payload", result.error.format(), data)
			return
		}

		const payload = result.data

		if (payload.origin === IpcOrigin.Client) {
			switch (payload.type) {
				case IpcMessageType.CliCommand: // Use CliCommand type
					// Pass clientId along with the data when emitting
					this.emit(IpcMessageType.CliCommand, payload.clientId, payload.data) // Use CliCommand type
					break
				default:
					this.log(`[server#onMessage] unhandled payload: ${JSON.stringify(payload)}`)
					break
			}
		}
	}

	private log(...args: unknown[]) {
		this._log(...args)
	}

	public broadcast(message: IpcMessage) {
		ipc.server.broadcast("message", message)
	}

	public send(client: string | Socket, message: IpcMessage) {
		if (typeof client === "string") {
			const socket = this._clients.get(client)

			if (socket) {
				ipc.server.emit(socket, "message", message)
			}
		} else {
			ipc.server.emit(client, "message", message)
		}
	}

	public get socketPath() {
		return this._socketPath
	}

	public get isListening() {
		return this._isListening
	}

	/**
	 * Gets the list of connected client IDs.
	 * @returns An array of client IDs.
	 */
	public getConnectedClients(): string[] {
		return Array.from(this._clients.keys())
	}
}
