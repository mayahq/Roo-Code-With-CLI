import * as assert from "assert"
import * as vscode from "vscode"

suite("Roo Code With CLI Extension", () => {
	test("Commands should be registered", async () => {
		const expectedCommands = [
			"roo-cline-with-cli.plusButtonClicked",
			"roo-cline-with-cli.mcpButtonClicked",
			"roo-cline-with-cli.historyButtonClicked",
			"roo-cline-with-cli.popoutButtonClicked",
			"roo-cline-with-cli.settingsButtonClicked",
			"roo-cline-with-cli.openInNewTab",
			"roo-cline-with-cli.explainCode",
			"roo-cline-with-cli.fixCode",
			"roo-cline-with-cli.improveCode",
		]

		const commands = await vscode.commands.getCommands(true)

		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`)
		}
	})
})
