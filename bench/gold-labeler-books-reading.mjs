#!/usr/bin/env node
/**
 * Gold-standard labeler for the books-reading benchmark fixture.
 *
 * Thread prompt: "QUESTION: What books are you all reading?"
 * 181 posts total, covering 100+ unique book titles.
 *
 * Two-tier approach:
 *   1. Title dictionary for repeated/common titles (1929, Fatherland, Expanse, etc.)
 *   2. Manual override map keyed by URI suffix for post-specific labels.
 *   3. Context inheritance for reaction/agreement posts.
 *
 * Usage: node bench/gold-labeler-books-reading.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'books-reading.json');
const OUTPUT_DIR = join(__dirname, 'labels');
const OUTPUT_PATH = join(OUTPUT_DIR, 'books-reading-gold.json');

const MAX_INHERITANCE_DEPTH = 2;

// ---------------------------------------------------------------------------
// 1. Title dictionary (repeated/recognizable titles only)
// ---------------------------------------------------------------------------

/**
 * Canonical title -> array of match patterns (lowercase).
 * Only includes titles that appear multiple times or benefit from pattern matching.
 * Single-mention titles are handled by the manual override map.
 */
const TITLE_PATTERNS = new Map([
  ['1929', ['1929']],
  ['Hyperion', ['hyperion']],
  ['Fatherland', ['fatherland']],
  ['The Expanse', ['the expanse', 'expanse series', 'expanse books']],
  [
    'There Is No Antimemetics Division',
    ['no antimemetics division', 'antimemetics division'],
  ],
  ['Night Watch', ['night watch']],
  ['Discworld', ['discworld']],
  ['On Time and Water', ['on time and water']],
  ['Rose Madder', ['rose madder']],
  ['Anna Karenina', ['anna karenina']],
  ['Hatchet', ['hatchet']],
  ['The Correspondent', ['the correspondent']],
  ['How to Change Your Mind', ['how to change your mind']],
  ['Company Wars', ['company wars']],
  ['Old Path White Clouds', ['old path white clouds']],
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTitles(text) {
  if (!text || text.trim().length === 0) return [];
  const lower = text.toLowerCase();
  const found = new Set();

  for (const [canonical, patterns] of TITLE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.length <= 5) {
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i');
        if (regex.test(lower)) {
          found.add(canonical);
          break;
        }
      } else {
        if (lower.includes(pattern)) {
          found.add(canonical);
          break;
        }
      }
    }
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// 2. Reaction detection
// ---------------------------------------------------------------------------

const REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|agreed|exactly|this|same|thanks|ty)[\s!.,\u2026]*$/i,
  /^.{0,3}$/,
  /^[\s!?\u{1F44D}\u{1F44F}\u{1F525}\u{1F60D}\u{1F64F}\u{2764}\u{1F60A}]+$/u,
  /^(so,?\s*so\s*good)[\s!.]*$/i,
  /^(love (this|that|it)|loved (this|that|it))[\s!.]*$/i,
  /^(great choice|good choice|fascinating)[\s!.]*$/i,
  /^(thanks for the lead)[\s!.]*$/i,
  /^(TY,?\s*Sir)[\s!.]*$/i,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;

  for (const pattern of REACTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;

  return false;
}

function getOwnText(post) {
  return post.fullText || post.text || '';
}

// ---------------------------------------------------------------------------
// 3. Manual override map (URI suffix -> label)
// ---------------------------------------------------------------------------

/**
 * Each entry: URI suffix -> { topics, onTopic, confidence, note }
 * This is the ground truth for every post, keyed by the last segment of the AT URI.
 */
const MANUAL_OVERRIDES = new Map([
  // Post 0: Root prompt
  [
    '3me7he3bflc2u',
    { topics: [], onTopic: false, confidence: 'high', note: 'Root prompt' },
  ],

  // Post 1: Jo Nesbo the Harry Hole series
  [
    '3me7s7ybfxk2x',
    { topics: ['Harry Hole series'], onTopic: true, confidence: 'high' },
  ],

  // Post 2: The Index of Self-Destructive Acts
  [
    '3me7hwpg2pc2m',
    {
      topics: ['The Index of Self-Destructive Acts'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 3: Interior Chinatown + Elmore Leonard bio
  [
    '3me7qzuaggs2s',
    {
      topics: ['Interior Chinatown', 'Elmore Leonard biography'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 4: The Hadacol Boogie
  [
    '3me7hxvr3e22s',
    { topics: ['The Hadacol Boogie'], onTopic: true, confidence: 'high' },
  ],

  // Post 5: "So, so good" -> inherit The Hadacol Boogie
  [
    '3meegcuwbyc2q',
    {
      topics: ['The Hadacol Boogie'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 6: The Unselected Journals of Emma M. Lion
  [
    '3me7kvy3rf22m',
    {
      topics: ['The Unselected Journals of Emma M. Lion'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 7: Cosmos + Hyperion
  [
    '3me7om5jup22y',
    { topics: ['Cosmos', 'Hyperion'], onTopic: true, confidence: 'high' },
  ],

  // Post 8: Hyperion discussion
  [
    '3me7pqwwrtc2p',
    { topics: ['Hyperion'], onTopic: true, confidence: 'high' },
  ],

  // Post 9: Paper by Mark Kurlansky
  [
    '3me7ophuqcc2m',
    { topics: ['Paper'], onTopic: true, confidence: 'high' },
  ],

  // Post 10: "Thanks for the lead!" -> inherit Paper
  [
    '3me7yh6lnoc2d',
    {
      topics: ['Paper'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 11: wwnorton.com link, on-topic but title unclear
  [
    '3me7irzbcwc22',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic but title unclear from URL alone',
    },
  ],

  // Post 12: The Immortal King Rao
  [
    '3me7i4i3yuk2e',
    {
      topics: ['The Immortal King Rao'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 13: 1929
  ['3me7vuerkk22n', { topics: ['1929'], onTopic: true, confidence: 'high' }],

  // Post 14: The Rise and Fall of the Galactic Empire
  [
    '3me7n45nmkk25',
    {
      topics: ['The Rise and Fall of the Galactic Empire'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 15: The Times
  [
    '3me7ht7x44s2m',
    { topics: ['The Times'], onTopic: true, confidence: 'high' },
  ],

  // Post 16: The Alchemist + Chronicles of Narnia + Mexican Gothic
  [
    '3me7mkxgbyc2p',
    {
      topics: ['The Alchemist', 'The Chronicles of Narnia', 'Mexican Gothic'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 17: "You might try this one" with image
  [
    '3me7hgtyyrc2u',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic image recommendation',
    },
  ],

  // Post 18: Snake Eater + Sheepfarmer's Daughter
  [
    '3mealfz3hr22q',
    {
      topics: ['Snake Eater', "Sheepfarmer's Daughter"],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 19: The Breakdown of Democratic Regimes + The Way We Live Now
  [
    '3me7hqra6ns2m',
    {
      topics: ['The Breakdown of Democratic Regimes', 'The Way We Live Now'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 20: Too Like the Lightning
  [
    '3me7zrmi2ac2v',
    {
      topics: ['Too Like the Lightning'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 21: Amartya Sen memoir + Robbie Robertson memoir
  [
    '3meafwlakjc2l',
    {
      topics: ['Amartya Sen memoir', 'Robbie Robertson memoir'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 22: audiobook discussion -> Robbie Robertson memoir (inherit)
  [
    '3medzxyae7he3',
    {
      topics: ['Robbie Robertson memoir'],
      onTopic: true,
      confidence: 'medium',
      note: 'Discusses Robbie Robertson audiobook, inherits from parent',
    },
  ],

  // Post 23: The Last Waltz discussion
  [
    '3meaimhyai22t',
    {
      topics: ['The Last Waltz'],
      onTopic: true,
      confidence: 'medium',
      note: 'Discusses The Last Waltz in context of memoir discussion',
    },
  ],

  // Post 24: The Mirror and the Light + When The Going Was Good + Surrender
  [
    '3me7wuv5q5k2n',
    {
      topics: [
        'The Mirror and the Light',
        'When The Going Was Good',
        'Surrender',
      ],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 25: The Uninnocent
  [
    '3me7jb5grws2y',
    { topics: ['The Uninnocent'], onTopic: true, confidence: 'high' },
  ],

  // Post 26: Life During Wartime
  [
    '3me7vrnzjjs2e',
    { topics: ['Life During Wartime'], onTopic: true, confidence: 'high' },
  ],

  // Post 27: "good messed-up sci-fi" -> inherit Life During Wartime
  [
    '3me7vuiyor22n',
    {
      topics: ['Life During Wartime'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 28: Born in Flames
  [
    '3mebype2xtk2h',
    { topics: ['Born in Flames'], onTopic: true, confidence: 'high' },
  ],

  // Post 29: The Tennis Partner
  [
    '3me7ytt5bgs2r',
    { topics: ['The Tennis Partner'], onTopic: true, confidence: 'high' },
  ],

  // Post 30: Tress of the Emerald Sea + The King in Yellow
  [
    '3meajh7t5dk2r',
    {
      topics: ['Tress of the Emerald Sea', 'The King in Yellow'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 31: 1929 + All Quiet on the Western Front
  [
    '3me7yceggfc2d',
    {
      topics: ['1929', 'All Quiet on the Western Front'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 32: Folding the World
  [
    '3me7hwudfuc2g',
    { topics: ['Folding the World'], onTopic: true, confidence: 'high' },
  ],

  // Post 33: The Sisters
  [
    '3me7ht7duvc23',
    { topics: ['The Sisters'], onTopic: true, confidence: 'high' },
  ],

  // Post 34: The Hidden Life of Trees + How To Stand Up To A Dictator + The Bird Hotel + 1984
  [
    '3mefokki75k2d',
    {
      topics: [
        'The Hidden Life of Trees',
        'How To Stand Up To A Dictator',
        'The Bird Hotel',
        '1984',
      ],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 35: Three Bags Full
  [
    '3me7w35srmc24',
    { topics: ['Three Bags Full'], onTopic: true, confidence: 'high' },
  ],

  // Post 36: "I started the audiobook last weekend..." (unclear which book)
  [
    '3mecwinreqs2w',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic but specific title unclear',
    },
  ],

  // Post 37: The Elephant in the Room
  [
    '3mecvcpqctc22',
    {
      topics: ['The Elephant in the Room'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 38: In Memoriam + When the Sea Came Alive
  [
    '3meafr4vdec2h',
    {
      topics: ['In Memoriam', 'When the Sea Came Alive'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 39: Discworld + Small Gods + Night Watch
  [
    '3me7hvnfthk2j',
    {
      topics: ['Discworld', 'Small Gods', 'Night Watch'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 40: continuation of Pratchett discussion
  [
    '3me7hvnqibs2j',
    {
      topics: ['Discworld'],
      onTopic: true,
      confidence: 'high',
      note: 'Continues Discworld discussion',
    },
  ],

  // Post 41: Wyrd Sisters
  [
    '3me7yredk4s2p',
    { topics: ['Wyrd Sisters'], onTopic: true, confidence: 'high' },
  ],

  // Post 42: Unseen Academicals
  [
    '3meafyb6g2k2r',
    { topics: ['Unseen Academicals'], onTopic: true, confidence: 'high' },
  ],

  // Post 43: Night Watch is excellent
  [
    '3mea2euyaxs24',
    { topics: ['Night Watch'], onTopic: true, confidence: 'high' },
  ],

  // Post 44: QT of The Blue Machine
  [
    '3me7voyc5h22b',
    { topics: ['The Blue Machine'], onTopic: true, confidence: 'high' },
  ],

  // Post 45: Cold Comfort Farm
  [
    '3me7u4oanx22e',
    { topics: ['Cold Comfort Farm'], onTopic: true, confidence: 'high' },
  ],

  // Post 46: The Last Lion
  [
    '3me7xzu6nt3bv',
    { topics: ['The Last Lion'], onTopic: true, confidence: 'high' },
  ],

  // Post 47: "Love that book" -> inherit The Last Lion
  [
    '3me7ylbahsk2t',
    {
      topics: ['The Last Lion'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 48: "TY, Sir!" -> reaction (inherit)
  [
    '3meca5u5ops2j',
    {
      topics: ['The Last Lion'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent chain',
    },
  ],

  // Post 49: Kings and Pawns (with image)
  [
    '3mebzesncmk23',
    { topics: ['Kings and Pawns'], onTopic: true, confidence: 'high' },
  ],

  // Post 50: Reconstruction books + El Paso + Fatherland
  [
    '3me7vwgy7g225',
    {
      topics: ['Reconstruction books', 'El Paso', 'Fatherland'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 51: off-topic Bluesky Lullaby discussion
  [
    '3me7wox4jjc25',
    {
      topics: [],
      onTopic: false,
      confidence: 'low',
      note: 'Off-topic meta discussion about Bluesky Lullaby posts',
    },
  ],

  // Post 52: "that's so very kind" -> off-topic
  [
    '3me7ynbnqqk2t',
    {
      topics: [],
      onTopic: false,
      confidence: 'low',
      note: 'Off-topic social reply',
    },
  ],

  // Post 53: "I read Fatherland in safer times..." -> Fatherland
  [
    '3meegbm2je22q',
    { topics: ['Fatherland'], onTopic: true, confidence: 'high' },
  ],

  // Post 54: "Very well done audiobook" with image
  [
    '3meaomsyymk2j',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic audiobook recommendation with image',
    },
  ],

  // Post 55: "A compelling look at a very complex figure..." with image
  [
    '3meahbmui2s2e',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic book with image, title in image alt text but truncated',
    },
  ],

  // Post 56: On Time and Water
  [
    '3meagitesuc2g',
    { topics: ['On Time and Water'], onTopic: true, confidence: 'high' },
  ],

  // Post 57: The Long Way to a Small, Angry Planet
  [
    '3mea2n7u7c224',
    {
      topics: ['The Long Way to a Small, Angry Planet'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 58: "loving it and its sequel" -> inherit
  [
    '3meadabx53k2q',
    {
      topics: ['The Long Way to a Small, Angry Planet'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 59: "This is the latest hit..." with image
  [
    '3me7hw7s3ok2e',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic with external link/image',
    },
  ],

  // Post 60: The Reformatory
  [
    '3meahj6a6bc2y',
    { topics: ['The Reformatory'], onTopic: true, confidence: 'high' },
  ],

  // Post 61: Copaganda
  [
    '3me7ihpheec2m',
    { topics: ['Copaganda'], onTopic: true, confidence: 'high' },
  ],

  // Post 62: Valiant Ambition + A Tomb with a View + The Last Devil to Die
  [
    '3me7hlq66wc23',
    {
      topics: ['Valiant Ambition', 'A Tomb with a View', 'The Last Devil to Die'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 63: Blue Mars
  [
    '3me7lg5m5ys2f',
    { topics: ['Blue Mars'], onTopic: true, confidence: 'high' },
  ],

  // Post 64: "yeah, that's how I remember" -> inherit Blue Mars
  [
    '3me7ltfhcj22u',
    {
      topics: ['Blue Mars'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 65: The Correspondent + Theo of Golden
  [
    '3meaftn7his2q',
    {
      topics: ['The Correspondent', 'Theo of Golden'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 66: Written on the Dark + Tigana
  [
    '3me7hv6j5kk2y',
    {
      topics: ['Written on the Dark', 'Tigana'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 67: In Search of Lost Time
  [
    '3meafk26owc2k',
    {
      topics: ['In Search of Lost Time'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 68: Phantoms of a Beleaguered Republic
  [
    '3me7vnlddhc2k',
    {
      topics: ['Phantoms of a Beleaguered Republic'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 69: How to Change Your Mind
  [
    '3meefrcwhks2q',
    {
      topics: ['How to Change Your Mind'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 70: michaelpollan.com link -> continuation
  [
    '3meefrpkn5s2q',
    {
      topics: ['How to Change Your Mind'],
      onTopic: true,
      confidence: 'medium',
      note: 'Link to Michael Pollan book, continues parent discussion',
    },
  ],

  // Post 71: "It's a fascinating read..." -> continuation
  [
    '3meefzti3ec2q',
    {
      topics: ['How to Change Your Mind'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues discussion of How to Change Your Mind',
    },
  ],

  // Post 72: Katabasis
  [
    '3me7hya34us24',
    { topics: ['Katabasis'], onTopic: true, confidence: 'high' },
  ],

  // Post 73: The Demon of Unrest
  [
    '3meapjbscz22v',
    { topics: ['The Demon of Unrest'], onTopic: true, confidence: 'high' },
  ],

  // Post 74: Company Wars (3rd book)
  [
    '3meab7ho2ok2w',
    { topics: ['Company Wars'], onTopic: true, confidence: 'high' },
  ],

  // Post 75: continuation of Company Wars
  [
    '3meab7hrmws2w',
    {
      topics: ['Company Wars'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues Company Wars discussion',
    },
  ],

  // Post 76: What a Plant Knows + Quantum Gravity + My Murder
  [
    '3me7vw5lw222r',
    {
      topics: ['What a Plant Knows', 'Quantum Gravity', 'My Murder'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 77: The Anarchist Toolchest
  [
    '3mecasqs67s2m',
    {
      topics: ['The Anarchist Toolchest'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 78: A Brief History of Ireland
  [
    '3me7icrlzrs23',
    {
      topics: ['A Brief History of Ireland'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 79: A Brotherhood Betrayed + Bright Young Women
  [
    '3me7nimiau223',
    {
      topics: ['A Brotherhood Betrayed', 'Bright Young Women'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 80: Golden Son
  [
    '3mec2jntlos2v',
    { topics: ['Golden Son'], onTopic: true, confidence: 'high' },
  ],

  // Post 81: Proof of My Innocence + Amsterdam + Man in the Queue
  [
    '3me7nqfz3wp22',
    {
      topics: ['Proof of My Innocence', 'Amsterdam', 'Man in the Queue'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 82: Anna Karenina
  [
    '3me7nju42y42k',
    { topics: ['Anna Karenina'], onTopic: true, confidence: 'high' },
  ],

  // Post 83: "time for a reread!" -> inherit Anna Karenina
  [
    '3me7prijio22p',
    {
      topics: ['Anna Karenina'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 84: "It's the kind of book that changes with age" -> Anna Karenina
  [
    '3meafa4unxj22',
    {
      topics: ['Anna Karenina'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues Anna Karenina discussion',
    },
  ],

  // Post 85: Jesse James: Last Rebel of the Civil War
  [
    '3me7hs6x4522z',
    {
      topics: ['Jesse James: Last Rebel of the Civil War'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 86: Thursday Murder Club
  [
    '3meam2ylgyk26',
    { topics: ['Thursday Murder Club'], onTopic: true, confidence: 'high' },
  ],

  // Post 87: "Wrote up my recent list here..." with blog link
  [
    '3me7whamz4s2c',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic blog link with book list',
    },
  ],

  // Post 88: image only (empty text)
  [
    '3me7pmn3okk2c',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'Image-only post, likely shows a book',
    },
  ],

  // Post 89: "I just finished James about a month ago" -> James
  [
    '3meahjjywvs2t',
    { topics: ['James'], onTopic: true, confidence: 'high' },
  ],

  // Post 90: "Re-upping one last time..." (QT of root)
  [
    '3mecsxyy5222t',
    {
      topics: [],
      onTopic: false,
      confidence: 'high',
      note: 'Re-up post',
    },
  ],

  // Post 91: Aeschylus' Persians (QT)
  [
    '3mebzj2zd2k2j',
    { topics: ['The Persians'], onTopic: true, confidence: 'high' },
  ],

  // Post 92: There Is No Antimemetics Division (QT)
  [
    '3mebzcbf7ik23',
    {
      topics: ['There Is No Antimemetics Division'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 93: "Re-upping for the weekenders:" (QT)
  [
    '3mebylaicms2y',
    {
      topics: [],
      onTopic: false,
      confidence: 'high',
      note: 'Re-up post',
    },
  ],

  // Post 94: Miracles and Wonder + Zealot + The Night Ship + Dead First + The Old Magic of Christmas
  [
    '3meaipalsr22w',
    {
      topics: [
        'Miracles and Wonder',
        'Zealot',
        'The Night Ship',
        'Dead First',
        'The Old Magic of Christmas',
      ],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 95: On Time and Water (duplicate of post 56, QT)
  [
    '3meagjoncrs2g',
    { topics: ['On Time and Water'], onTopic: true, confidence: 'high' },
  ],

  // Post 96: "Re-upping for the evening crowd:" (QT)
  [
    '3meafgiikys2s',
    {
      topics: [],
      onTopic: false,
      confidence: 'high',
      note: 'Re-up post',
    },
  ],

  // Post 97: "Thanks for all the replies..." (QT)
  [
    '3me7vkidxyc2n',
    {
      topics: [],
      onTopic: false,
      confidence: 'high',
      note: 'Re-up post',
    },
  ],

  // Post 98: The Warehouse
  [
    '3mectfh4a7k2i',
    { topics: ['The Warehouse'], onTopic: true, confidence: 'high' },
  ],

  // Post 99: Rules of Civility
  [
    '3mecuv23ofc26',
    { topics: ['Rules of Civility'], onTopic: true, confidence: 'high' },
  ],

  // Post 100: image/link with "good series"
  [
    '3mectr2lpms2m',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic with image/link but title not clear from text',
    },
  ],

  // Post 101: Victorian Psycho
  [
    '3mectifk4fs2w',
    { topics: ['Victorian Psycho'], onTopic: true, confidence: 'high' },
  ],

  // Post 102: Seven Years of Darkness
  [
    '3mectz5af5c2w',
    {
      topics: ['Seven Years of Darkness'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 103: Mortal Republic
  [
    '3mecuqgvygk2c',
    { topics: ['Mortal Republic'], onTopic: true, confidence: 'high' },
  ],

  // Post 104: Shadow Ticket
  [
    '3mectsibkwc2i',
    { topics: ['Shadow Ticket'], onTopic: true, confidence: 'high' },
  ],

  // Post 105: 1929 + Mercy in the City
  [
    '3mectibmoqc2i',
    {
      topics: ['1929', 'Mercy in the City'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 106: The Best and the Brightest
  [
    '3mecvi4cuj22r',
    {
      topics: ['The Best and the Brightest'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 107: Helm
  [
    '3mectpok2as2i',
    { topics: ['Helm'], onTopic: true, confidence: 'high' },
  ],

  // Post 108: Every Living Thing
  [
    '3mectgfhai22p',
    { topics: ['Every Living Thing'], onTopic: true, confidence: 'high' },
  ],

  // Post 109: Runelord
  [
    '3mect47hbac26',
    { topics: ['Runelord'], onTopic: true, confidence: 'high' },
  ],

  // Post 110: "My worlds colliding in this post..." -> meta/reaction
  [
    '3mebzocuc5k2m',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'Meta reaction to the thread',
    },
  ],

  // Post 111: "planning on starting that after I finish..." -> meta
  [
    '3mec2it55vc24',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'Meta comment about reading plans',
    },
  ],

  // Post 112: "Will be curious what you think!" -> meta
  [
    '3mec2l5zlgs23',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'Meta encouragement',
    },
  ],

  // Post 113: "Me going to open up Libby on the Tenet comp" -> Antimemetics Division reference
  [
    '3mebzojsz422n',
    {
      topics: ['There Is No Antimemetics Division'],
      onTopic: true,
      confidence: 'medium',
      note: 'Context reference to Antimemetics Division (Tenet comparison)',
    },
  ],

  // Post 114: "Curious what you'll think of it!" -> meta
  [
    '3mebzpgq2o223',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'Meta encouragement',
    },
  ],

  // Post 115: "My mistake was trying to do it on audiobook..." -> Antimemetics Division
  [
    '3mec2kbbpvc2k',
    {
      topics: ['There Is No Antimemetics Division'],
      onTopic: true,
      confidence: 'medium',
      note: 'Discusses Antimemetics Division audiobook experience',
    },
  ],

  // Post 116: "it's a tough structure..." -> Antimemetics Division
  [
    '3mec2nh4rwk23',
    {
      topics: ['There Is No Antimemetics Division'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues Antimemetics Division structure discussion',
    },
  ],

  // Post 117: "My theory on Tenet..." -> off-topic (movie, not book)
  [
    '3mebzwkjp7s27',
    {
      topics: [],
      onTopic: false,
      confidence: 'low',
      note: 'Off-topic, discussing Tenet the movie not a book',
    },
  ],

  // Post 118: The Iliad or The Poem of Force
  [
    '3mebzhop4ak2m',
    {
      topics: ['The Iliad or The Poem of Force'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 119: Hatchet
  [
    '3mecjmlyyzk25',
    { topics: ['Hatchet'], onTopic: true, confidence: 'high' },
  ],

  // Post 120: "My own fifth-grader loves it!" -> Hatchet
  [
    '3mecjrvbn2k2z',
    {
      topics: ['Hatchet'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting Hatchet from parent',
    },
  ],

  // Post 121: image showing book
  [
    '3mec4obghuk2g',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic image post',
    },
  ],

  // Post 122: Foundational Papers in Complexity Science
  [
    '3mebyojsvys2t',
    {
      topics: ['Foundational Papers in Complexity Science'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 123: "This one is so good" with link
  [
    '3mecjiq452c2p',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic with bookshop.org link',
    },
  ],

  // Post 124: Howards End + Shy (Mary Rodgers memoir)
  [
    '3mec27iuecc24',
    { topics: ['Howards End', 'Shy'], onTopic: true, confidence: 'high' },
  ],

  // Post 125: East of Eden
  [
    '3mebyrrsle22s',
    { topics: ['East of Eden'], onTopic: true, confidence: 'high' },
  ],

  // Post 126: "Just finished, thoroughly enjoyed..." with link
  [
    '3mecjrn6qus2a',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic but title only in link',
    },
  ],

  // Post 127: Culture in the Age of Three Worlds (from alt text)
  [
    '3mebzkztux22m',
    {
      topics: ['Culture in the Age of Three Worlds'],
      onTopic: true,
      confidence: 'high',
      note: 'Title from image alt text',
    },
  ],

  // Post 128: Trump: A Tool Of US Hegemony?
  [
    '3mec3zfpydc2r',
    {
      topics: ['Trump: A Tool Of US Hegemony?'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 129: Jungle House + Costs of Connection
  [
    '3mebymdx6zs25',
    {
      topics: ['Jungle House', 'Costs of Connection'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 130: The Expanse + The Haunting of Hill House + On Writing + The Book of the Long Sun
  [
    '3mebyzqfgl22q',
    {
      topics: [
        'The Expanse',
        'The Haunting of Hill House',
        'On Writing',
        'The Book of the Long Sun',
      ],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 131: Cyberselfish
  [
    '3mebz5ngvh22b',
    { topics: ['Cyberselfish'], onTopic: true, confidence: 'high' },
  ],

  // Post 132: "still on my history of early Christianity kick" -> on-topic
  [
    '3meaiqc5aek2w',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic but no specific title named',
    },
  ],

  // Post 133: 1929 + The Correspondent
  [
    '3meaiibqxb22s',
    {
      topics: ['1929', 'The Correspondent'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 134: Fantastic Numbers and Where to Find Them
  [
    '3meagmcc7w22x',
    {
      topics: ['Fantastic Numbers and Where to Find Them'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 135: An Immense World
  [
    '3mebtlr3jrc2o',
    { topics: ['An Immense World'], onTopic: true, confidence: 'high' },
  ],

  // Post 136: Nations Apart + A Land As God Made It
  [
    '3meahv4iqnk24',
    {
      topics: ['Nations Apart', 'A Land As God Made It'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 137: Family of Spies
  [
    '3meafsv6e6c27',
    { topics: ['Family of Spies'], onTopic: true, confidence: 'high' },
  ],

  // Post 138: The Expanse / Caliban's War (with image)
  [
    '3meagdhwhf224',
    {
      topics: ['The Expanse', "Caliban's War"],
      onTopic: true,
      confidence: 'high',
      note: 'Expanse series with Caliban\'s War image',
    },
  ],

  // Post 139: Nemesis Games
  [
    '3meah6jahhk2k',
    { topics: ['Nemesis Games'], onTopic: true, confidence: 'high' },
  ],

  // Post 140: Expanse discussion -> "Whose chapters have you been enjoying most?"
  [
    '3mealqv2ts22y',
    {
      topics: ['The Expanse'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues Expanse discussion',
    },
  ],

  // Post 141: "Frankly, all of them. It's just such a glorious space opera."
  [
    '3meamx3kpq22g',
    {
      topics: ['The Expanse'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues Expanse discussion',
    },
  ],

  // Post 142: "the back half of the series is just *chef's kiss*"
  [
    '3meanla3c2k2m',
    {
      topics: ['The Expanse'],
      onTopic: true,
      confidence: 'medium',
      note: 'Continues Expanse discussion',
    },
  ],

  // Post 143: "Have done them all twice as audiobooks"
  [
    '3meagyj56l22x',
    {
      topics: ['The Expanse'],
      onTopic: true,
      confidence: 'medium',
      note: 'Discusses Expanse audiobooks',
    },
  ],

  // Post 144: Crook Manifesto
  [
    '3meagqsx3ws2j',
    { topics: ['Crook Manifesto'], onTopic: true, confidence: 'high' },
  ],

  // Post 145: Cradle series
  [
    '3meagl5svgc2t',
    { topics: ['Cradle series'], onTopic: true, confidence: 'high' },
  ],

  // Post 146: Old Path White Clouds
  [
    '3meagalua3k2i',
    { topics: ['Old Path White Clouds'], onTopic: true, confidence: 'high' },
  ],

  // Post 147: "The audiobook is phenomenal" -> inherit Old Path White Clouds
  [
    '3meagbavb722i',
    {
      topics: ['Old Path White Clouds'],
      onTopic: true,
      confidence: 'medium',
      note: 'Reaction inheriting from parent',
    },
  ],

  // Post 148: Gold Diggers
  [
    '3meafr34tqk2h',
    { topics: ['Gold Diggers'], onTopic: true, confidence: 'high' },
  ],

  // Post 149: The Happiness Advantage + The Culture Map
  [
    '3meaflu7juk2s',
    {
      topics: ['The Happiness Advantage', 'The Culture Map'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 150: Humans + Vigil + The Splendid and the Vile
  [
    '3meaiay5s6k2e',
    {
      topics: ['Humans', 'Vigil', 'The Splendid and the Vile'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 151: Being Here is Everything
  [
    '3meafnwy4xk2u',
    {
      topics: ['Being Here is Everything'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 152: Sherlock Holmes + The Princess Bride
  [
    '3meapsecli22l',
    {
      topics: ['Sherlock Holmes', 'The Princess Bride'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 153: "A book on light" with link
  [
    '3meaptauqfs2e',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic with external link',
    },
  ],

  // Post 154: Babel + The Golden Road + Punk Rock Jesus + Metaphors We Live By
  [
    '3meagxarljc2x',
    {
      topics: [
        'Babel',
        'The Golden Road',
        'Punk Rock Jesus',
        'Metaphors We Live By',
      ],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 155: The Passenger
  [
    '3meag4jessk2m',
    { topics: ['The Passenger'], onTopic: true, confidence: 'high' },
  ],

  // Post 156: image with 4 books
  [
    '3meafrf3yn22w',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic image with 4 books, titles in image only',
    },
  ],

  // Post 157: "I was hoping you'd chime in! Let's grab lunch..." -> off-topic/social
  [
    '3meaia5l7gk2s',
    {
      topics: [],
      onTopic: false,
      confidence: 'low',
      note: 'Off-topic social arrangement',
    },
  ],

  // Post 158: "That would be great!" -> off-topic
  [
    '3mebenqd4ys2z',
    {
      topics: [],
      onTopic: false,
      confidence: 'low',
      note: 'Off-topic social reply',
    },
  ],

  // Post 159: The Spy Who Came in from the Cold + True Grit
  [
    '3meaqkmoyxk2l',
    {
      topics: ['The Spy Who Came in from the Cold', 'True Grit'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 160: Village of Secrets (from alt text)
  [
    '3meaflukgis2f',
    {
      topics: ['Village of Secrets'],
      onTopic: true,
      confidence: 'high',
      note: 'Title from image alt text',
    },
  ],

  // Post 161: a.co/d/ link only
  [
    '3meafmhlkos2d',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic Amazon link only',
    },
  ],

  // Post 162: Wind and Truth + There Is No Antimemetics Division (from image alt text)
  [
    '3meak6dqvss2x',
    {
      topics: ['Wind and Truth', 'There Is No Antimemetics Division'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 163: On the Calculation of Volume
  [
    '3meal5x5ayk2h',
    {
      topics: ['On the Calculation of Volume'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 164: 1929
  [
    '3meafszcjo226',
    { topics: ['1929'], onTopic: true, confidence: 'high' },
  ],

  // Post 165: Political Fictions (+ biography of Zwingli)
  [
    '3meafv2d7p223',
    { topics: ['Political Fictions'], onTopic: true, confidence: 'high' },
  ],

  // Post 166: The Wayward Bus + God's Grace
  [
    '3meagdsqhnk23',
    {
      topics: ['The Wayward Bus', "God's Grace"],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 167: Dirty Snow
  [
    '3meafpxgc7s22',
    { topics: ['Dirty Snow'], onTopic: true, confidence: 'high' },
  ],

  // Post 168: Between Two Fires
  [
    '3meafsveihk2a',
    { topics: ['Between Two Fires'], onTopic: true, confidence: 'high' },
  ],

  // Post 169: The Portrait of a Lady
  [
    '3meagbg62ks24',
    {
      topics: ['The Portrait of a Lady'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 170: Stalin's Architect (from alt text)
  [
    '3meag7ltruc24',
    {
      topics: ["Stalin's Architect"],
      onTopic: true,
      confidence: 'high',
      note: 'Title from image alt text',
    },
  ],

  // Post 171: "So good, so sad, so relevant" -> on-topic reaction
  [
    '3meagnmljlc2p',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic reaction but no specific title',
    },
  ],

  // Post 172: The Lord of the Rings + The Globe + Rose Madder
  [
    '3meafmnunb22k',
    {
      topics: ['The Lord of the Rings', 'The Globe', 'Rose Madder'],
      onTopic: true,
      confidence: 'high',
    },
  ],

  // Post 173: Rose Madder discussion
  [
    '3meaicq7sf22s',
    { topics: ['Rose Madder'], onTopic: true, confidence: 'high' },
  ],

  // Post 174: "I'm filling in the gaps" -> on-topic
  [
    '3meal2cfsss2h',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic continuation',
    },
  ],

  // Post 175: "Fascinating!" -> on-topic reaction
  [
    '3meagvxtnkc2j',
    {
      topics: [],
      onTopic: true,
      confidence: 'low',
      note: 'On-topic reaction',
    },
  ],

  // Post 176: Hamnet
  [
    '3meaho2yye22s',
    { topics: ['Hamnet'], onTopic: true, confidence: 'high' },
  ],

  // Post 177: Swerve
  [
    '3me7yig5cnk2q',
    { topics: ['Swerve'], onTopic: true, confidence: 'high' },
  ],

  // Post 178: The Justice of Kings
  [
    '3me7yyazgls2p',
    { topics: ['The Justice of Kings'], onTopic: true, confidence: 'high' },
  ],

  // Post 179: Lincoln in the Bardo
  [
    '3me7wawihxk2o',
    { topics: ['Lincoln in the Bardo'], onTopic: true, confidence: 'high' },
  ],

  // Post 180: The Travelling Cat Chronicles + The Bell in the Lake
  [
    '3me7vyf5dr22x',
    {
      topics: ['The Travelling Cat Chronicles', 'The Bell in the Lake'],
      onTopic: true,
      confidence: 'high',
    },
  ],
]);

// ---------------------------------------------------------------------------
// 4. Main labeling pipeline
// ---------------------------------------------------------------------------

function main() {
  console.log('Reading fixture...');
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const posts = data.posts;
  console.log(`Loaded ${posts.length} posts.`);

  const postByUri = new Map();
  for (const post of posts) {
    postByUri.set(post.uri, post);
  }

  const rootUri = posts[0].uri;

  /** @type {Map<string, {topics: string[], onTopic: boolean, confidence: string, note?: string, _source: string}>} */
  const labels = new Map();

  // -----------------------------------------------------------------------
  // Pass 1: Apply manual overrides (primary source of truth)
  // -----------------------------------------------------------------------
  console.log('\nPass 1: Applying manual overrides...');

  let overrideCount = 0;
  for (const post of posts) {
    const suffix = post.uri.split('/').pop();
    const override = MANUAL_OVERRIDES.get(suffix);
    if (override) {
      labels.set(post.uri, { ...override, _source: 'manual' });
      overrideCount++;
    }
  }
  console.log(`  Applied ${overrideCount} manual labels.`);

  // -----------------------------------------------------------------------
  // Pass 2: Dictionary-based title detection for any posts without overrides
  // -----------------------------------------------------------------------
  console.log('\nPass 2: Dictionary-based title detection...');

  let dictCount = 0;
  for (const post of posts) {
    if (labels.has(post.uri)) continue;

    const ownText = getOwnText(post);
    const titles = findTitles(ownText);

    // Also check alt text
    const altText =
      post.fullText && post.text ? post.fullText.substring(post.text.length) : '';
    if (altText.trim().length > 0) {
      const altTitles = findTitles(altText);
      for (const t of altTitles) {
        if (!titles.includes(t)) titles.push(t);
      }
    }

    if (titles.length > 0) {
      labels.set(post.uri, {
        topics: titles,
        onTopic: true,
        confidence: 'high',
        _source: 'dictionary',
      });
      dictCount++;
    }
  }
  console.log(`  Found titles via dictionary in ${dictCount} posts.`);

  // -----------------------------------------------------------------------
  // Pass 3: Context inheritance for remaining unlabeled posts
  // -----------------------------------------------------------------------
  console.log('\nPass 3: Context inheritance...');

  function inheritanceDepth(uri) {
    const label = labels.get(uri);
    if (!label) return Infinity;
    if (label._source === 'manual' || label._source === 'dictionary') return 0;
    const post = postByUri.get(uri);
    if (!post || !post.parentUri) return 1;
    return 1 + inheritanceDepth(post.parentUri);
  }

  let changed = true;
  let passCount = 0;
  while (changed) {
    changed = false;
    passCount++;

    for (const post of posts) {
      if (labels.has(post.uri)) continue;
      if (!post.parentUri) continue;

      const parentLabel = labels.get(post.parentUri);
      if (!parentLabel || !parentLabel.onTopic || parentLabel.topics.length === 0)
        continue;

      const parentDepth = inheritanceDepth(post.parentUri);
      if (parentDepth >= MAX_INHERITANCE_DEPTH) continue;

      const ownText = (post.text || '').trim();

      // Reaction/agreement -> inherit
      if (isReaction(ownText) || ownText.length === 0) {
        labels.set(post.uri, {
          topics: parentLabel.topics,
          onTopic: true,
          confidence: 'medium',
          note: 'Reaction/agreement inheriting from parent',
          _source: 'inherited',
        });
        changed = true;
        continue;
      }

      // Short discussion about parent's book
      if (parentDepth === 0 && ownText.length <= 200) {
        const lower = ownText.toLowerCase();
        const discussingParent =
          /book|read|reading|audiobook|listen|loved?\b|great\b|classic|favorite|best\b|awesome|amazing|finish|chapter|narrator|reread/i.test(
            lower
          ) || /\b(it|that|this one|this book|that book)\b/i.test(lower);

        if (discussingParent) {
          labels.set(post.uri, {
            topics: parentLabel.topics,
            onTopic: true,
            confidence: 'medium',
            note: 'Discusses parent book without naming it',
            _source: 'inherited',
          });
          changed = true;
        }
      }
    }
  }
  console.log(`  Completed in ${passCount} inheritance passes.`);

  // -----------------------------------------------------------------------
  // Pass 4: Label any remaining unlabeled posts
  // -----------------------------------------------------------------------
  console.log('\nPass 4: Labeling remaining posts...');

  let remainingCount = 0;
  for (const post of posts) {
    if (labels.has(post.uri)) continue;
    remainingCount++;

    const ownText = (post.text || '').trim();
    const fullText = getOwnText(post);

    if (fullText.trim().length === 0) {
      if (post.parentUri === rootUri || post.depth === 1) {
        labels.set(post.uri, {
          topics: [],
          onTopic: true,
          confidence: 'low',
          note: 'Empty direct answer, book likely in embed/image',
          _source: 'fallback',
        });
      } else {
        labels.set(post.uri, {
          topics: [],
          onTopic: false,
          confidence: 'low',
          note: 'Empty post',
          _source: 'fallback',
        });
      }
    } else if (post.depth <= 1) {
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'Direct answer but title not recognized',
        _source: 'fallback',
      });
    } else {
      labels.set(post.uri, {
        topics: [],
        onTopic: false,
        confidence: 'low',
        note: 'No title match found',
        _source: 'fallback',
      });
    }
  }

  if (remainingCount > 0) {
    console.log(`  Labeled ${remainingCount} remaining posts with fallback.`);
  } else {
    console.log('  No remaining posts needed fallback.');
  }

  // -----------------------------------------------------------------------
  // Post-processing: strip internal _source field
  // -----------------------------------------------------------------------
  console.log('\nPost-processing...');

  const sourceCounts = { manual: 0, dictionary: 0, inherited: 0, fallback: 0 };
  for (const label of labels.values()) {
    sourceCounts[label._source] = (sourceCounts[label._source] || 0) + 1;
  }

  const labelEntries = {};
  for (const [uri, label] of labels) {
    const { _source, ...rest } = label;
    labelEntries[uri] = rest;
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------
  const onTopicCount = [...labels.values()].filter((l) => l.onTopic).length;
  const allTitles = new Set();
  for (const label of labels.values()) {
    for (const t of label.topics) allTitles.add(t);
  }

  const confidenceCounts = { high: 0, medium: 0, low: 0 };
  for (const label of labels.values()) {
    confidenceCounts[label.confidence]++;
  }

  const titleCounts = {};
  for (const label of labels.values()) {
    for (const t of label.topics) {
      titleCounts[t] = (titleCounts[t] || 0) + 1;
    }
  }
  const sortedTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]);

  const output = {
    meta: {
      labeledAt: new Date().toISOString(),
      labeledBy: 'claude-opus-4-6',
      fixtureFile: 'books-reading.json',
      postCount: posts.length,
      labeledCount: labels.size,
      onTopicCount,
      offTopicCount: labels.size - onTopicCount,
      uniqueTitles: allTitles.size,
      confidence: confidenceCounts,
    },
    labels: labelEntries,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH}`);

  console.log('\n' + '='.repeat(70));
  console.log('GOLD LABELING STATISTICS');
  console.log('='.repeat(70));
  console.log(`  Total posts:       ${posts.length}`);
  console.log(`  Labeled:           ${labels.size}`);
  console.log(
    `  On-topic:          ${onTopicCount} (${pct(onTopicCount, posts.length)})`
  );
  console.log(
    `  Off-topic:         ${labels.size - onTopicCount} (${pct(labels.size - onTopicCount, posts.length)})`
  );
  console.log(`  Unique titles:     ${allTitles.size}`);
  console.log(
    `  Confidence:        high=${confidenceCounts.high}  medium=${confidenceCounts.medium}  low=${confidenceCounts.low}`
  );
  console.log(
    `  Source:            manual=${sourceCounts.manual}  dictionary=${sourceCounts.dictionary}  inherited=${sourceCounts.inherited}  fallback=${sourceCounts.fallback}`
  );

  console.log('\nTitle counts:');
  console.log('  ' + '-'.repeat(62));
  sortedTitles.forEach(([title, count], i) => {
    console.log(
      `  ${String(i + 1).padStart(3)}. ${title.padEnd(48)} ${String(count).padStart(4)}`
    );
  });

  const unlabeled = posts.filter((p) => !labels.has(p.uri));
  if (unlabeled.length > 0) {
    console.log(`\n  WARNING: ${unlabeled.length} posts were not labeled!`);
  } else {
    console.log('\n  All posts labeled.');
  }
}

function pct(n, total) {
  return `${((n / total) * 100).toFixed(1)}%`;
}

main();
