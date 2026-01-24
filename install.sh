#!/bin/bash

# This script installs Node.js and npm on a Mac os system
echo "Checking NVM installation..."
if ! command -v nvm &> /dev/null
then
    echo "NVM not found. Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
else
    echo "NVM is already installed."
fi

echo "Installing Node.js LTS version..."
nvm install --lts

echo "Setting Node.js LTS version as default..."
nvm use --lts
nvm alias default 'lts/*'
echo "Node.js and npm installation complete."

echo "Verifying installations..."
node_version=$(node -v)
npm_version=$(npm -v)
echo "Node.js version: $node_version"
echo "npm version: $npm_version"
echo "Installation successful!"

echo "Starting app installation process..."
echo "Cloning repository..."
git clone git@github.com:Kahono0/fantastic-fortnight.git issue-app
cd issue-app || { echo "Failed to enter directory"; exit 1; }
echo "Installing dependencies..."
npm install || { echo "Dependency installation failed"; exit 1; }
echo "Building the project..."
npm run make || { echo "Build failed"; exit 1; }
echo "Installation completed successfully."

echo "Installing the app..."
# find .app file in out/make directory
app_path=$(find out -name "*.app" | head -n 1)
if [ -z "$app_path" ]; then
    echo "App file not found!"
    exit 1
fi
echo "Found app at $app_path"
cp -R "$app_path" /Applications/ || { echo "Failed to copy app to Applications"; exit 1; }
echo "App installed to /Applications successfully."
