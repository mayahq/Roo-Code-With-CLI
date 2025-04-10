import chalk from "chalk"

/**
 * Display utilities for formatting and printing output to the console.
 */
export class Display {
	private static instance: Display
	private isVerbose = false

	private constructor() {}

	/**
	 * Gets the singleton instance of the Display class.
	 */
	static getInstance(): Display {
		if (!Display.instance) {
			Display.instance = new Display()
		}
		return Display.instance
	}

	/**
	 * Sets the verbose mode.
	 * @param verbose Whether to enable verbose mode.
	 */
	setVerbose(verbose: boolean): void {
		this.isVerbose = verbose
	}

	/**
	 * Toggles verbose mode.
	 * @returns The new verbose mode state.
	 */
	toggleVerbose(): boolean {
		this.isVerbose = !this.isVerbose
		return this.isVerbose
	}

	/**
	 * Prints a regular message to the console.
	 * @param message The message to print.
	 */
	log(message: string): void {
		console.log(message)
	}

	/**
	 * Prints an info message to the console.
	 * @param message The message to print.
	 */
	info(message: string): void {
		console.log(chalk.blue("ℹ ") + message)
	}

	/**
	 * Prints a success message to the console.
	 * @param message The message to print.
	 */
	success(message: string): void {
		console.log(chalk.green("✓ ") + message)
	}

	/**
	 * Prints a warning message to the console.
	 * @param message The message to print.
	 */
	warn(message: string): void {
		console.log(chalk.yellow("⚠ ") + message)
	}

	/**
	 * Prints an error message to the console.
	 * @param message The message to print.
	 */
	error(message: string): void {
		console.error(chalk.red("✗ ") + message)
	}

	/**
	 * Prints a debug message to the console if verbose mode is enabled.
	 * @param message The message to print.
	 */
	debug(message: string): void {
		if (this.isVerbose) {
			console.log(chalk.gray("🔍 ") + message)
		}
	}

	/**
	 * Prints a header to the console.
	 * @param title The header title.
	 */
	header(title: string): void {
		console.log("\n" + chalk.bold.cyan(title))
		console.log(chalk.cyan("=".repeat(title.length)) + "\n")
	}

	/**
	 * Prints a section header to the console.
	 * @param title The section title.
	 */
	section(title: string): void {
		console.log("\n" + chalk.bold.cyan(title))
	}

	/**
	 * Prints a user message to the console.
	 * @param message The user message.
	 */
	userMessage(message: string): void {
		console.log(chalk.bold.green("You: ") + message)
	}

	/**
	 * Prints an AI response to the console.
	 * @param message The AI response.
	 */
	aiResponse(message: string): void {
		console.log(chalk.bold.blue("Roo: ") + message)
	}

	/**
	 * Prints a partial AI response to the console.
	 * @param message The partial AI response.
	 */
	partialAiResponse(message: string): void {
		process.stdout.write(message)
	}

	/**
	 * Prints a tool execution message to the console.
	 * @param tool The tool name.
	 * @param message The tool execution message.
	 */
	toolExecution(tool: string, message: string): void {
		console.log(chalk.bold.yellow(`[${tool}] `) + message)
	}

	/**
	 * Prints a spinner to indicate loading.
	 * @param message The loading message.
	 * @returns A function to stop the spinner.
	 */
	spinner(message: string): () => void {
		const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
		let i = 0
		const id = setInterval(() => {
			process.stdout.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${message}`)
		}, 80)

		return () => {
			clearInterval(id)
			process.stdout.write("\r" + " ".repeat(message.length + 2) + "\r")
		}
	}

	/**
	 * Clears the console.
	 */
	clear(): void {
		console.clear()
	}

	/**
	 * Prints a welcome message to the console.
	 */
	welcome(): void {
		console.log("\n" + chalk.bold.cyan("Welcome to Roo CLI"))
		console.log(chalk.cyan("===================") + "\n")
		console.log("Type your message and press Enter to send.")
		console.log("Type " + chalk.bold("/help") + " to see available commands.")
		console.log("Type " + chalk.bold("/exit") + " to quit.")
		console.log("\nYour messages will be processed in the current session until you start a new task.\n")
	}

	/**
	 * Prints a help message to the console.
	 */
	help(): void {
		this.header("Available Commands")
		console.log(chalk.bold("/help") + " - Show this help message")
		console.log(chalk.bold("/exit") + " - Exit the CLI")
		console.log(chalk.bold("/clear") + " - Clear the console")
		console.log(
			chalk.bold("/mode <mode>") + " - Switch to a different mode (e.g., /mode code, /mode debug, /mode ask)",
		)
		console.log(chalk.bold("/verbose") + " - Toggle verbose mode for debugging")

		this.section("Profile Management")
		console.log(
			chalk.bold("roo configure profile <name> --mode <mode> --provider <provider>") +
				" - Configure a new profile",
		)
		console.log("  Example: " + chalk.italic("roo configure profile my-gpt4 --mode code --provider openai/gpt-4"))
		console.log(chalk.bold("roo list profiles") + " - List all configured profiles")
		console.log(chalk.bold("roo use <profile>") + " - Set a profile as default")
		console.log(chalk.bold('roo use <profile> "<message>"') + " - Use a profile for a single message")

		this.section("Session Management")
		console.log("Each time you start the CLI without a message, a new session begins.")
		console.log("All messages within that session use the same task ID until you exit.")
		console.log("Messages are streamed in real-time as they are received from the AI.")

		console.log("")
	}
}

// Export a singleton instance
export const display = Display.getInstance()
