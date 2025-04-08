#!/bin/bash

# This script demonstrates how to use the roo-config CLI tool

# Enable the bridge in VS Code settings
echo "Enabling the Roo Configuration Bridge in VS Code settings..."
cat << EOF > ~/.vscode/settings.json
{
  "roo.bridge.enabled": true
}
EOF

echo "Make sure VS Code is running with the Roo Code With CLI extension active."
echo "The extension will start the IPC bridge server when enabled."
echo ""

# Wait for user confirmation
read -p "Press Enter to continue with the demo..."

# List all configurations
echo "Listing all configurations..."
roo-config list
echo ""

# Save a new configuration
echo "Saving a new configuration..."
roo-config save demo-config --provider openai --apiKey "sk-demo-key"
echo ""

# List configurations again to see the new one
echo "Listing configurations again..."
roo-config list
echo ""

# Assign the configuration to a mode
echo "Assigning the configuration to the 'code' mode..."
roo-config assign-mode code demo-config
echo ""

# Get the configuration for a mode
echo "Getting the configuration for the 'code' mode..."
roo-config get-mode code
echo ""

echo "Demo completed successfully!"