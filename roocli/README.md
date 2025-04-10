# Roo CLI

The Roo CLI provides a command-line interface to interact with the Roo Code extension in VS Code.

## Installation

```bash
npm install -g @mayahq/roocli
```

## Usage

### Basic Usage

```bash
# Send a message using the current profile
roo "Write a function to calculate the factorial of a number"

# Start interactive mode
roo
```

### Profile Management

Profiles allow you to configure different combinations of modes and providers for different use cases.

#### Configure a New Profile

```bash
# Configure a new profile with a specific mode and provider
roo configure profile my-gpt4 --mode code --provider openai/gpt-4

# Configure a profile for Anthropic Claude
roo configure profile my-claude --mode code --provider anthropic/claude-3-opus-20240229
```

#### List Available Profiles

```bash
# List all configured profiles
roo list profiles
```

#### Switch Default Profile

```bash
# Set a profile as the default for subsequent commands
roo use my-gpt4
```

#### Use a Specific Profile for a Single Message

```bash
# Send a message using a specific profile without changing the default
roo use my-claude "Explain quantum computing in simple terms"
```

### Other Options

```bash
# Show help
roo --help

# Show version
roo --version

# Enable verbose logging
roo --verbose "Generate a React component"
```

## Environment Variables

- `ROO_VERBOSE`: Set to `1` to enable verbose logging
- `ROO_TIMEOUT`: Set the timeout in milliseconds for non-interactive commands (default: 60000)

## Examples

```bash
# Configure a profile for code generation
roo configure profile code-gen --mode code --provider openai/gpt-4

# Configure a profile for architectural discussions
roo configure profile architect --mode architect --provider anthropic/claude-3-opus-20240229

# Use the code generation profile
roo use code-gen

# Send a message with the architect profile
roo use architect "Design a microservice architecture for an e-commerce platform"
```
