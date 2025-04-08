import fs from "fs"
import fsp from "fs/promises"
import os from "os"
import path from "path"

// --- Constants ---

const EXTENSION_ID = "mayalabs.roo-code-with-cli"
const CONFIG_KEY = "roo_cline_config_api_config"

// VS Code variants
const VS_CODE_VARIANTS = [
	"Code", // Regular VS Code
	"Code - Insiders", // VS Code Insiders
	"VSCodium", // VSCodium
	"VSCode", // Alternative name
]

// --- Path Utilities ---

/**
 * Finds the first path in a list that exists on the filesystem.
 * @param paths - An array of paths to check.
 * @returns The first existing path, or null if none exist.
 */
const findExistingPath = (paths: string[]): string | null => {
	for (const p of paths) {
		if (fs.existsSync(p)) {
			return p
		}
	}
	return null
}

/**
 * Generates possible paths for the VS Code extension's global storage directory based on OS.
 * @returns An array of possible global storage paths.
 */
const getPossibleVSCodeGlobalStoragePaths = (): string[] => {
	const homeDir = os.homedir()
	const paths: string[] = []

	if (process.platform === "darwin") {
		// macOS
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(
				path.join(homeDir, "Library", "Application Support", variant, "User", "globalStorage", EXTENSION_ID),
			)
		}
	} else if (process.platform === "win32") {
		// Windows
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(path.join(homeDir, "AppData", "Roaming", variant, "User", "globalStorage", EXTENSION_ID))
		}
	} else {
		// Linux and others
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(path.join(homeDir, ".config", variant, "User", "globalStorage", EXTENSION_ID))
		}
	}
	return paths
}

/**
 * Generates possible paths for the VS Code extension's secrets storage directory based on OS.
 * @returns An array of possible secrets storage paths.
 */
const getPossibleVSCodeSecretsPaths = (): string[] => {
	const homeDir = os.homedir()
	const paths: string[] = []

	if (process.platform === "darwin") {
		// macOS
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(path.join(homeDir, "Library", "Application Support", variant, "User", "secrets", EXTENSION_ID))
		}
	} else if (process.platform === "win32") {
		// Windows
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(path.join(homeDir, "AppData", "Roaming", variant, "User", "secrets", EXTENSION_ID))
		}
	} else {
		// Linux and others
		for (const variant of VS_CODE_VARIANTS) {
			paths.push(path.join(homeDir, ".config", variant, "User", "secrets", EXTENSION_ID))
		}
	}
	return paths
}

/**
 * Finds the active VS Code extension's global storage path.
 * @returns The path string if found, otherwise null.
 */
export function findExtensionGlobalStoragePath(): string | null {
	const possiblePaths = getPossibleVSCodeGlobalStoragePaths()
	return findExistingPath(possiblePaths)
}

/**
 * Finds the active VS Code extension's secrets storage path.
 * @returns The path string if found, otherwise null.
 */
export function findExtensionSecretsPath(): string | null {
	const possiblePaths = getPossibleVSCodeSecretsPaths()
	return findExistingPath(possiblePaths)
}

/**
 * Gets the storage directory path for a specific task.
 * Ensures the directory exists.
 * @param globalStoragePath - The base global storage path for the extension.
 * @param taskId - The ID of the task.
 * @returns The path to the task directory.
 */
export async function getTaskDirectoryPath(globalStoragePath: string, taskId: string): Promise<string> {
	// Note: Does not handle customStoragePath from VS Code settings, assumes default path.
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fsp.mkdir(taskDir, { recursive: true })
	return taskDir
}

/**
 * Gets the full path to the API conversation history file for a task.
 * @param taskDirectoryPath - The path to the task's directory.
 * @returns The full path to the history file.
 */
export function getApiHistoryPath(taskDirectoryPath: string): string {
	return path.join(taskDirectoryPath, "api_conversation_history.json")
}

// --- API Configuration (Secrets) ---

/**
 * Finds the specific file within the secrets directory that contains the API configuration.
 * @param secretsPath - The path to the extension's secrets directory.
 * @returns The full path to the config file, or null if not found.
 */
function findSecretsConfigFile(secretsPath: string): string | null {
	try {
		const files = fs.readdirSync(secretsPath)
		for (const file of files) {
			const filePath = path.join(secretsPath, file)
			try {
				const content = fs.readFileSync(filePath, "utf-8")
				const data = JSON.parse(content)
				if (data.key === CONFIG_KEY) {
					return filePath
				}
			} catch (e) {
				// Ignore files that aren't valid JSON or don't match the key
			}
		}
	} catch (error) {
		console.error(`Error reading secrets directory ${secretsPath}:`, error)
		return null // Directory might not exist or be readable
	}
	return null
}

/**
 * Loads the provider profiles (API configurations) from the VS Code secrets storage.
 * @param secretsPath - The path to the extension's secrets directory.
 * @returns The parsed provider profiles object.
 * @throws An error if the secrets directory or config file cannot be found or read.
 */
export async function loadProviderProfiles(secretsPath: string): Promise<any> {
	const configFile = findSecretsConfigFile(secretsPath)

	if (!configFile) {
		throw new Error(
			`Configuration file with key '${CONFIG_KEY}' not found in VS Code secrets storage at ${secretsPath}. Ensure the extension is installed and has saved a configuration.`,
		)
	}

	try {
		const content = await fsp.readFile(configFile, "utf-8")
		const data = JSON.parse(content)
		// The actual configuration is stored as a JSON string in the 'value' property
		return JSON.parse(data.value)
	} catch (error) {
		throw new Error(`Error reading or parsing configuration file ${configFile}: ${error}`)
	}
}

/**
 * Saves the provider profiles (API configurations) to the VS Code secrets storage.
 * @param secretsPath - The path to the extension's secrets directory.
 * @param providerProfiles - The provider profiles object to save.
 * @throws An error if the secrets directory or config file cannot be found or written to.
 */
export async function saveProviderProfiles(secretsPath: string, providerProfiles: any): Promise<void> {
	const configFile = findSecretsConfigFile(secretsPath)

	if (!configFile) {
		throw new Error(
			`Configuration file with key '${CONFIG_KEY}' not found in VS Code secrets storage at ${secretsPath}. Cannot save configuration.`,
		)
	}

	try {
		// Read the existing container file structure
		const content = await fsp.readFile(configFile, "utf-8")
		const data = JSON.parse(content)

		// Update the 'value' property with the new profiles, stringified
		data.value = JSON.stringify(providerProfiles)

		// Write the updated container back to the file
		await fsp.writeFile(configFile, JSON.stringify(data, null, 2))
		console.log(`Configuration saved to ${configFile}`) // Keep console log for user feedback in config command
	} catch (error) {
		throw new Error(`Error saving configuration file ${configFile}: ${error}`)
	}
}

// --- Task History ---

/**
 * Reads and parses the API conversation history from a file.
 * @param historyPath - The full path to the history file.
 * @returns The parsed history array, or an empty array if the file doesn't exist or is invalid.
 */
export async function readApiHistory(historyPath: string): Promise<any[]> {
	try {
		const content = await fsp.readFile(historyPath, "utf-8")
		return JSON.parse(content)
	} catch (error: unknown) {
		// If file doesn't exist (ENOENT) or is invalid JSON, return empty history
		// Check if error is an object and has a 'code' property
		if (
			(error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") ||
			error instanceof SyntaxError
		) {
			return []
		}
		// For other errors (e.g., permissions), re-throw
		console.error(`Error reading history file ${historyPath}:`, error)
		throw error
	}
}

/**
 * Writes the API conversation history to a file.
 * @param historyPath - The full path to the history file.
 * @param history - The history array to write.
 */
export async function writeApiHistory(historyPath: string, history: any[]): Promise<void> {
	try {
		await fsp.writeFile(historyPath, JSON.stringify(history, null, 2)) // Pretty-print for readability
	} catch (error) {
		console.error(`Error writing history file ${historyPath}:`, error)
		throw error
	}
}
