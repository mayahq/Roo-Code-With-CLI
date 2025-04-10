const fs = require("fs")
const path = require("path")
const os = require("os")
const { WebSocketServer } = require("ws")

// Create a WebSocket server
const wss = new WebSocketServer({ port: 0 })

// Get the port number
wss.on("listening", () => {
	const address = wss.address()
	const port = address.port
	console.log(`WebSocket server listening on port ${port}`)

	// Determine the storage path based on the platform
	let storagePath
	if (process.platform === "win32") {
		storagePath = path.join(
			os.homedir(),
			"AppData",
			"Roaming",
			"Code",
			"User",
			"globalStorage",
			"mayahq.roo-cline-with-cli",
		)
	} else if (process.platform === "darwin") {
		storagePath = path.join(
			os.homedir(),
			"Library",
			"Application Support",
			"Code",
			"User",
			"globalStorage",
			"mayahq.roo-cline-with-cli",
		)
	} else {
		storagePath = path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "mayahq.roo-cline-with-cli")
	}

	// Create the directory if it doesn't exist
	if (!fs.existsSync(storagePath)) {
		fs.mkdirSync(storagePath, { recursive: true })
	}

	// Write the port number to the port file
	const portFilePath = path.join(storagePath, "roo_cli_bridge.port")
	fs.writeFileSync(portFilePath, JSON.stringify({ port }))
	console.log(`Port file written to: ${portFilePath}`)

	// Handle connections
	wss.on("connection", (ws) => {
		console.log("Client connected")

		// Handle messages from the client
		ws.on("message", (message) => {
			try {
				const parsedMessage = JSON.parse(message)
				console.log("Received message:", parsedMessage)

				// Send a response back to the client
				if (parsedMessage.type === "newTask") {
					// Send a partial message
					ws.send(
						JSON.stringify({
							type: "partialMessage",
							partialMessage: {
								type: "say",
								say: "ai_response",
								content: "Hello from the test server! I received your message: " + parsedMessage.text,
							},
						}),
					)

					// Send a state update
					setTimeout(() => {
						ws.send(
							JSON.stringify({
								type: "state",
								state: {
									clineMessages: [
										{
											type: "say",
											say: "ai_response",
											content:
												"Hello from the test server! I received your message: " +
												parsedMessage.text,
										},
									],
								},
							}),
						)
					}, 1000)
				}
			} catch (error) {
				console.error("Error parsing message:", error)
			}
		})

		// Handle disconnection
		ws.on("close", () => {
			console.log("Client disconnected")
		})
	})

	// Handle errors
	wss.on("error", (error) => {
		console.error("WebSocket server error:", error)
	})

	// Handle process termination
	process.on("SIGINT", () => {
		console.log("Shutting down...")
		// Remove the port file
		try {
			fs.unlinkSync(portFilePath)
			console.log("Port file removed")
		} catch (error) {
			console.error("Error removing port file:", error)
		}
		// Close the server
		wss.close(() => {
			console.log("Server closed")
			process.exit(0)
		})
	})
})
