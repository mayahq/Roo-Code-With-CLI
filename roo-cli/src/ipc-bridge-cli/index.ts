#!/usr/bin/env node

import { Command } from "commander"
import * as fs from "fs"
import ipc from "node-ipc"
import * as os from "os"
import * as path from "path"

const program = new Command()

// IPC server ID
const SERVER_ID = "roo-config-bridge"

// Socket path
const getSocketPath = (): string => {
	const tmpDir = os.tmpdir()
	return path.join(tmpDir, `${SERVER_ID}.sock`)
}

// Default configuration
const CONFIG_FILE_PATH = path.join(os.homedir(), ".config", "roo", "cli.json")

// Ensure config directory exists
const configDir = path.dirname(CONFIG_FILE_PATH)
if (!fs.existsSync(configDir)) {
	fs.mkdirSync(configDir, { recursive: true })
}

// Load configuration
let config: { secret?: string } = {}
try {
	if (fs.existsSync(CONFIG_FILE_PATH)) {
		const configContent = fs.readFileSync(CONFIG_FILE_PATH, "utf-8")
		config = JSON.parse(configContent)
	}
} catch (error) {
	console.error(`Error loading config file: ${error}`)
}

// Get secret from environment variables, command line, or config file
const getSecret = (): string => {
	return process.env.ROO_BRIDGE_SECRET || program.opts().secret || config.secret || ""
}

// Save configuration
const saveConfig = (secret: string): void => {
	const newConfig = { ...config, secret }
	fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(newConfig, null, 2))
	console.log(`Configuration saved to ${CONFIG_FILE_PATH}`)
}

// Configure IPC
const configureIpc = () => {
	ipc.config.id = "roo-config-cli"
	ipc.config.retry = 1500
	ipc.config.silent = true
}

// Send a command to the IPC server and get the response
const sendCommand = (command: string, params: any = {}): Promise<any> => {
	return new Promise((resolve, reject) => {
		configureIpc()
		const socketPath = getSocketPath()

		// Check if socket exists
		if (!fs.existsSync(socketPath)) {
			reject(
				new Error(
					`IPC socket not found at ${socketPath}. Make sure the VS Code extension is running and the bridge is enabled.`,
				),
			)
			return
		}

		// Connect to the server
		ipc.connectTo(SERVER_ID, socketPath, () => {
			// Add message listener
			ipc.of[SERVER_ID].on("message", (data: string) => {
				try {
					const response = JSON.parse(data)

					// Check for error
					if (response.error) {
						reject(new Error(response.error))
						return
					}

					resolve(response)
				} catch (error) {
					reject(
						new Error(
							`Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
						),
					)
				} finally {
					// Disconnect after receiving response
					ipc.disconnect(SERVER_ID)
				}
			})

			// Add error listener
			ipc.of[SERVER_ID].on("error", (err: Error) => {
				reject(new Error(`IPC connection error: ${err.message}`))
				ipc.disconnect(SERVER_ID)
			})

			// Add connect listener
			ipc.of[SERVER_ID].on("connect", () => {
				// Send the command
				const message = {
					command,
					params,
				}

				ipc.of[SERVER_ID].emit("message", JSON.stringify(message))
			})
		})
	})
}

// Define the CLI
program
	.name("roo-config")
	.description("CLI tool for managing Roo VS Code extension configurations")
	.version("1.0.0")
	.option("-s, --secret <token>", "Secret token for authentication")
	.option("--save-config", "Save secret to config file")

// List command
program
	.command("list")
	.description("List all available configuration profiles")
	.action(async () => {
		try {
			const response = await sendCommand("list")
			const { configs } = response

			if (configs.length === 0) {
				console.log("No configuration profiles found.")
			} else {
				console.log("Available configuration profiles:")
				configs.forEach((config: any) => {
					console.log(`- ${config.name} (ID: ${config.id}, Provider: ${config.apiProvider || "not set"})`)
				})
			}

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(getSecret())
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}
	})

// Save command
program
	.command("save <profile-name>")
	.description("Save or update a configuration profile")
	.option("--provider <name>", "API provider name")
	.option("--apiKey <key>", "API key")
	.option("--from-file <path>", "Load configuration from a JSON file")
	.option("--json <json_string>", "Configuration as a JSON string")
	.action(async (profileName, options) => {
		try {
			let config: any = {}

			if (options.fromFile) {
				try {
					const fileContent = fs.readFileSync(options.fromFile, "utf-8")
					config = JSON.parse(fileContent)
				} catch (error) {
					console.error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`)
					process.exit(1)
				}
			} else if (options.json) {
				try {
					config = JSON.parse(options.json)
				} catch (error) {
					console.error(`Error parsing JSON: ${error instanceof Error ? error.message : String(error)}`)
					process.exit(1)
				}
			} else {
				// Build config from individual options
				if (options.provider) {
					config.apiProvider = options.provider
				}
				if (options.apiKey) {
					config.apiKey = options.apiKey
				}
			}

			await sendCommand("save", { name: profileName, config })
			console.log(`Configuration '${profileName}' saved successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(getSecret())
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}
	})

// Load command
program
	.command("load <profile-name>")
	.description("Load and activate a configuration profile")
	.action(async (profileName) => {
		try {
			await sendCommand("load", { name: profileName })
			console.log(`Configuration '${profileName}' loaded successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(getSecret())
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}
	})

// Delete command
program
	.command("delete <profile-name>")
	.description("Delete a configuration profile")
	.action(async (profileName) => {
		try {
			await sendCommand("delete", { name: profileName })
			console.log(`Configuration '${profileName}' deleted successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(getSecret())
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}
	})

// Assign mode command
program
	.command("assign-mode <mode-slug> <profile-id-or-name>")
	.description("Assign a configuration profile to a mode")
	.action(async (modeSlug, profileIdOrName) => {
		try {
			// First check if the profile ID is a name, and if so, get its ID
			let configId = profileIdOrName

			// If it looks like a name (not a random ID), try to get the ID
			if (!profileIdOrName.match(/^[a-z0-9]{8,}$/)) {
				try {
					const response = await sendCommand("list")
					const { configs } = response
					const config = configs.find((c: any) => c.name === profileIdOrName)

					if (config) {
						configId = config.id
					} else {
						console.error(`Configuration profile '${profileIdOrName}' not found.`)
						process.exit(1)
					}
				} catch (error) {
					console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
					process.exit(1)
				}
			}

			await sendCommand("setMode", { mode: modeSlug, configId })
			console.log(`Mode '${modeSlug}' assigned to configuration '${profileIdOrName}' successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(getSecret())
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}
	})

// Get mode command
program
	.command("get-mode <mode-slug>")
	.description("Get the configuration profile assigned to a mode")
	.action(async (modeSlug) => {
		try {
			const response = await sendCommand("getMode", { mode: modeSlug })
			const { configId } = response

			if (configId) {
				console.log(`Mode '${modeSlug}' is assigned to configuration ID: ${configId}`)

				// Try to get the name of the configuration
				try {
					const listResponse = await sendCommand("list")
					const { configs } = listResponse
					const config = configs.find((c: any) => c.id === configId)

					if (config) {
						console.log(`Configuration name: ${config.name}`)
					}
				} catch (error) {
					// Ignore error, just don't show the name
				}
			} else {
				console.log(`Mode '${modeSlug}' is not assigned to any configuration.`)
			}

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(getSecret())
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}
	})

// Parse command line arguments
program.parse(process.argv)

// If no command is provided, show help
if (!process.argv.slice(2).length) {
	program.outputHelp()
}
