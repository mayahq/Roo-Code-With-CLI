#!/usr/bin/env node

import axios from "axios"
import { Command } from "commander"
import fs from "fs"
import os from "os"
import path from "path"

const program = new Command()

// Default configuration
const DEFAULT_PORT = 30001
const CONFIG_FILE_PATH = path.join(os.homedir(), ".config", "roo", "cli.json")

// Ensure config directory exists
const configDir = path.dirname(CONFIG_FILE_PATH)
if (!fs.existsSync(configDir)) {
	fs.mkdirSync(configDir, { recursive: true })
}

// Load configuration
let config: { port?: number; secret?: string } = {}
try {
	if (fs.existsSync(CONFIG_FILE_PATH)) {
		const configContent = fs.readFileSync(CONFIG_FILE_PATH, "utf-8")
		config = JSON.parse(configContent)
	}
} catch (error) {
	console.error(`Error loading config file: ${error}`)
}

// Get port and secret from environment variables, command line, or config file
const getPort = (): number => {
	return parseInt(process.env.ROO_BRIDGE_PORT || "") || program.opts().port || config.port || DEFAULT_PORT
}

const getSecret = (): string => {
	return process.env.ROO_BRIDGE_SECRET || program.opts().secret || config.secret || ""
}

// Save configuration
const saveConfig = (port: number, secret: string): void => {
	const newConfig = { ...config, port, secret }
	fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(newConfig, null, 2))
	console.log(`Configuration saved to ${CONFIG_FILE_PATH}`)
}

// Create HTTP client
const createClient = (port: number, secret: string) => {
	const client = axios.create({
		baseURL: `http://localhost:${port}`,
		headers: {
			"Content-Type": "application/json",
			...(secret ? { "X-Roo-Bridge-Secret": secret } : {}),
		},
	})

	// Add response interceptor for error handling
	client.interceptors.response.use(
		(response) => response,
		(error) => {
			if (error.response) {
				// The request was made and the server responded with a status code
				// that falls out of the range of 2xx
				console.error(`Error: ${error.response.data.error || "Unknown error"}`)
			} else if (error.request) {
				// The request was made but no response was received
				console.error("Error: No response received from Roo VS Code extension.")
				console.error("Make sure the VS Code extension is running and the bridge is enabled.")
				console.error(`Check the bridge settings in VS Code: roo.bridge.enabled, roo.bridge.port (${port})`)
			} else {
				// Something happened in setting up the request that triggered an Error
				console.error(`Error: ${error.message}`)
			}
			process.exit(1)
		},
	)

	return client
}

// Define the CLI
program
	.name("roo-config")
	.description("CLI tool for managing Roo VS Code extension configurations")
	.version("1.0.0")
	.option("-p, --port <number>", "Port for the Roo Configuration Bridge server")
	.option("-s, --secret <token>", "Secret token for authentication")
	.option("--save-config", "Save port and secret to config file")

// List command
program
	.command("list")
	.description("List all available configuration profiles")
	.action(async () => {
		const port = getPort()
		const secret = getSecret()
		const client = createClient(port, secret)

		try {
			const response = await client.get("/config/list")
			const { configs } = response.data

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
				saveConfig(port, secret)
			}
		} catch (error) {
			// Error is handled by axios interceptor
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
		const port = getPort()
		const secret = getSecret()
		const client = createClient(port, secret)

		let config: any = {}

		if (options.fromFile) {
			try {
				const fileContent = fs.readFileSync(options.fromFile, "utf-8")
				config = JSON.parse(fileContent)
			} catch (error) {
				console.error(`Error reading file: ${error}`)
				process.exit(1)
			}
		} else if (options.json) {
			try {
				config = JSON.parse(options.json)
			} catch (error) {
				console.error(`Error parsing JSON: ${error}`)
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

		try {
			await client.post("/config/save", { name: profileName, config })
			console.log(`Configuration '${profileName}' saved successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(port, secret)
			}
		} catch (error) {
			// Error is handled by axios interceptor
		}
	})

// Load command
program
	.command("load <profile-name>")
	.description("Load and activate a configuration profile")
	.action(async (profileName) => {
		const port = getPort()
		const secret = getSecret()
		const client = createClient(port, secret)

		try {
			await client.post("/config/load", { name: profileName })
			console.log(`Configuration '${profileName}' loaded successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(port, secret)
			}
		} catch (error) {
			// Error is handled by axios interceptor
		}
	})

// Delete command
program
	.command("delete <profile-name>")
	.description("Delete a configuration profile")
	.action(async (profileName) => {
		const port = getPort()
		const secret = getSecret()
		const client = createClient(port, secret)

		try {
			await client.post("/config/delete", { name: profileName })
			console.log(`Configuration '${profileName}' deleted successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(port, secret)
			}
		} catch (error) {
			// Error is handled by axios interceptor
		}
	})

// Assign mode command
program
	.command("assign-mode <mode-slug> <profile-id-or-name>")
	.description("Assign a configuration profile to a mode")
	.action(async (modeSlug, profileIdOrName) => {
		const port = getPort()
		const secret = getSecret()
		const client = createClient(port, secret)

		try {
			// First check if the profile ID is a name, and if so, get its ID
			let configId = profileIdOrName

			// If it looks like a name (not a random ID), try to get the ID
			if (!profileIdOrName.match(/^[a-z0-9]{8,}$/)) {
				try {
					const response = await client.get("/config/list")
					const { configs } = response.data
					const config = configs.find((c: any) => c.name === profileIdOrName)

					if (config) {
						configId = config.id
					} else {
						console.error(`Configuration profile '${profileIdOrName}' not found.`)
						process.exit(1)
					}
				} catch (error) {
					// Error is handled by axios interceptor
				}
			}

			await client.post("/config/setMode", { mode: modeSlug, configId })
			console.log(`Mode '${modeSlug}' assigned to configuration '${profileIdOrName}' successfully.`)

			// Save config if requested
			if (program.opts().saveConfig) {
				saveConfig(port, secret)
			}
		} catch (error) {
			// Error is handled by axios interceptor
		}
	})

// Get mode command
program
	.command("get-mode <mode-slug>")
	.description("Get the configuration profile assigned to a mode")
	.action(async (modeSlug) => {
		const port = getPort()
		const secret = getSecret()
		const client = createClient(port, secret)

		try {
			const response = await client.get(`/config/getMode?mode=${modeSlug}`)
			const { configId } = response.data

			if (configId) {
				console.log(`Mode '${modeSlug}' is assigned to configuration ID: ${configId}`)

				// Try to get the name of the configuration
				try {
					const listResponse = await client.get("/config/list")
					const { configs } = listResponse.data
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
				saveConfig(port, secret)
			}
		} catch (error) {
			// Error is handled by axios interceptor
		}
	})

// Parse command line arguments
program.parse(process.argv)

// If no command is provided, show help
if (!process.argv.slice(2).length) {
	program.outputHelp()
}
