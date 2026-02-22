#!/usr/bin/env node
import { readFileSync } from 'fs';

const fixture = JSON.parse(readFileSync('bench/fixtures/karaoke-songs.json', 'utf-8'));
const posts = fixture.posts;
const rootUri = posts[0].uri;

console.log('Root URI:', rootUri);
console.log('Root text (first 200 chars):', (posts[0].text || '').slice(0, 200));
console.log('Root fullText (first 200 chars):', (posts[0].fullText || '').slice(0, 200));
console.log();

// Check how many posts quote the root vs quote other posts that mention Nick Cave
let quoteRoot = 0;
let quoteOtherWithNC = 0;
let ncInOwnText = 0;
let ncInSearchText = 0; // after exclusion logic
const quoteOtherExamples = [];

for (const post of posts) {
  if (post.uri === rootUri) continue;

  const ownText = post.fullText || post.text || '';
  let searchText = ownText;
  if (post.quotedText && post.quotedUri !== rootUri) {
    searchText += '\n' + post.quotedText;
  }

  if (ownText.toLowerCase().includes('nick cave')) ncInOwnText++;
  if (searchText.toLowerCase().includes('nick cave')) ncInSearchText++;

  if (post.quotedText?.toLowerCase().includes('nick cave')) {
    if (post.quotedUri === rootUri) {
      quoteRoot++;
    } else {
      quoteOtherWithNC++;
      if (quoteOtherExamples.length < 5) {
        quoteOtherExamples.push({
          handle: post.author?.handle,
          text: (post.text || '').slice(0, 80),
          quotedUri: post.quotedUri,
          quotedText: (post.quotedText || '').slice(0, 100),
        });
      }
    }
  }
}

console.log('Posts quoting ROOT (with Nick Cave in quoted text):', quoteRoot);
console.log('Posts quoting OTHER post (with Nick Cave in quoted text):', quoteOtherWithNC);
console.log('Posts with Nick Cave in own text:', ncInOwnText);
console.log('Posts with Nick Cave in SEARCH text (after root exclusion):', ncInSearchText);
console.log();

if (quoteOtherExamples.length > 0) {
  console.log('Examples of non-root quotes with Nick Cave:');
  for (const ex of quoteOtherExamples) {
    console.log(`\n  @${ex.handle}: ${ex.text}`);
    console.log(`    quotedUri: ${ex.quotedUri}`);
    console.log(`    quotedText: ${ex.quotedText}`);
  }
}

// Check the root post text for Nick Cave
const rootText = posts[0].text || posts[0].fullText || '';
console.log('\n\nFULL ROOT POST TEXT:');
console.log(rootText);
