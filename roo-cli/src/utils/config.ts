import fs from "fs/promises"
import os from "os"
import path from "path"

// Define the structure of the configuration file
interface RooConfig {
	apiKey?: string
	model?: string
	// Add other configuration options here as needed
}

// Path to the configuration file
const configDir = path.join(os.homedir(), ".config", "roo")
const configFile = path.join(configDir, "config.json")

// Default configuration
const defaultConfig: RooConfig = {
	apiKey: undefined, // User must provide API key
	model: "default-model-name", // Default model name
}

let loadedConfig: RooConfig | null = null

/**
 * Loads the Roo CLI configuration from the config file.
 * If the file doesn't exist, it creates a default one.
 * Caches the loaded configuration.
 */
export async function loadConfig(): Promise<RooConfig> {
	if (loadedConfig) {
		return loadedConfig
	}

	try {
		await fs.access(configFile) // Check if file exists
	} catch (error) {
		// File doesn't exist, create it with default values
		try {
			await fs.mkdir(configDir, { recursive: true })
			await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2), "utf-8")
			console.log(`Created default configuration file at: ${configFile}`)
			loadedConfig = defaultConfig
			return loadedConfig
		} catch (writeError) {
			console.error(`Error creating configuration file: ${writeError}`)
			// Fallback to default config in memory if file creation fails
			loadedConfig = defaultConfig
			return loadedConfig
		}
	}

	// File exists, read and parse it
	try {
		const fileContent = await fs.readFile(configFile, "utf-8")
		loadedConfig = JSON.parse(fileContent) as RooConfig
		// Merge with defaults to ensure all keys are present
		loadedConfig = { ...defaultConfig, ...loadedConfig }
		return loadedConfig
	} catch (error) {
		console.error(`Error reading or parsing configuration file: ${error}`)
		// Fallback to default config if reading/parsing fails
		loadedConfig = defaultConfig
		return loadedConfig
	}
}

/**
 * Gets a specific configuration value.
 * Loads the configuration if it hasn't been loaded yet.
 * @param key The configuration key to retrieve.
 * @returns The configuration value or undefined if not found.
 */
export async function getConfigValue<K extends keyof RooConfig>(key: K): Promise<RooConfig[K] | undefined> {
	if (!loadedConfig) {
		await loadConfig()
	}
	return loadedConfig?.[key]
}

// Example usage (can be removed later)
async function testConfig() {
	const apiKey = await getConfigValue("apiKey")
	console.log(`API Key: ${apiKey}`)
	const model = await getConfigValue("model")
	console.log(`Model: ${model}`)
}

// testConfig(); // Uncomment for testing
