#!/usr/bin/env node

import { Command } from "commander"
import fs from "fs"
import os from "os"
import path from "path"
import readline from "readline"

const program = new Command()

// VS Code variants
const VS_CODE_VARIANTS = [
	"Code", // Regular VS Code
	"Code - Insiders", // VS Code Insiders
	"VSCodium", // VSCodium
	"VSCode", // Alternative name
]

// VS Code storage locations
const getPossibleVSCodePaths = (): string[] => {
	const homeDir = os.homedir()
	const paths = []

	// Different paths based on OS
	if (process.platform === "darwin") {
		// macOS
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(
				path.join(
					homeDir,
					"Library",
					"Application Support",
					variant,
					"User",
					"globalStorage",
					"rooveterinaryinc.roo-cline-with-cli",
				),
			)
		}
	} else if (process.platform === "win32") {
		// Windows
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(
				path.join(
					homeDir,
					"AppData",
					"Roaming",
					variant,
					"User",
					"globalStorage",
					"rooveterinaryinc.roo-cline-with-cli",
				),
			)
		}
	} else {
		// Linux and others
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(
				path.join(homeDir, ".config", variant, "User", "globalStorage", "rooveterinaryinc.roo-cline-with-cli"),
			)
		}
	}

	return paths
}

// Get the secrets storage paths
const getPossibleSecretsPaths = (): string[] => {
	const homeDir = os.homedir()
	const paths = []

	// Different paths based on OS
	if (process.platform === "darwin") {
		// macOS
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(
				path.join(
					homeDir,
					"Library",
					"Application Support",
					variant,
					"User",
					"secrets",
					"rooveterinaryinc.roo-cline-with-cli",
				),
			)
		}
	} else if (process.platform === "win32") {
		// Windows
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(
				path.join(
					homeDir,
					"AppData",
					"Roaming",
					variant,
					"User",
					"secrets",
					"rooveterinaryinc.roo-cline-with-cli",
				),
			)
		}
	} else {
		// Linux and others
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(path.join(homeDir, ".config", variant, "User", "secrets", "rooveterinaryinc.roo-cline-with-cli"))
		}
	}

	return paths
}

// Find the first existing path
const findExistingPath = (paths: string[]): string | null => {
	for (const p of paths) {
		if (fs.existsSync(p)) {
			return p
		}
	}
	return null
}

// The key used by ProviderSettingsManager
const CONFIG_KEY = "roo_cline_config_api_config"

// Default provider profiles
const DEFAULT_PROVIDER_PROFILES = {
	currentApiConfigName: "default",
	apiConfigs: {
		default: {
			id: "default-id",
			apiProvider: "openai",
		},
	},
	modeApiConfigs: {},
}

// Ask a yes/no question
const askQuestion = async (question: string): Promise<boolean> => {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes")
		})
	})
}

// Load provider profiles from VS Code storage
const loadProviderProfiles = async (): Promise<any> => {
	try {
		const secretsPaths = getPossibleSecretsPaths()
		const secretsPath = findExistingPath(secretsPaths)

		// Check if any secrets directory exists
		if (!secretsPath) {
			console.error(`VS Code secrets directory not found. Tried:`)
			secretsPaths.forEach((p) => console.error(`  - ${p}`))
			console.error("Make sure Roo Code With CLI extension is installed and has been used at least once.")
			console.error("If you're using a different VS Code variant, please report this issue.")

			// Ask if the user wants to create a default configuration
			const createDefault = await askQuestion("Would you like to create a default configuration? (y/n) ")

			if (createDefault) {
				// Create the directory structure
				const storagePaths = getPossibleVSCodePaths()
				const storagePath = storagePaths[0] // Use the first path

				try {
					fs.mkdirSync(storagePath, { recursive: true })
					fs.mkdirSync(secretsPaths[0], { recursive: true })

					// Create a default configuration
					const configFile = path.join(secretsPaths[0], "default-config")
					const data = {
						key: CONFIG_KEY,
						value: JSON.stringify(DEFAULT_PROVIDER_PROFILES),
					}

					fs.writeFileSync(configFile, JSON.stringify(data, null, 2))
					console.log(`Created default configuration at ${configFile}`)
					console.log("Please restart the command to use the new configuration.")
				} catch (error) {
					console.error(`Error creating default configuration: ${error}`)
				}
			}

			process.exit(1)
		}

		// Find the file containing our config
		const files = fs.readdirSync(secretsPath)
		let configFile = null

		for (const file of files) {
			// The file name is a hash of the key
			const filePath = path.join(secretsPath, file)
			const content = fs.readFileSync(filePath, "utf-8")

			try {
				const data = JSON.parse(content)
				if (data.key === CONFIG_KEY) {
					configFile = filePath
					break
				}
			} catch (e) {
				// Skip files that aren't valid JSON
			}
		}

		if (!configFile) {
			console.error(`Configuration not found in VS Code secrets storage at ${secretsPath}.`)
			console.error("Make sure Roo Code With CLI extension is installed and has been used at least once.")
			process.exit(1)
		}

		// Read and decrypt the config
		const content = fs.readFileSync(configFile, "utf-8")
		const data = JSON.parse(content)

		// The value is stored as JSON
		return JSON.parse(data.value)
	} catch (error) {
		console.error(`Error loading provider profiles: ${error}`)
		process.exit(1)
	}
}

// Save provider profiles to VS Code storage
const saveProviderProfiles = (providerProfiles: any): void => {
	try {
		const secretsPaths = getPossibleSecretsPaths()
		const secretsPath = findExistingPath(secretsPaths)

		// Check if any secrets directory exists
		if (!secretsPath) {
			console.error(`VS Code secrets directory not found. Tried:`)
			secretsPaths.forEach((p) => console.error(`  - ${p}`))
			console.error("Make sure Roo Code With CLI extension is installed and has been used at least once.")
			process.exit(1)
		}

		// Find the file containing our config
		const files = fs.readdirSync(secretsPath)
		let configFile = null

		for (const file of files) {
			// The file name is a hash of the key
			const filePath = path.join(secretsPath, file)
			const content = fs.readFileSync(filePath, "utf-8")

			try {
				const data = JSON.parse(content)
				if (data.key === CONFIG_KEY) {
					configFile = filePath
					break
				}
			} catch (e) {
				// Skip files that aren't valid JSON
			}
		}

		if (!configFile) {
			console.error(`Configuration not found in VS Code secrets storage at ${secretsPath}.`)
			console.error("Make sure Roo Code With CLI extension is installed and has been used at least once.")
			process.exit(1)
		}

		// Read the current config
		const content = fs.readFileSync(configFile, "utf-8")
		const data = JSON.parse(content)

		// Update the value
		data.value = JSON.stringify(providerProfiles)

		// Write back to the file
		fs.writeFileSync(configFile, JSON.stringify(data, null, 2))

		console.log(`Configuration saved to ${configFile}`)
	} catch (error) {
		console.error(`Error saving provider profiles: ${error}`)
		process.exit(1)
	}
}

// Define the CLI
program.name("roo-config").description("CLI tool for managing Roo VS Code extension configurations").version("1.0.0")

// List command
program
	.command("list")
	.description("List all available configuration profiles")
	.action(async () => {
		const providerProfiles = await loadProviderProfiles()
		const configs = Object.entries(providerProfiles.apiConfigs).map(([name, config]: [string, any]) => ({
			name,
			id: config.id,
			apiProvider: config.apiProvider,
		}))

		if (configs.length === 0) {
			console.log("No configuration profiles found.")
		} else {
			console.log("Available configuration profiles:")
			configs.forEach((config: any) => {
				console.log(`- ${config.name} (ID: ${config.id}, Provider: ${config.apiProvider || "not set"})`)
			})

			// Show current config
			console.log(`\nCurrent active configuration: ${providerProfiles.currentApiConfigName}`)
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
		const providerProfiles = await loadProviderProfiles()

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

		// Preserve the existing ID if this is an update to an existing config
		const existingId = providerProfiles.apiConfigs[profileName]?.id
		providerProfiles.apiConfigs[profileName] = {
			...config,
			id: config.id || existingId || `${profileName}-${Date.now()}`,
		}

		saveProviderProfiles(providerProfiles)
		console.log(`Configuration '${profileName}' saved successfully.`)
	})

// Load command
program
	.command("load <profile-name>")
	.description("Load and activate a configuration profile")
	.action(async (profileName) => {
		const providerProfiles = await loadProviderProfiles()

		if (!providerProfiles.apiConfigs[profileName]) {
			console.error(`Configuration '${profileName}' not found`)
			process.exit(1)
		}

		providerProfiles.currentApiConfigName = profileName
		saveProviderProfiles(providerProfiles)
		console.log(`Configuration '${profileName}' loaded successfully.`)
	})

// Delete command
program
	.command("delete <profile-name>")
	.description("Delete a configuration profile")
	.action(async (profileName) => {
		const providerProfiles = await loadProviderProfiles()

		if (!providerProfiles.apiConfigs[profileName]) {
			console.error(`Configuration '${profileName}' not found`)
			process.exit(1)
		}

		// Check if it's the last config
		if (Object.keys(providerProfiles.apiConfigs).length <= 1) {
			console.error("Cannot delete the last remaining configuration")
			process.exit(1)
		}

		// Delete config
		delete providerProfiles.apiConfigs[profileName]

		// Reset current config if needed
		if (providerProfiles.currentApiConfigName === profileName) {
			providerProfiles.currentApiConfigName = Object.keys(providerProfiles.apiConfigs)[0]
		}

		saveProviderProfiles(providerProfiles)
		console.log(`Configuration '${profileName}' deleted successfully.`)
	})

// Assign mode command
program
	.command("assign-mode <mode-slug> <profile-id-or-name>")
	.description("Assign a configuration profile to a mode")
	.action(async (modeSlug, profileIdOrName) => {
		const providerProfiles = await loadProviderProfiles()

		// First check if the profile ID is a name, and if so, get its ID
		let configId = profileIdOrName

		// If it looks like a name (not a random ID), try to get the ID
		if (!profileIdOrName.match(/^[a-z0-9]{8,}$/)) {
			const config = Object.entries(providerProfiles.apiConfigs).find(([name, _]) => name === profileIdOrName)

			if (config) {
				configId = (config[1] as any).id
			} else {
				console.error(`Configuration profile '${profileIdOrName}' not found.`)
				process.exit(1)
			}
		}

		// Initialize modeApiConfigs if it doesn't exist
		if (!providerProfiles.modeApiConfigs) {
			providerProfiles.modeApiConfigs = {}
		}

		// Set mode config
		providerProfiles.modeApiConfigs[modeSlug] = configId

		saveProviderProfiles(providerProfiles)
		console.log(`Mode '${modeSlug}' assigned to configuration '${profileIdOrName}' successfully.`)
	})

// Get mode command
program
	.command("get-mode <mode-slug>")
	.description("Get the configuration profile assigned to a mode")
	.action(async (modeSlug) => {
		const providerProfiles = await loadProviderProfiles()

		// Initialize modeApiConfigs if it doesn't exist
		if (!providerProfiles.modeApiConfigs) {
			providerProfiles.modeApiConfigs = {}
		}

		const configId = providerProfiles.modeApiConfigs[modeSlug]

		if (configId) {
			console.log(`Mode '${modeSlug}' is assigned to configuration ID: ${configId}`)

			// Try to get the name of the configuration
			const config = Object.entries(providerProfiles.apiConfigs).find(
				([_, value]) => (value as any).id === configId,
			)

			if (config) {
				console.log(`Configuration name: ${config[0]}`)
			}
		} else {
			console.log(`Mode '${modeSlug}' is not assigned to any configuration.`)
		}
	})

// Parse command line arguments
program.parse(process.argv)

// If no command is provided, show help
if (!process.argv.slice(2).length) {
	program.outputHelp()
}
