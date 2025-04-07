const http = require("http")

// Mock provider settings
const providerProfiles = {
	currentApiConfigName: "default",
	apiConfigs: {
		default: {
			id: "default-id",
			apiProvider: "openai",
		},
		"test-profile": {
			id: "test-id",
			apiProvider: "anthropic",
		},
	},
	modeApiConfigs: {
		code: "default-id",
		debug: "test-id",
	},
}

// Create HTTP server
const server = http.createServer((req, res) => {
	console.log(`${req.method} ${req.url}`)

	// Set CORS headers
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Roo-Bridge-Secret")

	// Handle preflight requests
	if (req.method === "OPTIONS") {
		res.writeHead(204)
		res.end()
		return
	}

	// Parse URL
	const url = new URL(req.url, `http://localhost:30001`)
	const path = url.pathname

	// Handle request based on path and method
	if (path === "/config/list" && req.method === "GET") {
		// List configs
		const configs = Object.entries(providerProfiles.apiConfigs).map(([name, config]) => ({
			name,
			id: config.id,
			apiProvider: config.apiProvider,
		}))

		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ configs }))
		return
	}

	if (path === "/config/save" && req.method === "POST") {
		// Parse request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", () => {
			try {
				const { name, config } = JSON.parse(body)

				if (!name || !config) {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Missing required parameters: name and config" }))
					return
				}

				// Save config
				providerProfiles.apiConfigs[name] = {
					...config,
					id: config.id || `${name}-${Date.now()}`,
				}

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: true }))
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: error.message }))
			}
		})

		return
	}

	if (path === "/config/load" && req.method === "POST") {
		// Parse request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", () => {
			try {
				const { name } = JSON.parse(body)

				if (!name) {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Missing required parameter: name" }))
					return
				}

				// Check if config exists
				if (!providerProfiles.apiConfigs[name]) {
					res.writeHead(404, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: `Config '${name}' not found` }))
					return
				}

				// Load config
				providerProfiles.currentApiConfigName = name

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						success: true,
						config: providerProfiles.apiConfigs[name],
					}),
				)
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: error.message }))
			}
		})

		return
	}

	if (path === "/config/delete" && req.method === "POST") {
		// Parse request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", () => {
			try {
				const { name } = JSON.parse(body)

				if (!name) {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Missing required parameter: name" }))
					return
				}

				// Check if config exists
				if (!providerProfiles.apiConfigs[name]) {
					res.writeHead(404, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: `Config '${name}' not found` }))
					return
				}

				// Check if it's the last config
				if (Object.keys(providerProfiles.apiConfigs).length <= 1) {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Cannot delete the last remaining configuration" }))
					return
				}

				// Delete config
				delete providerProfiles.apiConfigs[name]

				// Reset current config if needed
				if (providerProfiles.currentApiConfigName === name) {
					providerProfiles.currentApiConfigName = Object.keys(providerProfiles.apiConfigs)[0]
				}

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: true }))
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: error.message }))
			}
		})

		return
	}

	if (path === "/config/setMode" && req.method === "POST") {
		// Parse request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", () => {
			try {
				const { mode, configId } = JSON.parse(body)

				if (!mode || !configId) {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Missing required parameters: mode and configId" }))
					return
				}

				// Set mode config
				providerProfiles.modeApiConfigs[mode] = configId

				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: true }))
			} catch (error) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: error.message }))
			}
		})

		return
	}

	if (path === "/config/getMode" && req.method === "GET") {
		// Get query parameters
		const mode = url.searchParams.get("mode")

		if (!mode) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Missing required parameter: mode" }))
			return
		}

		// Get mode config
		const configId = providerProfiles.modeApiConfigs[mode]

		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ configId }))
		return
	}

	// Default: Not found
	res.writeHead(404, { "Content-Type": "application/json" })
	res.end(JSON.stringify({ error: "Not found" }))
})

// Start server
const PORT = 30001
server.listen(PORT, "127.0.0.1", () => {
	console.log(`Test bridge server running at http://localhost:${PORT}`)
})

console.log("Press Ctrl+C to stop the server")
