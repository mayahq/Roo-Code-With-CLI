import * as childProcess from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

/**
 * Handles the installation of the Roo CLI when the extension is activated
 */
export class CliInstaller {
	private outputChannel: vscode.OutputChannel
	private extensionPath: string

	constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel
		this.extensionPath = context.extensionPath
	}

	/**
	 * Install the CLI globally
	 */
	public async installCli(): Promise<void> {
		try {
			this.outputChannel.appendLine("Installing Roo CLI...")

			// Path to the CLI directory within the extension
			const cliDistPath = path.join(this.extensionPath, "dist", "roo-cli")

			// Check if the CLI directory exists
			if (!fs.existsSync(cliDistPath)) {
				this.outputChannel.appendLine(`CLI directory not found at ${cliDistPath}`)
				return
			}

			// Create a package.json for the CLI in a temporary directory
			const tempDir = path.join(os.tmpdir(), "roo-cli-install")
			if (!fs.existsSync(tempDir)) {
				fs.mkdirSync(tempDir, { recursive: true })
			}

			// Copy the CLI files to the temporary directory
			this.copyDirectory(cliDistPath, tempDir)

			// Create a package.json file in the temporary directory
			const packageJson = {
				name: "roo-cli",
				version: this.getExtensionVersion(),
				description: "Command Line Interface for Roo",
				main: "cli.js",
				type: "module",
				bin: {
					roo: "cli.js",
					"roo-config": "ipc-bridge-cli/index.js",
				},
			}

			fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify(packageJson, null, 2))

			// Install the CLI globally
			this.executeCommand("npm", ["install", "-g", tempDir], { cwd: tempDir })
				.then(() => {
					this.outputChannel.appendLine("Roo CLI installed successfully")
				})
				.catch((error) => {
					this.outputChannel.appendLine(`Failed to install Roo CLI: ${error}`)
				})
		} catch (error) {
			this.outputChannel.appendLine(`Error installing Roo CLI: ${error}`)
		}
	}

	/**
	 * Get the extension version from package.json
	 */
	private getExtensionVersion(): string {
		try {
			const packageJsonPath = path.join(this.extensionPath, "package.json")
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
			return packageJson.version || "0.0.1"
		} catch (error) {
			this.outputChannel.appendLine(`Error reading extension version: ${error}`)
			return "0.0.1"
		}
	}

	/**
	 * Execute a command and return a promise
	 */
	private executeCommand(command: string, args: string[], options: childProcess.SpawnOptions): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = childProcess.spawn(command, args, options)

			if (proc.stdout) {
				proc.stdout.on("data", (data) => {
					this.outputChannel.appendLine(data.toString())
				})
			}

			if (proc.stderr) {
				proc.stderr.on("data", (data) => {
					this.outputChannel.appendLine(data.toString())
				})
			}

			proc.on("close", (code) => {
				if (code === 0) {
					resolve()
				} else {
					reject(new Error(`Command exited with code ${code}`))
				}
			})

			proc.on("error", (error) => {
				reject(error)
			})
		})
	}

	/**
	 * Copy a directory recursively
	 */
	private copyDirectory(source: string, destination: string): void {
		if (!fs.existsSync(destination)) {
			fs.mkdirSync(destination, { recursive: true })
		}

		const files = fs.readdirSync(source)

		for (const file of files) {
			const sourcePath = path.join(source, file)
			const destPath = path.join(destination, file)

			const stat = fs.statSync(sourcePath)

			if (stat.isDirectory()) {
				this.copyDirectory(sourcePath, destPath)
			} else {
				fs.copyFileSync(sourcePath, destPath)
			}
		}
	}
}
