/**
 * This script prepares the CLI for packaging with the extension.
 * It creates the necessary directory structure and ensures the CLI files are copied.
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// Create the dist/roo-cli directory if it doesn't exist
const cliDistDir = path.join(__dirname, "..", "dist", "roo-cli")
if (!fs.existsSync(cliDistDir)) {
	console.log("Creating dist/roo-cli directory...")
	fs.mkdirSync(cliDistDir, { recursive: true })
}

// Build the CLI if it hasn't been built yet
const cliSrcDir = path.join(__dirname, "..", "roo-cli")
if (fs.existsSync(cliSrcDir)) {
	console.log("Building the CLI...")
	try {
		// Change to the CLI directory
		process.chdir(cliSrcDir)

		// Install dependencies if needed
		if (!fs.existsSync(path.join(cliSrcDir, "node_modules"))) {
			console.log("Installing CLI dependencies...")
			execSync("npm install", { stdio: "inherit" })
		}

		// Build the CLI
		console.log("Running CLI build...")
		execSync("npm run build", { stdio: "inherit" })

		// Change back to the original directory
		process.chdir(path.join(__dirname, ".."))

		// Copy the CLI files to the dist directory
		console.log("Copying CLI files to dist/roo-cli...")
		const cliDistSrcDir = path.join(cliSrcDir, "dist")
		if (fs.existsSync(cliDistSrcDir)) {
			// Copy all files from roo-cli/dist to dist/roo-cli
			copyDirectory(cliDistSrcDir, cliDistDir)
			console.log("CLI files copied successfully.")
		} else {
			console.error("CLI build directory not found. Build may have failed.")
			process.exit(1)
		}
	} catch (error) {
		console.error("Error building the CLI:", error)
		process.exit(1)
	}
} else {
	console.error("CLI source directory not found.")
	process.exit(1)
}

/**
 * Copy a directory recursively
 */
function copyDirectory(source, destination) {
	if (!fs.existsSync(destination)) {
		fs.mkdirSync(destination, { recursive: true })
	}

	const files = fs.readdirSync(source)

	for (const file of files) {
		const sourcePath = path.join(source, file)
		const destPath = path.join(destination, file)

		const stat = fs.statSync(sourcePath)

		if (stat.isDirectory()) {
			copyDirectory(sourcePath, destPath)
		} else {
			fs.copyFileSync(sourcePath, destPath)
		}
	}
}

console.log("CLI preparation completed successfully.")
