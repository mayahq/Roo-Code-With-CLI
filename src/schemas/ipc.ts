import { z } from "zod"

import { RooCodeEventName, rooCodeSettingsSchema } from "./index"

/**
 * Ack
 */

export const ackSchema = z.object({
	clientId: z.string(),
	pid: z.number(),
	ppid: z.number(),
})

export type Ack = z.infer<typeof ackSchema>

/**
 * CliCommand (Renamed from TaskCommand)
 */

// Renamed enum and added Config commands
export enum CliCommandName {
	// Task Commands
	StartNewTask = "StartNewTask",
	SendMessage = "SendMessage",
	CancelTask = "CancelTask",
	CloseTask = "CloseTask",
	// Config Commands
	ConfigList = "ConfigList",
	ConfigSave = "ConfigSave",
	ConfigLoad = "ConfigLoad",
	ConfigDelete = "ConfigDelete",
	ConfigSetMode = "ConfigSetMode",
	ConfigGetMode = "ConfigGetMode",
	// Add GetCliState, SaveCliState if needed
}

// Renamed schema and added config command schemas
export const cliCommandSchema = z.discriminatedUnion("commandName", [
	// Task Commands
	z.object({
		commandName: z.literal(CliCommandName.StartNewTask),
		data: z.object({
			// Define payload for StartNewTask based on API.startNewTask
			configuration: rooCodeSettingsSchema.optional(), // Assuming optional config
			text: z.string().optional(),
			images: z.array(z.string()).optional(),
			newTab: z.boolean().optional(),
			taskId: z.string().optional(), // Allow specifying taskId? Or generate always? Server generates.
		}),
	}),
	z.object({
		commandName: z.literal(CliCommandName.SendMessage),
		data: z.object({
			taskId: z.string(),
			text: z.string(),
			files: z.array(z.string()).optional(),
			mode: z.string().optional(), // Include mode if needed by API.processUserInput
		}),
	}),
	z.object({
		commandName: z.literal(CliCommandName.CancelTask),
		data: z.string(), // taskId
	}),
	z.object({
		commandName: z.literal(CliCommandName.CloseTask),
		data: z.string(), // taskId
	}),
	// Config Commands
	z.object({
		commandName: z.literal(CliCommandName.ConfigList),
		data: z.object({}).optional(), // No params for list
	}),
	z.object({
		commandName: z.literal(CliCommandName.ConfigSave),
		data: z.object({
			// Matches params expected by handleSaveConfig
			name: z.string(),
			config: z.any(), // Keep 'any' for flexibility or define specific config schema
		}),
	}),
	z.object({
		commandName: z.literal(CliCommandName.ConfigLoad),
		data: z.object({
			// Matches params expected by handleLoadConfig
			name: z.string(),
		}),
	}),
	z.object({
		commandName: z.literal(CliCommandName.ConfigDelete),
		data: z.object({
			// Matches params expected by handleDeleteConfig
			name: z.string(),
		}),
	}),
	z.object({
		commandName: z.literal(CliCommandName.ConfigSetMode),
		data: z.object({
			// Matches params expected by handleSetModeConfig
			mode: z.string(),
			configId: z.string(),
		}),
	}),
	z.object({
		commandName: z.literal(CliCommandName.ConfigGetMode),
		data: z.object({
			// Matches params expected by handleGetModeConfig
			mode: z.string(),
		}),
	}),
])

export type CliCommand = z.infer<typeof cliCommandSchema> // Renamed type

/**
 * TaskEvent
 */

// Simplify TaskEvent payload to any[] to avoid complex tuple type issues over IPC
export const taskEventSchema = z.object({
	eventName: z.nativeEnum(RooCodeEventName),
	payload: z.array(z.any()),
})

export type TaskEvent = z.infer<typeof taskEventSchema>

/**
 * IpcMessage
 */

export enum IpcMessageType {
	Connect = "Connect",
	Disconnect = "Disconnect",
	Ack = "Ack",
	CliCommand = "CliCommand", // Renamed from TaskCommand
	TaskEvent = "TaskEvent",
}

export enum IpcOrigin {
	Client = "client",
	Server = "server",
}

export const ipcMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(IpcMessageType.Ack),
		origin: z.literal(IpcOrigin.Server),
		data: ackSchema,
	}),
	z.object({
		type: z.literal(IpcMessageType.CliCommand), // Use renamed type
		origin: z.literal(IpcOrigin.Client),
		clientId: z.string(),
		data: cliCommandSchema, // Use renamed schema
	}),
	z.object({
		type: z.literal(IpcMessageType.TaskEvent),
		origin: z.literal(IpcOrigin.Server),
		relayClientId: z.string().optional(),
		data: taskEventSchema,
	}),
])
export type IpcMessage = z.infer<typeof ipcMessageSchema>

// Re-export RooCodeEventName so it can be imported from this module
export { RooCodeEventName }
