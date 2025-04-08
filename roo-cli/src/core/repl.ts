#!/usr/bin/env node
import chalk from "chalk"
import crypto from "crypto" // For generating UUIDs
import fs from "fs/promises"
import { marked, Renderer, Tokens } from "marked"
import { stdin as input, stdout as output } from "node:process"
import * as readline from "node:readline/promises"
import os from "os" // For home directory
import path from "path"
import { Agent } from "./agent.js"

// --- State Management ---

const CLI_STATE_DIR = path.join(os.homedir(), ".config", "roo")
const CLI_STATE_FILE = path.join(CLI_STATE_DIR, "cli-state.json")
const DEFAULT_MODE = "code" // Default mode when starting or creating a new task

interface CliState {
	currentTaskId: string
}

async function loadCliState(): Promise<CliState> {
	try {
		await fs.mkdir(CLI_STATE_DIR, { recursive: true })
		const stateContent = await fs.readFile(CLI_STATE_FILE, "utf-8")
		const state = JSON.parse(stateContent)
		if (state.currentTaskId && typeof state.currentTaskId === "string") {
			return state
		}
	} catch (error: unknown) {
		// If file doesn't exist or is invalid, create a new state
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
			// File not found, expected on first run
		} else {
			console.warn(chalk.yellow(`Warning: Could not load CLI state from ${CLI_STATE_FILE}.`), error)
		}
	}
	// Default state if loading fails or file doesn't exist
	const newState = { currentTaskId: crypto.randomUUID() }
	await saveCliState(newState)
	return newState
}

async function saveCliState(state: CliState): Promise<void> {
	try {
		await fs.mkdir(CLI_STATE_DIR, { recursive: true })
		await fs.writeFile(CLI_STATE_FILE, JSON.stringify(state, null, 2))
	} catch (error) {
		console.error(chalk.red(`Error: Could not save CLI state to ${CLI_STATE_FILE}.`), error)
		// Continue execution, but state won't persist
	}
}

// --- Marked Custom Renderer ---
const customRenderer: Partial<Renderer> = {
	text(token: Tokens.Text | Tokens.Escape | Tokens.Tag): string {
		return token.text || token.raw || "" // Return the text content of the token
	},
	code({ text, lang }: Tokens.Code): string {
		if (lang) {
			return `\n${chalk.cyan(text)}\n`
		}
		return `\n${text}\n`
	},
	heading({ tokens, depth }: Tokens.Heading): string {
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
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return chalk.bold(text)
	},
	em({ tokens }: Tokens.Em): string {
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return chalk.italic(text)
	},
	listitem(item: Tokens.ListItem): string {
		const text = marked.parseInline(item.tokens.map((t: any) => t.raw || "").join(""))
		const task = item.task || false
		const checked = item.checked || false
		const marker = task ? (checked ? "[x] " : "[ ] ") : "* "
		const textStr = String(text)
		return `${marker}${textStr}${textStr.endsWith("\n") ? "" : "\n"}`
	},
	link({ href, title, tokens }: Tokens.Link): string {
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return chalk.underline.blue(`[${text}](${href})${title ? ` "${title}"` : ""}`)
	},
	paragraph({ tokens }: Tokens.Paragraph): string {
		const text = marked.parseInline(tokens.map((t) => t.raw || "").join(""))
		return text + "\n\n"
	},
}

marked.setOptions({
	renderer: customRenderer as Renderer,
	gfm: true,
})

// --- Types ---

interface ReplOptions {
	skipConfirmation?: boolean
}

// Updated command structure
interface ParsedInput {
	isReplCommand: boolean // Is it a command handled by the REPL itself?
	command: string | null // e.g., 'code', 'ask', 'new', 'help', 'exit'
	task: string // The actual text prompt for the agent
	mentionedFiles: string[] // Raw file mentions
	resolvedFiles: string[] // Absolute paths of existing mentioned files
}

// --- Parsing Logic ---

const commandRegex = /^\/(\w+)\s*(.*)$/
const mentionRegex = /@([\w./\\-]+)/g
const validModes = ["code", "ask", "architect", "debug"] // Add other valid modes as needed

async function parseInput(input: string): Promise<ParsedInput> {
	const commandMatch = input.match(commandRegex)
	let command: string | null = null
	let task = input
	let isReplCommand = false

	if (commandMatch) {
		const potentialCommand = commandMatch[1].toLowerCase()
		// Check if it's a REPL command or a mode command
		if (["help", "exit", "new", ...validModes].includes(potentialCommand)) {
			command = potentialCommand
			task = commandMatch[2].trim() // Task is the rest for mode commands
			if (["help", "exit", "new"].includes(command)) {
				isReplCommand = true
				task = "" // These commands don't have a task part for the agent
			}
		} else {
			// It's not a recognized REPL/mode command, treat as implicit task
			// Keep command null, task remains the full input
		}
	} else if (input.startsWith("/")) {
		// It starts with / but doesn't match the regex structure, treat as implicit task
		command = null
		task = input
	}

	// Handle mentions (unchanged, but applied to the original input)
	const mentionedFiles: string[] = []
	const resolvedFiles: string[] = []
	let mentionMatch
	while ((mentionMatch = mentionRegex.exec(input)) !== null) {
		const filePath = mentionMatch[1]
		mentionedFiles.push(filePath)
		const absolutePath = path.resolve(process.cwd(), filePath)
		try {
			await fs.access(absolutePath)
			resolvedFiles.push(absolutePath)
		} catch (error) {
			console.warn(chalk.yellow(`Warning: Mentioned file not found or inaccessible: ${filePath}`))
		}
	}

	// If a mode command was parsed, the 'task' is the text following it.
	// If no command was parsed, the 'task' is the entire input.
	// If a REPL command (/help, /exit, /new) was parsed, 'task' is empty.

	console.log(
		`[DEBUG] Parsed: command=${command}, isReplCmd=${isReplCommand}, task=${task}, files=${resolvedFiles.length}`,
	)
	return { command, isReplCommand, task, mentionedFiles, resolvedFiles }
}

// --- REPL Function ---

export async function startRepl(options: ReplOptions = {}) {
	const { skipConfirmation = false } = options
	const rl = readline.createInterface({ input, output })
	const agent = new Agent({ skipConfirmation }) // Agent handles LLM calls

	let cliState = await loadCliState()
	let currentMode = DEFAULT_MODE // Initialize mode

	console.log(chalk.blue("Welcome to Roo CLI!"))
	console.log(chalk.gray(`Current Task ID: ${cliState.currentTaskId}`))
	console.log(chalk.gray(`Current Mode: /${currentMode}`))
	console.log(chalk.gray("Type /help for commands, /exit to quit."))

	while (true) {
		const prompt = chalk.gray(`(${currentMode}) > `)
		const answer = await rl.question(prompt)
		const trimmedAnswer = answer.trim()

		if (trimmedAnswer === "") continue

		const parsed = await parseInput(trimmedAnswer)

		// Handle REPL-specific commands first
		if (parsed.isReplCommand) {
			switch (parsed.command) {
				case "exit":
					console.log("Goodbye!")
					rl.close()
					return // Exit the function
				case "help":
					const helpText = `
**Available Commands:**
*   \`/<mode> <task description> [@file ...]\` - Start or continue a task in the specified mode.
    *   Available modes: \`/code\`, \`/ask\`, \`/architect\`, \`/debug\`
*   \`/new\` - Start a new task session (clears context).
*   \`/help\` - Show this help message.
*   \`/exit\` - Exit the CLI.

Use \`@path/to/file\` to mention files relevant to your task/question.
If no command is used, the input is treated as a task for the current mode (\`/${currentMode}\`).
`
					console.log(await marked.parse(helpText))
					continue // Go to next loop iteration
				case "new":
					cliState.currentTaskId = crypto.randomUUID()
					currentMode = DEFAULT_MODE // Reset mode for new task
					await saveCliState(cliState)
					// agent.clearHistory() // Agent does not have this method; state is managed by taskId
					console.log(chalk.green(`Started new task session.`))
					console.log(chalk.gray(`New Task ID: ${cliState.currentTaskId}`))
					console.log(chalk.gray(`Current Mode: /${currentMode}`))
					continue // Go to next loop iteration
			}
		}

		// Handle mode switching or agent processing
		if (parsed.command && validModes.includes(parsed.command)) {
			// Mode switch command
			currentMode = parsed.command
			console.log(chalk.gray(`Switched to mode: /${currentMode}`))
			// If there's a task description after the mode command, process it immediately
			if (parsed.task) {
				try {
					console.log(chalk.blue("Roo is thinking..."))
					const agentResponse = await agent.processCommand(
						// cliState.currentTaskId, // Agent doesn't take taskId directly
						currentMode, // Pass the selected mode
						parsed.task,
						parsed.resolvedFiles,
					)
					const formattedOutput = (await marked.parse(agentResponse.outputMarkdown)).trim()
					console.log(formattedOutput)
				} catch (error) {
					console.error(chalk.red(`Agent error: ${error}`))
				}
			}
			// If no task description, just switching mode, continue to next prompt
		} else {
			// Implicit task for the current mode, or explicit task after mode switch handled above
			try {
				console.log(chalk.blue("Roo is thinking..."))
				// Pass currentMode if no specific mode command was given
				const modeToUse = parsed.command && validModes.includes(parsed.command) ? parsed.command : currentMode
				const agentResponse = await agent.processCommand(
					// cliState.currentTaskId, // Agent doesn't take taskId directly
					modeToUse, // Use current mode
					parsed.task, // Task is the full input if no command, or text after mode command
					parsed.resolvedFiles,
				)
				const formattedOutput = (await marked.parse(agentResponse.outputMarkdown)).trim()
				console.log(formattedOutput)
			} catch (error) {
				console.error(chalk.red(`Agent error: ${error}`))
			}
		}
	}
	// rl.close() // Already closed in /exit case
}
