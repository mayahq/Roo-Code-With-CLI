#!/usr/bin/env node
import * as fsp from "fs/promises" // Import fs/promises for async file operations
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { startRepl } from "./core/repl.js" // Assuming .js extension for compiled output
import * as vsCodeStorage from "./utils/vscode-storage.js" // Assuming .js extension

// Helper function to get the secrets path, handling errors
async function getSecretsPathOrExit(): Promise<string> {
	const secretsPath = vsCodeStorage.findExtensionSecretsPath()
	if (!secretsPath) {
		console.error(
			"Error: Could not find VS Code secrets directory for mayalabs.roo-code-with-cli.",
			"Please ensure the extension is installed and has saved a configuration at least once.",
		)
		process.exit(1)
	}
	return secretsPath
}

yargs(hideBin(process.argv))
	// Default command: Start the REPL
	.command(
		"$0", // Match when no command is specified
		"Start the interactive Roo REPL session.",
		(yargs) => {
			return yargs.option("yes", {
				alias: "y",
				type: "boolean",
				description: "Automatically confirm potentially destructive actions (if any in REPL)",
				default: false,
			})
		},
		async (argv) => {
			console.log("Roo CLI starting interactive session...")
			if (argv.yes) {
				console.log("Running in non-interactive mode (--yes).")
			}
			try {
				await startRepl({ skipConfirmation: argv.yes })
			} catch (error) {
				console.error("An error occurred during the REPL session:", error)
				process.exit(1)
			}
		},
	)
	// Config command
	.command(
		"config <subcommand>",
		"Manage Roo Code With CLI API configurations.",
		(yargs) => {
			return yargs
				.command(
					"list",
					"List all available configuration profiles.",
					{}, // No specific options for list
					async () => {
						try {
							const secretsPath = await getSecretsPathOrExit()
							const providerProfiles = await vsCodeStorage.loadProviderProfiles(secretsPath)
							const configs = Object.entries(providerProfiles.apiConfigs || {}).map(
								([name, config]: [string, any]) => ({
									name,
									id: config.id,
									apiProvider: config.apiProvider,
								}),
							)

							if (configs.length === 0) {
								console.log("No configuration profiles found.")
							} else {
								console.log("Available configuration profiles:")
								configs.forEach((config: any) => {
									console.log(
										`- ${config.name} (ID: ${config.id}, Provider: ${config.apiProvider || "not set"})`,
									)
								})
								console.log(
									`\nCurrent active configuration: ${providerProfiles.currentApiConfigName || "none"}`,
								)
							}
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error)
							console.error("Error listing configurations:", message)
							process.exit(1)
						}
					},
				)
				.command(
					"save <profile-name>",
					"Save or update a configuration profile.",
					(yargs) => {
						return yargs
							.positional("profile-name", {
								describe: "The name for the configuration profile",
								type: "string",
								demandOption: true,
							})
							.option("provider", {
								describe: "API provider name (e.g., openai, anthropic)",
								type: "string",
							})
							.option("apiKey", {
								describe: "API key for the provider",
								type: "string",
							})
							.option("model", {
								describe: "Specific model ID to use",
								type: "string",
							}) // Add other relevant config options here
							.option("from-file", {
								describe: "Load configuration from a JSON file path",
								type: "string",
							})
							.option("json", {
								describe: "Configuration as a JSON string",
								type: "string",
							})
							.conflicts("from-file", "json")
							.conflicts("from-file", ["provider", "apiKey", "model"])
							.conflicts("json", ["provider", "apiKey", "model"])
					},
					async (argv) => {
						try {
							const secretsPath = await getSecretsPathOrExit()
							const providerProfiles = await vsCodeStorage
								.loadProviderProfiles(secretsPath)
								.catch(() => ({
									// If loading fails (e.g., first time), start with an empty structure
									currentApiConfigName: null,
									apiConfigs: {},
									modeApiConfigs: {},
								}))

							let newConfigData: any = {}

							if (argv.fromFile) {
								try {
									const fileContent = await fsp.readFile(argv.fromFile, "utf-8")
									newConfigData = JSON.parse(fileContent)
								} catch (error: unknown) {
									const message = error instanceof Error ? error.message : String(error)
									console.error(`Error reading file ${argv.fromFile}: ${message}`)
									process.exit(1)
								}
							} else if (argv.json) {
								try {
									newConfigData = JSON.parse(argv.json)
								} catch (error: unknown) {
									const message = error instanceof Error ? error.message : String(error)
									console.error(`Error parsing JSON string: ${message}`)
									process.exit(1)
								}
							} else {
								// Build config from individual options
								if (argv.provider) newConfigData.apiProvider = argv.provider
								if (argv.apiKey) newConfigData.apiKey = argv.apiKey
								if (argv.model) newConfigData.model = argv.model
								// Add assignments for other options if needed
							}

							if (Object.keys(newConfigData).length === 0 && !argv.fromFile && !argv.json) {
								console.error("Error: No configuration options provided for saving.")
								console.error("Use --provider, --apiKey, --model, --from-file, or --json.")
								process.exit(1)
							}

							const profileName = argv.profileName as string
							const existingConfig = providerProfiles.apiConfigs?.[profileName]
							const existingId = existingConfig?.id

							// Ensure apiConfigs exists
							if (!providerProfiles.apiConfigs) {
								providerProfiles.apiConfigs = {}
							}

							providerProfiles.apiConfigs[profileName] = {
								...existingConfig, // Keep existing fields not overwritten
								...newConfigData, // Overwrite with new data
								id: newConfigData.id || existingId || `${profileName}-${Date.now()}`, // Preserve or generate ID
							}

							// If this is the first config being saved, make it the current one
							if (!providerProfiles.currentApiConfigName) {
								providerProfiles.currentApiConfigName = profileName
							}

							await vsCodeStorage.saveProviderProfiles(secretsPath, providerProfiles)
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error)
							console.error(`Error saving configuration '${argv.profileName}':`, message)
							process.exit(1)
						}
					},
				)
				.command(
					"load <profile-name>",
					"Load and activate a configuration profile.",
					(yargs) => {
						return yargs.positional("profile-name", {
							describe: "The name of the profile to activate",
							type: "string",
							demandOption: true,
						})
					},
					async (argv) => {
						try {
							const secretsPath = await getSecretsPathOrExit()
							const providerProfiles = await vsCodeStorage.loadProviderProfiles(secretsPath)
							const profileName = argv.profileName as string

							if (!providerProfiles.apiConfigs || !providerProfiles.apiConfigs[profileName]) {
								console.error(`Error: Configuration profile '${profileName}' not found.`)
								process.exit(1)
							}

							providerProfiles.currentApiConfigName = profileName
							await vsCodeStorage.saveProviderProfiles(secretsPath, providerProfiles)
							console.log(`Configuration '${profileName}' activated successfully.`)
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error)
							console.error(`Error loading configuration '${argv.profileName}':`, message)
							process.exit(1)
						}
					},
				)
				.command(
					"delete <profile-name>",
					"Delete a configuration profile.",
					(yargs) => {
						return yargs.positional("profile-name", {
							describe: "The name of the profile to delete",
							type: "string",
							demandOption: true,
						})
					},
					async (argv) => {
						try {
							const secretsPath = await getSecretsPathOrExit()
							const providerProfiles = await vsCodeStorage.loadProviderProfiles(secretsPath)
							const profileName = argv.profileName as string

							if (!providerProfiles.apiConfigs || !providerProfiles.apiConfigs[profileName]) {
								console.error(`Error: Configuration profile '${profileName}' not found.`)
								process.exit(1)
							}

							if (Object.keys(providerProfiles.apiConfigs).length <= 1) {
								console.error("Error: Cannot delete the last remaining configuration profile.")
								process.exit(1)
							}

							delete providerProfiles.apiConfigs[profileName]

							// If the deleted profile was the current one, set current to the first available
							if (providerProfiles.currentApiConfigName === profileName) {
								providerProfiles.currentApiConfigName = Object.keys(providerProfiles.apiConfigs)[0]
							}

							// Also remove any mode assignments pointing to the deleted profile's ID (optional but good practice)
							// This requires knowing the ID before deleting, so we fetch it first
							// Note: This part is omitted for simplicity, but could be added by finding the ID before delete.

							await vsCodeStorage.saveProviderProfiles(secretsPath, providerProfiles)
							console.log(`Configuration '${profileName}' deleted successfully.`)
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error)
							console.error(`Error deleting configuration '${argv.profileName}':`, message)
							process.exit(1)
						}
					},
				)
				.command(
					"assign-mode <mode-slug> <profile-name>",
					"Assign a configuration profile to a specific mode.",
					(yargs) => {
						return yargs
							.positional("mode-slug", {
								describe: "The slug of the mode (e.g., code, architect)",
								type: "string",
								demandOption: true,
							})
							.positional("profile-name", {
								describe: "The name of the configuration profile to assign",
								type: "string",
								demandOption: true,
							})
					},
					async (argv) => {
						try {
							const secretsPath = await getSecretsPathOrExit()
							const providerProfiles = await vsCodeStorage.loadProviderProfiles(secretsPath)
							const modeSlug = argv.modeSlug as string
							const profileName = argv.profileName as string

							const targetConfig = providerProfiles.apiConfigs?.[profileName]
							if (!targetConfig) {
								console.error(`Error: Configuration profile '${profileName}' not found.`)
								process.exit(1)
							}
							const configId = targetConfig.id

							if (!providerProfiles.modeApiConfigs) {
								providerProfiles.modeApiConfigs = {}
							}

							providerProfiles.modeApiConfigs[modeSlug] = configId
							await vsCodeStorage.saveProviderProfiles(secretsPath, providerProfiles)
							console.log(
								`Mode '${modeSlug}' assigned to configuration '${profileName}' (ID: ${configId}).`,
							)
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error)
							console.error(
								`Error assigning mode '${argv.modeSlug}' to profile '${argv.profileName}':`,
								message,
							)
							process.exit(1)
						}
					},
				)
				.command(
					"get-mode <mode-slug>",
					"Get the configuration profile assigned to a mode.",
					(yargs) => {
						return yargs.positional("mode-slug", {
							describe: "The slug of the mode",
							type: "string",
							demandOption: true,
						})
					},
					async (argv) => {
						try {
							const secretsPath = await getSecretsPathOrExit()
							const providerProfiles = await vsCodeStorage.loadProviderProfiles(secretsPath)
							const modeSlug = argv.modeSlug as string

							const configId = providerProfiles.modeApiConfigs?.[modeSlug]

							if (configId) {
								// Find the profile name associated with the ID
								const profileEntry = Object.entries(providerProfiles.apiConfigs || {}).find(
									([_, config]: [string, any]) => config.id === configId,
								)
								const profileName = profileEntry ? profileEntry[0] : "<deleted profile>"
								console.log(
									`Mode '${modeSlug}' is assigned to configuration: '${profileName}' (ID: ${configId})`,
								)
							} else {
								console.log(
									`Mode '${modeSlug}' is not assigned to any specific configuration. It will use the default active profile ('${providerProfiles.currentApiConfigName || "none"}').`,
								)
							}
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error)
							console.error(`Error getting mode assignment for '${argv.modeSlug}':`, message)
							process.exit(1)
						}
					},
				)
				.demandCommand(
					1,
					"Please specify a config subcommand (list, save, load, delete, assign-mode, get-mode).",
				)
				.strict() // Ensure only defined subcommands are used
				.help()
		} /* No handler needed here, demandCommand below handles it */,
	)
	.help()
	.alias("help", "h")
	.version()
	.alias("version", "v")
	.strict() // Apply strict mode to the top level as well
	.demandCommand(0, "") // Allows running without any command (defaults to $0)
	.parse() // Execute yargs
