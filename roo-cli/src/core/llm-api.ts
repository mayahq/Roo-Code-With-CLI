// LLM API interaction logic (using Anthropic SDK)

import Anthropic from "@anthropic-ai/sdk"
import { getConfigValue } from "../utils/config.js"

let anthropic: Anthropic | null = null

async function getClient(): Promise<Anthropic> {
	if (anthropic) {
		return anthropic
	}
	const apiKey = await getConfigValue("apiKey")
	if (!apiKey) {
		throw new Error("Anthropic API key not found in configuration (~/.config/roo/config.json). Please add it.")
	}
	anthropic = new Anthropic({ apiKey })
	return anthropic
}

// Define a basic structure for conversation history messages
interface ChatMessage {
	role: "user" | "assistant"
	content: string
}

/**
 * Calls the Anthropic API to get a response based on the prompt and history.
 * @param prompt The user's current prompt/task.
 * @param history The conversation history.
 * @returns The LLM's response content.
 */
export async function callLlmApi(prompt: string, history: ChatMessage[] = []): Promise<string> {
	const client = await getClient()
	const model = (await getConfigValue("model")) || "claude-3-haiku-20240307" // Default to Haiku if not set

	// Construct messages array for Anthropic API
	const messages: Anthropic.Messages.MessageParam[] = history.map((msg) => ({
		role: msg.role,
		content: msg.content,
	}))
	messages.push({ role: "user", content: prompt })

	try {
		console.log(`Calling Anthropic API with model: ${model}`)
		const response = await client.messages.create({
			model: model,
			max_tokens: 1024, // Adjust as needed
			messages: messages,
		})

		// Extract the text content from the response
		// Assuming the response structure has content blocks
		if (response.content && response.content.length > 0 && response.content[0].type === "text") {
			return response.content[0].text
		} else {
			console.error("Unexpected response format from Anthropic API:", response)
			return "Error: Received unexpected format from LLM."
		}
	} catch (error) {
		console.error(`Error calling Anthropic API: ${error}`)
		// Re-throw or return a user-friendly error message
		throw new Error(`Failed to get response from LLM: ${error instanceof Error ? error.message : String(error)}`)
	}
}

// Example usage (can be removed later)
async function testApi() {
	try {
		const response = await callLlmApi("Explain the concept of recursion in simple terms.")
		console.log("LLM Response:", response)
	} catch (error) {
		console.error("Test failed:", error)
	}
}

// testApi(); // Uncomment for testing
