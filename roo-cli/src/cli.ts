// Main entry point for Roo CLI

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { startRepl } from "./core/repl.js" // Use .js extension for ES modules
import { loadConfig } from "./utils/config.js" // Import config loader

// Load configuration first
await loadConfig()

// Define command-line arguments
const argv = await yargs(hideBin(process.argv))
	.option("yes", {
		alias: "y",
		type: "boolean",
		description: "Automatically confirm potentially destructive actions",
		default: false,
	})
	.help()
	.alias("help", "h")
	.version()
	.alias("version", "v").argv

const skipConfirmation = argv.yes

console.log("Roo CLI starting...")
if (skipConfirmation) {
	console.log("Running in non-interactive mode (--yes).")
}

// Start the REPL, passing the confirmation flag
startRepl({ skipConfirmation }).catch((error) => {
	console.error("An error occurred:", error)
	process.exit(1) // Exit with error code
})
