#!/usr/bin/env node
/**
 * Reads a fixture file and produces a compact text view for labeling.
 * Shows thread structure with indentation, post text, and parent context.
 */

import { readFileSync } from 'fs';

const fixturePath = process.argv[2] || 'bench/fixtures/dad-movies.json';
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// Build a lookup from URI to post for parent context
const postsByUri = new Map();
for (const p of fixture.posts) {
  postsByUri.set(p.uri, p);
}

// Print each post with context
let idx = 0;
for (const p of fixture.posts) {
  const indent = '  '.repeat(Math.min(p.depth, 4));
  const parentText = p.parentUri ? postsByUri.get(p.parentUri)?.text?.slice(0, 60) : null;
  const replyTo = parentText ? ` [reply to: "${parentText}..."]` : '';
  const imgNote = p.hasImages ? ' [HAS IMAGE]' : '';
  const altText = p.fullText !== p.text ? `\n${indent}  ALT: ${p.fullText.replace(p.text, '').trim()}` : '';
  const quoteNote = p.quotedText ? `\n${indent}  QUOTES: "${p.quotedText.slice(0, 80)}"` : '';

  console.log(`${String(idx).padStart(3)}|${indent}@${p.author?.handle}: ${p.text}${imgNote}${replyTo}${altText}${quoteNote}`);
  idx++;
}
