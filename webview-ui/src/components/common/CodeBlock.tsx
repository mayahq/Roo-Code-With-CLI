import { memo, useEffect, useState } from "react"
import { codeToHtml } from "shiki"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"

export const CODE_BLOCK_BG_COLOR = "var(--vscode-editor-background, --vscode-sideBar-background, rgb(30 30 30))"

/*
overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
this fixes the issue of right padding clipped off 
“ideal” size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
minWidth: "max-content",
*/

interface CodeBlockProps {
	source?: string // Expects format: ```lang\ncode\n```
	forceWrap?: boolean
}

// Shiki generates its own <pre><code> structure with inline styles
// We just need a container to manage wrapping and background
const ShikiContainer = styled.div<{ forceWrap: boolean }>`
	background-color: ${CODE_BLOCK_BG_COLOR};
	border-radius: 5px; // Apply border-radius here

	pre {
		margin: 0; // Remove default margin
		padding: 10px; // Add padding
		background-color: inherit !important; // Ensure background is consistent
		border-radius: 5px; // Match container radius
		min-width: ${({ forceWrap }) => (forceWrap ? "auto" : "max-content")};
		font-family: var(--vscode-editor-font-family);
		font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
		line-height: 1.5; // Adjust line height if needed
		color: var(--vscode-editor-foreground, #fff); // Default text color

		${({ forceWrap }) =>
			forceWrap &&
			`
      white-space: pre-wrap;
      word-break: break-all;
      overflow-wrap: anywhere;
    `}

		// Diff styling (Shiki might use different classes, adjust if needed)
		.diff.remove,
		.deletion {
			background-color: var(--vscode-diffEditor-removedTextBackground);
			display: inline-block;
			width: 100%;
		}
		.diff.add,
		.addition {
			background-color: var(--vscode-diffEditor-insertedTextBackground);
			display: inline-block;
			width: 100%;
		}
	}

	code {
		font-family: inherit; // Inherit font from pre
		font-size: inherit; // Inherit font size from pre
		background-color: transparent !important; // Shiki might add its own, override
	}
`

// Removed StyledPre as Shiki handles styling

// Map VS Code theme names to Shiki theme names
// Add more mappings as needed
const themeMap: Record<string, string> = {
	"Default Dark+": "github-dark",
	"Default Light+": "github-light",
	"Visual Studio Dark": "dark-plus",
	"Visual Studio Light": "light-plus",
	// Add other VS Code theme mappings here
}

const CodeBlock = memo(({ source, forceWrap = false }: CodeBlockProps) => {
	const { theme: vsCodeTheme } = useExtensionState()
	const [highlightedCode, setHighlightedCode] = useState<string>("")
	const [isLoading, setIsLoading] = useState(true)

	// Determine the Shiki theme based on the VS Code theme name
	const shikiTheme = themeMap[vsCodeTheme?.name || ""] || "github-dark" // Default to github-dark

	useEffect(() => {
		let isMounted = true
		setIsLoading(true)

		const highlight = async () => {
			if (!source) {
				setHighlightedCode("")
				setIsLoading(false)
				return
			}

			// Extract language and code from the source string (```lang\ncode\n```)
			const match = source.match(/^```(\w+)?\n([\s\S]*)\n```$/)
			const lang = match?.[1] || "plaintext" // Default to plaintext if no lang specified
			const code = match?.[2] || source // Fallback to using the whole source if parsing fails

			try {
				const html = await codeToHtml(code, {
					lang: lang,
					theme: shikiTheme,
					// Add diff support if needed
					transformers:
						lang === "diff"
							? [
									{
										name: "diff-transformer",
										code(node) {
											// Basic diff line styling (can be enhanced)
											node.children.forEach((line: any) => {
												if (
													line.type === "element" &&
													line.properties?.className?.includes("line")
												) {
													const firstChild = line.children?.[0]?.children?.[0]
													if (firstChild?.type === "text") {
														if (firstChild.value.startsWith("+")) {
															line.properties.className = (
																line.properties.className || []
															).concat(["diff", "add"])
														} else if (firstChild.value.startsWith("-")) {
															line.properties.className = (
																line.properties.className || []
															).concat(["diff", "remove"])
														}
													}
												}
											})
										},
									},
								]
							: [],
				})
				if (isMounted) {
					setHighlightedCode(html)
				}
			} catch (error) {
				console.error("Shiki highlighting failed:", error)
				// Fallback to plain code rendering on error
				if (isMounted) {
					setHighlightedCode(`<pre><code>${code}</code></pre>`)
				}
			} finally {
				if (isMounted) {
					setIsLoading(false)
				}
			}
		}

		highlight()

		return () => {
			isMounted = false
		}
	}, [source, shikiTheme]) // Re-run when source or theme changes

	// overflowX is handled by the parent CodeAccordian's scrollable div
	return (
		<div
			style={{
				// overflowY: forceWrap ? "visible" : "auto", // Let parent handle scroll
				// maxHeight: forceWrap ? "none" : "100%", // Let parent handle height
				backgroundColor: CODE_BLOCK_BG_COLOR, // Keep background consistent
			}}>
			{isLoading ? (
				// Optional: Show a loading indicator
				<ShikiContainer forceWrap={forceWrap}>
					<pre>
						<code>Loading code...</code>
					</pre>
				</ShikiContainer>
			) : (
				<ShikiContainer forceWrap={forceWrap} dangerouslySetInnerHTML={{ __html: highlightedCode }} />
			)}
		</div>
	)
})

export default CodeBlock
