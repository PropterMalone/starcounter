#!/usr/bin/env node
// Generate a simple OG image for Starcounter
// Run: node scripts/generate-og-image.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple 1200x630 PNG with Starcounter branding
// This creates a minimal PNG with text overlay
// For a better image, replace public/og-image.png with a designed asset

const width = 1200;
const height = 630;

// Create a simple HTML file that can be screenshotted
// (Easier than generating PNG from scratch in Node without canvas deps)
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${width}px;
      height: ${height}px;
      background: linear-gradient(135deg, #1185fe 0%, #0066cc 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: white;
    }
    .logo {
      font-size: 120px;
      font-weight: 700;
      margin-bottom: 20px;
      text-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .tagline {
      font-size: 36px;
      opacity: 0.9;
      text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .icon {
      font-size: 80px;
      margin-bottom: 30px;
    }
  </style>
</head>
<body>
  <div class="icon">⭐</div>
  <div class="logo">Starcounter</div>
  <div class="tagline">Analyze media mentions in Bluesky threads</div>
</body>
</html>`;

const outputDir = path.join(__dirname, '..', 'public');
const htmlPath = path.join(outputDir, 'og-image-template.html');

fs.writeFileSync(htmlPath, html);

console.log('Generated og-image-template.html');
console.log('');
console.log('To create the PNG:');
console.log('1. Open public/og-image-template.html in a browser');
console.log('2. Take a screenshot at exactly 1200x630 pixels');
console.log('3. Save as public/og-image.png');
console.log('');
console.log('Or use a tool like Playwright:');
console.log('  npx playwright screenshot --viewport-size=1200,630 public/og-image-template.html public/og-image.png');
