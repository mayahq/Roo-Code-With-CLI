// REPL (Read-Eval-Print Loop) for Roo CLI

import chalk from "chalk"
import fs from "fs/promises"
import { marked, Renderer, Tokens } from "marked" // Import Renderer and Tokens types
import { stdin as input, stdout as output } from "node:process"
import * as readline from "node:readline/promises"
import path from "path"
import { Agent } from "./agent.js"

// Define a custom renderer object implementing the Renderer interface
const customRenderer: Partial<Renderer> = {
	// Note: 'this' context inside these functions refers to the renderer instance being used by marked.

	code({ text, lang, escaped }: Tokens.Code): string {
		// Updated to match the expected interface
		if (lang) {
			return `\n${chalk.cyan(text)}\n` // Add newlines for block spacing
		}
		return `\n${text}\n` // Add newlines for block spacing
	},

	heading({ tokens, depth }: Tokens.Heading): string {
		// Updated to match the expected interface
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		switch (depth) {
			case 1:
				return chalk.bold.magenta(`\n# ${text}\n`)
			case 2:
				return chalk.bold.blue(`\n## ${text}\n`)
			case 3:
				return chalk.bold.green(`\n### ${text}\n`)
			default:
				return chalk.bold(`\n${"#".repeat(depth)} ${text}\n`)
		}
	},

	strong({ tokens }: Tokens.Strong): string {
		// Updated to match the expected interface
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return chalk.bold(text)
	},

	em({ tokens }: Tokens.Em): string {
		// Updated to match the expected interface
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return chalk.italic(text)
	},

	listitem(item: Tokens.ListItem): string {
		// Updated to match the expected interface
		const text = marked.parseInline(item.tokens.map((t: any) => t.raw || "").join(""))
		const task = item.task || false
		const checked = item.checked || false

		const marker = task ? (checked ? "[x] " : "[ ] ") : "* "
		// Avoid adding extra newline if text already ends with one (common for nested lists)
		const textStr = String(text) // Ensure text is a string
		return `${marker}${textStr}${textStr.endsWith("\n") ? "" : "\n"}`
	},

	link({ href, title, tokens }: Tokens.Link): string {
		// Updated to match the expected interface
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return chalk.underline.blue(`[${text}](${href})${title ? ` "${title}"` : ""}`)
	},

	paragraph({ tokens }: Tokens.Paragraph): string {
		// Updated to match the expected interface
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		// Add extra line break after paragraphs for better spacing.
		return text + "\n\n" // Add two newlines for spacing
	},
}

// Configure marked with the custom renderer object
marked.setOptions({
	renderer: customRenderer as Renderer, // Cast to Renderer type
	gfm: true, // Enable GitHub Flavored Markdown
})

interface ReplOptions {
	skipConfirmation?: boolean
}

// Basic command structure
interface ParsedCommand {
	command: string | null
	task: string
	mentionedFiles: string[] // Store raw mentions for now
	resolvedFiles: string[] // Store absolute paths
}

// Regex to parse commands like /code, /ask
const commandRegex = /^\/(\w+)\s*(.*)$/
// Regex to find @mentions like @path/to/file.ts or @../relative/path.js
const mentionRegex = /@([\w./\\-]+)/g

async function parseInput(input: string): Promise<ParsedCommand> {
	console.log(`[DEBUG] Parsing input: "${input}"`) // Debug log
	const commandMatch = input.match(commandRegex)
	let command: string | null = null
	let task = input // Default to the whole input if no command found

	if (commandMatch) {
		command = commandMatch[1].toLowerCase()
		task = commandMatch[2].trim()
	}

	const mentionedFiles: string[] = []
	const resolvedFiles: string[] = []
	let mentionMatch

	// Find all @mentions in the original input string
	const fullInput = input // Keep original input for mention extraction
	while ((mentionMatch = mentionRegex.exec(fullInput)) !== null) {
		const filePath = mentionMatch[1]
		mentionedFiles.push(filePath)
		const absolutePath = path.resolve(process.cwd(), filePath) // Resolve relative to CWD
		try {
			// Check if the file exists before adding
			await fs.access(absolutePath)
			resolvedFiles.push(absolutePath)
		} catch (error) {
			console.warn(chalk.yellow(`Warning: Mentioned file not found or inaccessible: ${filePath}`))
			// Optionally, decide whether to still pass the mention or filter it out
		}
	}

	// If no command was explicitly given (like /code), treat the whole input as the task
	// unless it's a special command like /exit or /help
	if (command === null && task.toLowerCase() !== "/exit" && task.toLowerCase() !== "/help") {
		// The task is already the full input, no change needed here
		// But we need to ensure the agent handles this case
	} else if (command === "exit" || command === "help") {
		// These commands are handled directly in the loop
	} else if (command === null && (task.toLowerCase() === "/exit" || task.toLowerCase() === "/help")) {
		// User typed '/exit' or '/help' without a leading space, handle it
		command = task.toLowerCase().substring(1) // Extract 'exit' or 'help'
		task = "" // No task description in this case
	}

	console.log(`[DEBUG] Parsed result: command=${command}, task=${task}, files=${resolvedFiles.length}`) // Debug log
	return { command, task, mentionedFiles, resolvedFiles }
}

export async function startRepl(options: ReplOptions = {}) {
	const { skipConfirmation = false } = options
	const rl = readline.createInterface({ input, output })
	const agent = new Agent({ skipConfirmation }) // Instantiate the agent

	console.log("Welcome to Roo CLI! Type /help for commands, /exit to quit.")

	while (true) {
		const answer = await rl.question(chalk.gray("> ")) // Use chalk for prompt
		const trimmedAnswer = answer.trim()

		if (trimmedAnswer.toLowerCase() === "/exit") {
			console.log("Goodbye!")
			break
		}

		if (trimmedAnswer === "") continue // Ignore empty input

		const parsed = await parseInput(trimmedAnswer)

		if (parsed.command === "help") {
			// Use the custom renderer for help text
			const helpText = `
Available commands:
*   \`/code <task description> [@file ...]\` - Ask Roo to perform a coding task.
*   \`/ask <question> [@file ...]\` - Ask Roo a question.
*   \`/help\` - Show this help message.
*   \`/exit\` - Exit the CLI.

Use \`@path/to/file\` to mention files relevant to your task/question.
`
			// Use marked.parse() which now correctly uses the custom renderer
			console.log(await marked.parse(helpText))
			continue
		}

		// Now, call the agent for any command that isn't 'exit' or 'help'
		// This includes null commands (implicit task) and specific commands like /code, /ask
		if (parsed.command !== "exit") {
			try {
				console.log(chalk.blue("Roo is thinking...")) // Indicate processing
				// Pass the parsed command and task to the agent
				const agentResponse = await agent.processCommand(
					parsed.command, // Pass the command type ('code', 'ask', or null)
					parsed.task,
					parsed.resolvedFiles,
				)
				// Render the Markdown output using the custom renderer
				// Trim the result to remove potential leading/trailing whitespace from parsing
				const formattedOutput = (await marked.parse(agentResponse.outputMarkdown)).trim()
				console.log(formattedOutput) // Output formatted markdown
			} catch (error) {
				console.error(chalk.red(`Agent error: ${error}`))
				console.log(`[DEBUG] Caught error during agent processing.`) // Debug log
			}
		} else {
			console.log(`[DEBUG] Command was 'exit', skipping agent call.`) // Debug log
		}
	}

	rl.close()
}
