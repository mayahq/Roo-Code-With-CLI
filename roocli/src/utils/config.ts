import * as fs from "fs"
import * as os from "os"
import * as path from "path"

interface PortFileContent {
	port: number
}

/**
 * Gets the path to the port file created by the VS Code extension.
 * This file contains the port number that the WebSocket server is listening on.
 */
export function getPortFilePath(): string {
	// Determine the global storage path based on the platform
	let storagePath: string

	if (process.platform === "win32") {
		// Windows: %APPDATA%\Code\User\globalStorage\mayalabs.roo-cline-with-cli
		storagePath = path.join(
			os.homedir(),
			"AppData",
			"Roaming",
			"Code",
			"User",
			"globalStorage",
			"mayalabs.roo-cline-with-cli",
		)
	} else if (process.platform === "darwin") {
		// macOS: ~/Library/Application Support/Code/User/globalStorage/mayalabs.roo-cline-with-cli
		storagePath = path.join(
			os.homedir(),
			"Library",
			"Application Support",
			"Code",
			"User",
			"globalStorage",
			"mayalabs.roo-cline-with-cli",
		)
	} else {
		// Linux: ~/.config/Code/User/globalStorage/mayalabs.roo-cline-with-cli
		storagePath = path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "mayalabs.roo-cline-with-cli")
	}

	return path.join(storagePath, "roo_cli_bridge.port")
}

/**
 * Reads the port number from the port file.
 * @returns The port number or null if the file doesn't exist or is invalid.
 */
export async function readPortFromFile(): Promise<number | null> {
	const portFilePath = getPortFilePath()

	try {
		// Check if the file exists
		await fs.promises.access(portFilePath, fs.constants.R_OK)

		// Read the file content
		const content = await fs.promises.readFile(portFilePath, "utf-8")
		const portData = JSON.parse(content) as PortFileContent

		if (typeof portData.port === "number" && portData.port > 0) {
			return portData.port
		}

		console.error("Invalid port number in port file:", portData)
		return null
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			console.error("Port file not found. Make sure VS Code is running with the Roo Code extension activated.")
		} else {
			console.error("Error reading port file:", error)
		}
		return null
	}
}
