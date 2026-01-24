#!/bin/bash

echo "Starting installation process..."
echo "Cloning repository..."
git clone git@github.com:Kahono0/fantastic-fortnight.git issue-app
cd issue-app || { echo "Failed to enter directory"; exit 1; }
echo "Installing dependencies..."
npm install || { echo "Dependency installation failed"; exit 1; }
echo "Building the project..."
npm run make || { echo "Build failed"; exit 1; }
echo "Installation completed successfully."
