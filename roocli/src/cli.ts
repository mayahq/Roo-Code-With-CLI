#!/usr/bin/env node

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { display } from "./display"
import { IpcClient } from "./ipcClient"
import { Repl } from "./repl"
import { Scripting } from "./scripting"

/**
 * Main entry point for the CLI.
 */
async function main() {
	// Create IPC client
	const ipcClient = new IpcClient()

	// Parse command line arguments
	const argv = await yargs(hideBin(process.argv))
		.scriptName("roo")
		.usage("Usage: $0 <command> [options] | [options] [message]")
		// Define types for arguments for better type safety
		.command<{ message?: string; interactive?: boolean }>(
			"$0 [message]",
			"Send a message using the current profile or start interactive mode",
			(yargs) => {
				yargs
					.positional("message", {
						describe: "The message to send to the AI",
						type: "string",
					})
					.option("interactive", {
						alias: "i",
						type: "boolean",
						description: "Force interactive mode even if a message is provided",
						default: false,
					})
			},
			async (argv) => {
				// argv type is inferred from command definition above
				// Handler for default command (send message or start REPL)
				await handleDefaultCommand(argv) // Pass typed argv
			},
		)
		// Define types for arguments
		.command<{ name: string; mode: string; provider: string }>(
			"configure profile <name>",
			"Configure a new named profile",
			(yargs) => {
				yargs
					.positional("name", {
						describe: "The name for the new profile",
						type: "string",
						demandOption: true,
					})
					.option("mode", {
						describe: "The mode slug to use for this profile",
						type: "string",
						demandOption: true,
					})
					.option("provider", {
						describe: "The provider ID to use for this profile",
						type: "string",
						demandOption: true, // Or make optional if there's a default
					})
					.example(
						"$0 configure profile my-gpt4 --mode code --provider openai/gpt-4",
						'Configure a profile named "my-gpt4"',
					)
			},
			async (argv) => {
				// argv type is inferred
				try {
					display.info(
						`Configuring profile "${argv.name}" with mode "${argv.mode}" and provider "${argv.provider}"...`,
					)
					await ipcClient.connect()
					await ipcClient.configureProfile(argv.name, argv.mode, argv.provider)
					display.success(`Profile "${argv.name}" configured successfully.`)
				} catch (error) {
					display.error(`Failed to configure profile: ${error}`)
				}
				process.exit(0)
			},
		)
		// Define types for arguments. Correct command signature (remove '[message]')
		.command<{ profile: string; message?: string }>(
			"use <profile> [message]",
			"Use a specific profile for a message or switch the default",
			(yargs) => {
				yargs
					.positional("profile", {
						describe: "The name of the profile to use",
						type: "string",
						demandOption: true,
					})
					// Define the optional positional argument here
					.positional("message", {
						describe: "Optional message to send using this profile",
						type: "string",
					})
					.example('$0 use my-gpt4 "Refactor this code"', 'Send a message using the "my-gpt4" profile')
					.example("$0 use my-gpt4", 'Switch the default profile to "my-gpt4" for subsequent commands/REPL')
			},
			async (argv) => {
				// argv type is inferred
				try {
					await ipcClient.connect()

					if (argv.message) {
						display.info(`Using profile "${argv.profile}" for message: "${argv.message}"...`)
						await ipcClient.sendMessageWithProfile(argv.profile, argv.message)
						display.success(`Message sent using profile "${argv.profile}".`)
					} else {
						display.info(`Switching default profile to "${argv.profile}"...`)
						await ipcClient.setDefaultProfile(argv.profile)
						display.success(`Default profile set to "${argv.profile}".`)
					}
				} catch (error) {
					display.error(`Failed to use profile: ${error}`)
				}
				process.exit(0)
			},
		)
		// Define types for arguments (empty for this command)
		.command<{}>(
			"help",
			"Show help for using the CLI",
			() => {},
			async (argv) => {
				display.header("Roo CLI Help")

				display.section("Session Management")
				display.info("Roo CLI maintains a session for each interactive conversation.")
				display.info("All messages within a session share the same task ID until you exit.")
				display.info("Messages are streamed in real-time as they are received from the AI.")
				display.info("")

				display.section("Profile Management")
				display.info("  Configure a new profile:")
				display.info("    roo configure profile <name> --mode <mode> --provider <provider>")
				display.info("    Example: roo configure profile my-gpt4 --mode code --provider openai/gpt-4")
				display.info("")
				display.info("  List all profiles:")
				display.info("    roo list profiles")
				display.info("")
				display.info("  Set default profile:")
				display.info("    roo use <profile>")
				display.info("    Example: roo use my-gpt4")
				display.info("")
				display.info("  Use profile for a single message:")
				display.info('    roo use <profile> "<message>"')
				display.info('    Example: roo use my-claude "Explain quantum computing"')
				display.info("")

				display.section("Basic Usage")
				display.info("  Send a message:")
				display.info('    roo "<message>"')
				display.info('    Example: roo "Write a function to calculate factorial"')
				display.info("")
				display.info("  Start interactive mode:")
				display.info("    roo")
				display.info("")

				display.section("Interactive Commands")
				display.info("  Once in interactive mode, you can use these commands:")
				display.info("    /help - Show available commands")
				display.info("    /exit - Exit the CLI")
				display.info("    /clear - Clear the console")
				display.info("    /mode <mode> - Switch to a different mode (e.g., code, debug, ask)")
				display.info("    /verbose - Toggle verbose mode for debugging")
				display.info("")

				display.info("For more information, see the documentation at:")
				display.info("https://github.com/mayahq/roo-code/tree/main/roocli")
				process.exit(0)
			},
		)
		// Define types for arguments (empty for this command)
		.command<{}>(
			"list profiles",
			"List all configured profiles",
			() => {},
			async (argv) => {
				// argv type is inferred, should include globals like verbose
				try {
					display.info("Listing profiles...")
					await ipcClient.connect()
					const profiles = await ipcClient.listProfiles()

					if (profiles && profiles.length > 0) {
						display.info("Available profiles:")
						profiles.forEach((profile: any) => {
							// Extract the provider name from apiProvider
							const provider = profile.apiProvider || "undefined"

							// Get the mode from modeApiConfigs (not available in current implementation)
							// For now, we'll just display the provider which is what we have
							display.info(`  - ${profile.name} (Provider: ${provider})`)
						})
					} else {
						display.info("No profiles configured yet.")
					}
				} catch (error) {
					display.error(`Failed to list profiles: ${error}`)
				}
				process.exit(0)
			},
		)
		.option("verbose", {
			alias: "v",
			type: "boolean",
			description: "Run with verbose logging",
			default: false,
			global: true, // Apply to all commands
		})
		.option("timeout", {
			alias: "t",
			type: "number",
			description: "Timeout in milliseconds for non-interactive commands",
			default: 60000,
			global: true, // Apply to all commands
		})
		// Removed top-level interactive flag, handled by default command
		.demandCommand(1, "Please specify a command.")
		.help()
		.alias("help", "h")
		.version()
		.alias("version", "V")
		.strict() // Report errors for unknown commands/options
		.wrap(yargs.terminalWidth()) // Adjust help text width
		.parse() // Use parse() instead of argv to handle commands correctly

	// We need to extract the logic for the default command into a separate function
	// because yargs calls the handler directly when using .command()
	// The 'argv' variable above will be populated by yargs after parsing.
	// The actual execution logic might need restructuring based on which command was run.
	// For now, we'll assume the handlers exit or the main function continues below
	// based on the command executed by yargs.parse().

	// This part of the original code needs to be refactored into the command handlers.
	// For example, the handleDefaultCommand function would contain the logic
	// currently starting at line 45. Other command handlers would have their own logic.

	// Set verbose mode
	display.setVerbose(argv.verbose)

	// Placeholder for the default command handler function
	// Use the defined type for argv
	async function handleDefaultCommand(argv: {
		message?: string
		interactive?: boolean
		verbose?: boolean
		timeout?: number
	}) {
		// Note: yargs adds verbose/timeout globally, so they are available here
		// We ensure verbose is boolean, defaulting to false if undefined
		display.setVerbose(argv.verbose ?? false)

		try {
			display.debug("Connecting to VS Code extension...")
			await ipcClient.connect()
			display.debug("Connected to VS Code extension.")

			// We'll let the server assign a client ID
			// The server will send a clientId message which will be handled by the IPC client
			display.debug("Waiting for server to assign client ID...")

			const message = argv.message ?? "" // Use nullish coalescing

			// Determine whether to run in interactive mode
			// Interactive if no message OR if -i flag is explicitly set
			const isInteractive = argv.interactive || !message // argv.interactive should be boolean

			if (isInteractive) {
				display.debug("Running in interactive mode.")
				const repl = new Repl(ipcClient)
				repl.start() // Note: REPL start is async but doesn't return a promise here, it runs indefinitely
			} else {
				display.debug(`Running in non-interactive mode with message: ${message}`)
				// Use nullish coalescing for timeout, provide a default if needed (though yargs should provide one)
				const scripting = new Scripting(ipcClient, message, argv.timeout ?? 60000)
				const exitCode = await scripting.execute()
				process.exit(exitCode)
			}
		} catch (error) {
			display.error(`Failed to connect to VS Code extension: ${error}`)
			display.info("Make sure VS Code is running with the Roo Code extension activated.")
			process.exit(1)
		}
	}

	// Note: yargs.parse() will have already executed the appropriate command handler.
	// If a handler didn't exit, the script would continue here.
	// We might need further refactoring depending on how async operations in handlers are managed.
	// For now, assuming handlers manage their own lifecycle or exit.
} // End of main function definition

// Run the main function
main().catch((error) => {
	display.error(`Unhandled error: ${error}`)
	process.exit(1)
})
