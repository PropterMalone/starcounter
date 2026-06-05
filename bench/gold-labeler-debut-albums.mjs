/**
 * Gold-standard labeler for the debut-albums benchmark fixture.
 *
 * Reads bench/fixtures/debut-albums.json, determines which album title(s) each
 * post references, and writes bench/labels/debut-albums-gold.json.
 *
 * Three-pass approach:
 *   1. Build a title-matching index (canonical titles, aliases, abbreviations).
 *   2. Scan every post for explicit title matches.
 *   3. Context pass: inherit titles from parents for reaction/agreement posts.
 *
 * Usage:  node bench/gold-labeler-debut-albums.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'debut-albums.json');
const OUTPUT_DIR = join(__dirname, 'labels');
const OUTPUT_PATH = join(OUTPUT_DIR, 'debut-albums-gold.json');

/**
 * Maximum inheritance chain depth. A reaction to an album mention (depth 1) is
 * fine. A reply to that reaction (depth 2) is borderline. Beyond that we lose
 * confidence that the conversation is still about the original album.
 */
const MAX_INHERITANCE_DEPTH = 2;

// ---------------------------------------------------------------------------
// 1. Title universe
// ---------------------------------------------------------------------------

/**
 * Canonical title -> array of match patterns (lowercase).
 * Each pattern is matched as a substring of the post text (case-insensitive).
 * Longer / more specific patterns come first within each title.
 *
 * Format: "Album Title - Artist"
 */
const TITLE_PATTERNS = buildTitlePatterns();

function buildTitlePatterns() {
  const raw = {
    'The Velvet Underground & Nico - The Velvet Underground': [
      'velvet underground & nico',
      'velvet underground and nico',
      'velvet underground',
      'vu & nico',
      'vu and nico',
      'vu&nico',
      'the velvets',
    ],
    'Five Leaves Left - Nick Drake': [
      'five leaves left',
      '5 leaves left',
    ],
    'The Piper at the Gates of Dawn - Pink Floyd': [
      'piper at the gates of dawn',
      'piper at the gates',
      'piper etc',
    ],
    'The Doors - The Doors': ['the doors'],
    'Are You Experienced - Jimi Hendrix': [
      'are you experienced',
      'jimi hendrix',
      'hendrix',
      'jimi -',
    ],
    'Led Zeppelin - Led Zeppelin': ['led zeppelin', 'led zep'],
    'Safe as Milk - Captain Beefheart': [
      'safe as milk',
      'captain beefheart',
      'cptn beefheart',
      'beefheart',
    ],
    'The Stooges - The Stooges': ['the stooges', 'stooges'],
    'In the Court of the Crimson King - King Crimson': [
      'court of the crimson king',
      'in the court of',
      'king crimson',
    ],
    'Mr Tambourine Man - The Byrds': [
      'mr. tambourine man',
      'mr tambourine man',
      'the byrds',
      'byrds',
    ],
    'Crosby, Stills & Nash - CSN': [
      'crosby, stills & nash',
      'crosby, stills and nash',
      'crosby stills & nash',
      'crosby stills and nash',
      'crosby stills nash',
      'crosby, stills',
      'crosby stills',
    ],
    'Songs of Leonard Cohen - Leonard Cohen': [
      'songs of leonard cohen',
      'leonard cohen',
      'leonard c',
    ],
    'Please Please Me - The Beatles': [
      'please please me',
    ],
    'Scott - Scott Walker': ['scott walker', 'scott w'],
    'Music from Big Pink - The Band': [
      'music from big pink',
      'big pink',
    ],
    'Little Girl Blue - Nina Simone': [
      'little girl blue',
      'nina simone',
    ],
    'The Gilded Palace of Sin - Flying Burrito Brothers': [
      'gilded palace of sin',
      'flying burrito brothers',
      'flying burrito bros',
      'flying burrito',
    ],
    'The Psychedelic Sounds of the 13th Floor Elevators - 13th Floor Elevators': [
      'psychedelic sounds of the 13th floor',
      '13th floor elevators',
      'psychedelic sounds',
    ],
    'My Generation - The Who': ['my generation'],
    'Kick Out the Jams - MC5': ['kick out the jams', 'mc5'],
    "Here's Little Richard - Little Richard": [
      "here's little richard",
      'little richard',
    ],
    'Chelsea Girl - Nico': ['chelsea girl'],
    'Silver Apples - Silver Apples': ['silver apples'],
    'A Girl Called Dusty - Dusty Springfield': [
      'a girl called dusty',
      'dusty springfield',
    ],
    'Monster Movie - Can': ['monster movie'],
    'Here Are the Sonics - The Sonics': [
      'here are the sonics',
      'the sonics',
    ],
    'Page One - Joe Henderson': ['page one', 'joe henderson'],
    'A Monastic Trio - Alice Coltrane': [
      'monastic trio',
      'alice coltrane',
    ],
    'Elvis Presley - Elvis Presley': ['elvis presley'],
    'Something Else - Ornette Coleman': [
      'ornette coleman',
    ],
    'Bo Diddley - Bo Diddley': ['bo diddley', 'diddley'],
    'Song to a Seagull - Joni Mitchell': [
      'song to a seagull',
      'joni mitchell',
    ],
    'Pain in My Heart - Otis Redding': [
      'pain in my heart',
      'otis redding',
    ],
    'Jackson C Frank - Jackson C Frank': ['jackson c frank'],
    'Buffalo Springfield - Buffalo Springfield': ['buffalo springfield'],
    'Neil Young - Neil Young': ['neil young'],
    'Bert Jansch - Bert Jansch': ['bert jansch'],
    'Open Sesame - Freddie Hubbard': [
      'open sesame',
      'freddie hubbard',
    ],
    "Takin' Off - Herbie Hancock": [
      "takin' off",
      'takin off',
      'herbie hancock',
    ],
    'Presenting the Fabulous Ronettes - The Ronettes': [
      'fabulous ronettes',
      'ronettes',
    ],
    'Truth - Jeff Beck': ['jeff beck'],
    'Fresh Cream - Cream': ['fresh cream'],
    'The Allman Brothers Band - Allman Brothers': ['allman brothers'],
    'Love - Love': ['love - love', 'love-love', 'love st', 'love s/t', 'love: s/t', 'love - s/t', 'love self-titled'],
    'Black Monk Time - The Monks': ['black monk time', 'the monks'],
    'Oar - Skip Spence': ['skip spence', 'alexander spence'],
    'The Parable of Arable Land - Red Krayola': [
      'parable of arable land',
      'red krayola',
    ],
    'Gris Gris - Dr. John': ['gris gris', 'dr. john', 'dr john'],
    'Blind Joe Death - John Fahey': ['blind joe death', 'john fahey'],
    'Dear Mr Fantasy - Traffic': ['dear mr fantasy'],
    'Vincebus Eruptum - Blue Cheer': ['vincebus eruptum', 'blue cheer'],
    'Bob Dylan - Bob Dylan': ['bob dylan'],
    'David Bowie - David Bowie': ['david bowie'],
    'Nancy & Lee - Nancy Sinatra & Lee Hazlewood': [
      'nancy & lee',
      'nancy and lee',
    ],
    'Freak Out! - Mothers of Invention': [
      'freak out',
      'mothers of invention',
    ],
    'The Meters - The Meters': ['the meters'],
    'Francoise Hardy - Francoise Hardy': [
      'fran\u00e7oise hardy',
      'francoise hardy',
      'francois hardy',
    ],
    'Taste - Taste': ['taste - taste', 'taste st', 'taste s/t'],
    'Tim Hardin 1 - Tim Hardin': ['tim hardin'],
    'Tim Buckley - Tim Buckley': ['tim buckley'],
    'Lightfoot - Gordon Lightfoot': ['gordon lightfoot'],
    'Santana - Santana': ['santana'],
    'Song of Innocence - David Axelrod': [
      'song of innocence',
      'david axelrod',
    ],
    'Joan Baez - Joan Baez': ['joan baez'],
    'At Last! - Etta James': ['etta james'],
    'Buddy Holly - Buddy Holly': ['buddy holly'],
    'The Chirping Crickets - The Crickets': [
      'chirping crickets',
      'the crickets',
    ],
    'Mixed Bag - Richie Havens': ['richie havens'],
    'Shades of Deep Purple - Deep Purple': [
      'shades of deep purple',
      'deep purple',
    ],
    'The Kinks - The Kinks': ['the kinks', 'kinks'],
    'Steppenwolf - Steppenwolf': ['steppenwolf'],
    'Chicago Transit Authority - Chicago Transit Authority': [
      'chicago transit authority',
    ],
    'Jefferson Airplane Takes Off - Jefferson Airplane': [
      'jefferson airplane',
      'takes off',
    ],
    'Procol Harum - Procol Harum': ['procol harum'],
    'Black Women - Sonny Sharrock': ['sonny sharrock', 'black women'],
    'The United States of America - The United States of America': [
      'united states of america',
    ],
    'Odetta Sings Ballads and Blues - Odetta': ['odetta'],
    'Just Colour - The Lollipop Shoppe': ['lollipop shoppe'],
    'Os Mutantes - Os Mutantes': ['os mutantes', 'mutantes'],
    'The Pentangle - The Pentangle': ['pentangle'],
    'Hoodoo Man Blues - Junior Wells': [
      'hoodoo man blues',
      'junior wells',
    ],
    'Blues from the Gutter - Champion Jack Dupree': [
      'champion jack dupree',
      'blues from the gutter',
    ],
    'Kaleidoscope - Tangerine Dream': ['tangerine dream'],
    'UFO - Jim Sullivan': ['jim sullivan', 'u.f.o.'],
    'True Blue - Tina Brooks': ['tina brooks', 'true blue'],
    'Wailing Wailers - The Wailers': ['wailing wailers', 'wailers'],
    'Foolish Seasons - Dana Gillespie': [
      'dana gillespie',
      'foolish seasons',
    ],
    'Walk Away Renee - The Left Banke': ['left banke'],
    'Moby Grape - Moby Grape': ['moby grape'],
    'Mighty Baby - Mighty Baby': ['mighty baby'],
    'The Fugs First Album - The Fugs': ['the fugs', 'fugs'],
    'Empty Sky - Elton John': ['empty sky', 'elton john'],
    'Gal Costa - Gal Costa': ['gal costa'],
    'Ottilie Patterson - Ottilie Patterson': ['ottilie patterson'],
    'Ask Me No Questions - Bridget St John': [
      'bridget st john',
      'ask me no questions',
    ],
    'Marianne Faithfull - Marianne Faithfull': ['marianne faithfull'],
    'Run the Length - Kathe Green': ['kathe green'],
    'The Soul of a Bell - William Bell': [
      'william bell',
      'soul of a bell',
    ],
    'Climbing! - Mountain': ['mountain'],
    'On Time - Grand Funk Railroad': ['grand funk'],
    'Five Live Yardbirds - The Yardbirds': ['yardbirds'],
    'Ska Boo-Da-Ba - The Skatalites': ['skatalites'],
    'Mr Rock Steady - Ken Boothe': ['ken boothe'],
    'Take It Easy - Hopeton Lewis': ['hopeton lewis'],
    'The Gaylads - The Gaylads': ['gaylads'],
    'A Drop of the Hard Stuff - The Dubliners': ['dubliners'],
    "Surfin' Safari - The Beach Boys": [
      "surfin' safari",
      'surfin safari',
      'beach boys',
    ],
    'Frost Music - The Frost': ['the frost'],
    'Tons of Sobs - Free': ['tons of sobs'],
    'Aerosol Grey Machine - Van der Graaf Generator': [
      'van der graaf',
      'vdgg',
    ],
    'Adge Cutler and the Wurzels - The Wurzels': ['wurzels'],
    'Wednesday Morning, 3 AM - Simon & Garfunkel': [
      'wednesday morning',
      'simon & garfunkel',
      'simon and garfunkel',
      'simon & garf',
    ],
    'Blind Faith - Blind Faith': ['blind faith'],
    'Yes - Yes': ['yes - yes', 'yes st', 'yes s/t'],
    'Paul Butterfield Blues Band - Paul Butterfield': ['butterfield'],
    'Getz/Gilberto - Stan Getz & Joao Gilberto': [
      'getz/gilberto',
      'getz gilberto',
    ],
    'Astrud Gilberto - Astrud Gilberto': ['astrud gilberto'],
    'Leader of the Pack - Shangri-Las': ['shangri-las', 'shangri-la'],
    'Ray Charles - Ray Charles': ['ray charles'],
    'John Coltrane - John Coltrane': ['john coltrane'],
    'Genius of Modern Music - Thelonious Monk': [
      'thelonious monk',
    ],
    'Ricky - Ricky Nelson': ['ricky nelson'],
    'The Sound of Fury - Billy Fury': ['billy fury'],
    'Stanley Turrentine - Stanley Turrentine': ['stanley turrentine'],
    'Cannonball Adderley - Cannonball Adderley': ['cannonball adderley'],
    'First Take - Roberta Flack': ['roberta flack', 'first take'],
    'Miriam Makeba - Miriam Makeba': ['miriam makeba'],
    'Walker Brothers - Walker Brothers': ['walker brothers'],
    'The Grateful Dead - Grateful Dead': ['grateful dead'],
    'Clifford Brown & Max Roach - Clifford Brown': ['clifford brown'],
    'Electric Music for the Mind and Body - Country Joe & the Fish': [
      'country joe',
    ],
    'Gorilla - Bonzo Dog Doo-Dah Band': ['bonzo dog'],
    'Who Do You Love - The Sapphires': ['sapphires'],
    'Give It Away - Chi-Lites': ['chi-lites'],
    'Greetings from the Pioneers - The Pioneers': ['the pioneers', 'pioneers'],
    'Greatest of the Delta Blues Singers - Skip James': ['skip james'],
    'Soft Machine - Soft Machine': ['soft machine'],
    'Joy of a Toy - Kevin Ayers': ['kevin ayers'],
    'Bud Powell - Bud Powell': ['bud powell'],
    'Grant Green - Grant Green': ['grant green'],
    'Cecil Taylor - Cecil Taylor': ['cecil taylor'],
    'Fairport Convention - Fairport Convention': [
      'fairport convention',
      'fairport',
    ],
    'This Was - Jethro Tull': ['jethro tull'],
    'Beat of the Earth - Beat of the Earth': ['beat of the earth'],
    'Korla Pandit - Korla Pandit': ['korla pandit'],
    'Ars Nova - Ars Nova': ['ars nova'],
    'Black Pearl - Black Pearl': ['black pearl'],
    'The First Lady of Immediate - P.P. Arnold': ['p.p. arnold'],
    'A Gift from Euphoria - Euphoria': ['euphoria'],
    'Visualize - Thomas & Richard Frost': [
      'thomas & richard frost',
      'thomas and richard frost',
    ],
    'Gene Clark with the Gosdin Brothers - Gene Clark': ['gene clark'],
    'Begin Here - The Zombies': ['zombies'],
    'The Searchers - The Searchers': ['searchers'],
    'Poco - Poco': ['poco'],
    'Roy Harper - Roy Harper': ['roy harper'],
    'Lee Hazlewood - Lee Hazlewood': ['lee hazlewood', 'hazlewood'],
    'Phil Ochs - Phil Ochs': ['phil ochs'],
    'Paul Simon - Paul Simon': ['paul simon'],
    'Van Dyke Parks - Van Dyke Parks': ['van dyke parks'],
    'Mamadou Seck & Boubacar Diabate - Various': ['mamadou seck'],
    'You Got My Mind Messed Up - James Carr': ['james carr'],
    'Jacques Brel - Jacques Brel': ['jacques brel'],
    'Townes Van Zandt - Townes Van Zandt': ['townes van zandt'],
    'Guitar Player - Davy Graham': ['davy graham'],
    'After School Session - Chuck Berry': ['chuck berry'],
    'Arthur Alexander - Arthur Alexander': ['arthur alexander'],
    "Sing 'A Lovers Concerto' - The Toys": ['the toys'],
    'Wipe Out - Surfaris': ['surfaris'],
    'Johnny Burnette - Johnny Burnette': ['johnny burnette'],
    'Louvin Brothers - Louvin Brothers': ['louvin brothers'],
    'Prince Buster - Prince Buster': ['prince buster'],
    'Psychedelic Underground - Amon Duul': [
      'amon d\u00fc\u00fcl',
      'amon duul',
    ],
    'Dick Dale - Dick Dale': ['dick dale'],
    // Additional albums that may appear in the thread
    'The Incredible String Band - The Incredible String Band': [
      'incredible string band',
    ],
    'Dillard & Clark - Dillard & Clark': ['dillard & clark', 'dillard and clark'],
    'Small Faces - Small Faces': ['small faces'],
    'The Seeds - The Seeds': ['the seeds'],
    'John Lee Hooker - John Lee Hooker': ['john lee hooker'],
    'An Old Raincoat Won\'t Ever Let You Down - Rod Stewart': [
      'old raincoat',
      'rod stewart',
    ],
    'Johnny Cash With His Hot and Blue Guitar - Johnny Cash': [
      'johnny cash',
      'hot and blue guitar',
    ],
  };

  const map = new Map();
  for (const [canonical, patterns] of Object.entries(raw)) {
    // Skip empty pattern arrays (handled via ambiguous or other means)
    if (patterns.length === 0) continue;
    const deduped = [...new Set(patterns.map((p) => p.toLowerCase()))].sort(
      (a, b) => b.length - a.length
    );
    map.set(canonical, deduped);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 2. Ambiguous-word guard
// ---------------------------------------------------------------------------

/**
 * Titles that are common English words or very short. We require extra context
 * to count these as album mentions: title-case, quotes, or music-context words.
 */
const AMBIGUOUS_TITLES = new Set([
  'Love - Love',
  'Taste - Taste',
  'Truth - Jeff Beck',
  'Yes - Yes',
  'Oar - Skip Spence',
  'Climbing! - Mountain',
  'The Monks',
  'Fresh Cream - Cream',
  'Poco - Poco',
  'Santana - Santana',
  'First Take - Roberta Flack',
  'Black Pearl - Black Pearl',
  'The Searchers - The Searchers',
]);

/**
 * Words that indicate we are in a music/album context.
 */
const MUSIC_CONTEXT_WORDS = [
  'album', 'debut', 'band', 'vinyl', 'record', 'vote', 'pts', 'points',
  '#5debutalbums', 'music', 'listen', 'song', 'track', 'genre', 'jazz',
  'rock', 'blues', 'folk', 'punk', 'psychedelic', 'prog', 'soul',
  'reggae', 'ska', 'guitar', 'drum', 'bass', 'singer', 'vocal',
  'bubblers', 'honourable', 'honorable', 'mention',
];

/**
 * Check if an ambiguous title is used in a music-reference context.
 */
function isMusicContext(title, fullText) {
  const lower = fullText.toLowerCase();

  // 1. Appears in a numbered list (strong signal in this thread)
  if (/^\s*\d[.)]\s/m.test(fullText)) return true;

  // 2. Has the thread hashtag
  if (lower.includes('#5debutalbums') || lower.includes('5debutalbums')) return true;

  // 3. Appears near music-related context words
  for (const cw of MUSIC_CONTEXT_WORDS) {
    if (lower.includes(cw)) return true;
  }

  // 4. Appears in title-case in the original text
  const titleWords = title.split(' - ')[0]; // Album title part
  const titleCaseRegex = new RegExp(`\\b${escapeRegex(titleWords)}\\b`);
  if (titleCaseRegex.test(fullText)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchableText(post) {
  const parts = [];
  if (post.fullText) parts.push(post.fullText);
  else if (post.text) parts.push(post.text);
  if (post.quotedText) parts.push(post.quotedText);
  if (post.quotedAltText && Array.isArray(post.quotedAltText)) {
    parts.push(post.quotedAltText.join(' '));
  }
  return parts.join('\n');
}

function getOwnText(post) {
  if (post.fullText) return post.fullText;
  if (post.text) return post.text;
  return '';
}

// ---------------------------------------------------------------------------
// 4. Title matching
// ---------------------------------------------------------------------------

/**
 * Abbreviation map for artist-only references commonly found in "bubblers"
 * sections and shorthand mentions.
 */
const ARTIST_SHORTHAND = new Map([
  ['nick d', 'Five Leaves Left - Nick Drake'],
  ['velvets', 'The Velvet Underground & Nico - The Velvet Underground'],
  ['ornette', 'Something Else - Ornette Coleman'],
  ['crimson', 'In the Court of the Crimson King - King Crimson'],
  ['flack', 'First Take - Roberta Flack'],
  ['jb', 'Jacques Brel - Jacques Brel'],
  ['makeba', 'Miriam Makeba - Miriam Makeba'],
  ['gilberto', 'Getz/Gilberto - Stan Getz & Joao Gilberto'],
  ['costa', 'Gal Costa - Gal Costa'],
  ['brooks', 'True Blue - Tina Brooks'],
  ['laroca', 'Page One - Joe Henderson'],
  ['lasha', 'Something Else - Ornette Coleman'],
  ['drake', 'Five Leaves Left - Nick Drake'],
  ['hancock', "Takin' Off - Herbie Hancock"],
  ['coltrane', 'John Coltrane - John Coltrane'],
  ['monk', 'Genius of Modern Music - Thelonious Monk'],
  ['elvis', 'Elvis Presley - Elvis Presley'],
  ['dusty', 'A Girl Called Dusty - Dusty Springfield'],
  ['scott 1', 'Scott - Scott Walker'],
  ['miriam', 'Miriam Makeba - Miriam Makeba'],
  ['the band', 'Music from Big Pink - The Band'],
  ['the who', 'My Generation - The Who'],
  ['the beatles', 'Please Please Me - The Beatles'],
  ['beatles', 'Please Please Me - The Beatles'],
  ['nico', 'Chelsea Girl - Nico'],
  ['can', 'Monster Movie - Can'],
  ['sonics', 'Here Are the Sonics - The Sonics'],
  ['piper', 'The Piper at the Gates of Dawn - Pink Floyd'],
  ['pink floyd', 'The Piper at the Gates of Dawn - Pink Floyd'],
  ['doors', 'The Doors - The Doors'],
  ['cream', 'Fresh Cream - Cream'],
  ['free', 'Tons of Sobs - Free'],
  ['lightfoot', 'Lightfoot - Gordon Lightfoot'],
]);

/**
 * Find all album titles mentioned in a text string.
 * @param {string} text
 * @param {boolean} isVotePost - If true, we are more aggressive with matching.
 * @returns {string[]} Array of canonical title strings.
 */
function findTitles(text, isVotePost = false) {
  if (!text || text.trim().length === 0) return [];

  const lower = text.toLowerCase();
  const found = new Set();

  // 4a. Artist shorthand references (bubblers sections, etc.)
  for (const [shorthand, canonical] of ARTIST_SHORTHAND) {
    if (shorthand.length <= 4) {
      const regex = new RegExp(`\\b${escapeRegex(shorthand)}\\b`, 'i');
      if (regex.test(lower)) {
        if (isVotePost || isMusicContext(canonical, text)) {
          found.add(canonical);
        }
      }
    } else {
      if (lower.includes(shorthand)) {
        found.add(canonical);
      }
    }
  }

  // 4b. Primary title patterns.
  for (const [canonical, patterns] of TITLE_PATTERNS) {
    if (found.has(canonical)) continue;

    for (const pattern of patterns) {
      let matched = false;
      if (pattern.length <= 5) {
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i');
        matched = regex.test(lower);
      } else {
        matched = lower.includes(pattern);
      }

      if (matched) {
        if (AMBIGUOUS_TITLES.has(canonical)) {
          if (isVotePost || isMusicContext(canonical, text)) {
            found.add(canonical);
          }
        } else {
          found.add(canonical);
        }
        break;
      }
    }
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// 5. Reaction / agreement detection
// ---------------------------------------------------------------------------

const REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|ya|yea|yass|yasss)[\s!.\u2026]*$/i,
  /^(this|this one|this is it|this is the one|this is the way)[\s!.\u2026]*$/i,
  /^(same|same here|me too|mine too|same same)[\s!.\u2026]*$/i,
  /^(great choice|good choice|excellent choice|good pick|great pick|nice pick|solid choice|solid pick)[\s!.\u2026]*$/i,
  /^(absolutely|exactly|correct|100%|1000%|10000%)[\s!.\u2026]*$/i,
  /^(based|so based|incredibly based)[\s!.\u2026]*$/i,
  /^(oh hell yes|oh yes|oh yeah|hell yes|hell yeah)[\s!.\u2026]*$/i,
  /^(w|dub|huge W|massive W)[\s!.\u2026]*$/i,
  /^(goated|peak|elite|banger|certified|classic)[\s!.\u2026]*$/i,
  /^(respect|valid|taste|you have taste|good taste|excellent taste|impeccable taste)[\s!.\u2026]*$/i,
  /^(underrated|so underrated|criminally underrated)[\s!.\u2026]*$/i,
  /^(mine too|mine as well|me too|ditto|seconded|second this)[\s!.]*$/i,
  /^(so good|so so good|it's so good|such a good)[\s!.]*$/i,
  /^(right\??|right!|correct!|true|facts|fr|fax)[\s!.]*$/i,
  /^(the best|one of the best|best album|best record)[\s!.]*$/i,
  /^(love (this|that|it)|loved (this|that|it))[\s!.]*$/i,
  /^(banger|what an album|what a record|peak music)[\s!.]*$/i,
  /^(great list|great choices|nice list|lovely list|good list|excellent list|cracking list|superb list|brilliant list)[\s!.]*$/i,
  /^(great shout|nice one|fair play|top list)[\s!.]*$/i,
  /^that's an excellent list[\s!.]*$/i,
  /^(nice|lovely|brilliant|superb|fantastic|wonderful|awesome|amazing|great|cool|ace|mint|class)[\s!.\u2026\ud83d]*$/i,
  /^(TY|thanks|thank you|cheers|ta)[\s!.,\ud83d\ude4f]*$/i,
  // Pure emoji / punctuation
  /^[\s!?\u2764\u{1F44D}\u{1F44F}\u{1F525}\u{1F60D}\u{1F64F}\u{1F389}\u{1F3B5}\u{1F3B6}\u{1F3B8}\u{1F3B9}\u{2B50}\u{1F4AF}\u{1F91D}\u{1F44C}\u{1F64C}\u{2705}\u{1F3C6}\u{1F602}\u{1F923}\u{1F62D}\u{1F60E}\u{1F929}\u{1F4AA}\u{270A}\u{1F64B}\u{200D}\u{2640}\u{FE0F}\u{200D}\u{2642}\u{FE0F}\u{1F91C}\u{1F91B}\u{1F91E}\u{1F633}\u{1F641}\u{1F914}\u{1F60A}\u{1F197}]+$/u,
  // Very short (<=3 chars)
  /^.{0,3}$/,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;

  for (const pattern of REACTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Very short non-title-case text is likely a reaction
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 6. Vote post detection
// ---------------------------------------------------------------------------

/**
 * Detect if a post is a vote (contains a numbered list of albums).
 * Vote posts are at depth 0 (QT) or depth 1 (direct replies to root).
 */
function isVotePost(post, rootUri) {
  // Direct replies to root
  if (post.parentUri === rootUri && post.depth === 1) return true;

  // Quote posts of the root
  if (post.source === 'quote' && post.depth === 0) return true;

  // Quote-reply that is voting
  if (post.source === 'quote-reply' && post.depth <= 1) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 7. Title refinement
// ---------------------------------------------------------------------------

function refineTitles(titles) {
  const result = [...new Set(titles)];

  // "Nick Drake" bare reference should map to Five Leaves Left (his debut)
  const nickDrakeIdx = result.indexOf('Nick Drake');
  if (nickDrakeIdx !== -1) {
    if (!result.includes('Five Leaves Left - Nick Drake')) {
      result[nickDrakeIdx] = 'Five Leaves Left - Nick Drake';
    } else {
      result.splice(nickDrakeIdx, 1);
    }
  }

  // "Coltrane - John Coltrane (debut)" merged into main
  const coltraneDebut = result.indexOf('Coltrane - John Coltrane (debut)');
  if (coltraneDebut !== -1) {
    if (!result.includes('John Coltrane - John Coltrane')) {
      result[coltraneDebut] = 'John Coltrane - John Coltrane';
    } else {
      result.splice(coltraneDebut, 1);
    }
  }

  // If "Nico" (Chelsea Girl) appears alongside VU&Nico, remove Chelsea Girl
  // since "nico" in VU context means the VU album, not Chelsea Girl
  if (
    result.includes('The Velvet Underground & Nico - The Velvet Underground') &&
    result.includes('Chelsea Girl - Nico')
  ) {
    const idx = result.indexOf('Chelsea Girl - Nico');
    result.splice(idx, 1);
  }

  // If "Something Else" text matched Ornette but the person wrote "Something Else"
  // as a casual phrase, we keep it only if there's jazz context. Already handled
  // by patterns requiring "ornette coleman" explicitly.

  return result;
}

// ---------------------------------------------------------------------------
// 8. Parse vote lines
// ---------------------------------------------------------------------------

/**
 * Parse individual lines from a vote post to extract album mentions per-line.
 * Handles patterns like:
 *   "1. Artist - Album (5pts)"
 *   "1) Album - Artist"
 *   "5pts. Artist - Album"
 */
function parseVoteLines(text) {
  const titles = new Set();
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check each line against the full title dictionary
    const lineTitles = findTitles(trimmed, true);
    for (const t of lineTitles) {
      titles.add(t);
    }
  }

  return [...titles];
}

// ---------------------------------------------------------------------------
// 9. Main labeling pipeline
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
  // Pass 1: Explicit title detection
  // -----------------------------------------------------------------------
  console.log('\nPass 1: Explicit title detection...');

  for (const post of posts) {
    const ownText = getOwnText(post);

    // Root prompt post.
    if (post.uri === rootUri) {
      labels.set(post.uri, {
        topics: [],
        onTopic: false,
        confidence: 'high',
        note: 'Root prompt post',
        _source: 'explicit',
      });
      continue;
    }

    const isVote = isVotePost(post, rootUri);

    // Find titles in the post's own text.
    let ownTitles = isVote
      ? parseVoteLines(ownText)
      : findTitles(ownText, false);

    // Also run full-text matching for completeness (catches bubblers, etc.)
    if (isVote) {
      const fullTextTitles = findTitles(ownText, true);
      for (const t of fullTextTitles) {
        if (!ownTitles.includes(t)) ownTitles.push(t);
      }
    }

    ownTitles = refineTitles(ownTitles);

    // Quoted text / quoted alt text.
    let quotedTitles = [];
    if (post.quotedText || (post.quotedAltText && post.quotedAltText.length > 0)) {
      const quotedSearchText = [
        post.quotedText || '',
        ...(post.quotedAltText || []),
      ].join('\n');
      quotedTitles = refineTitles(findTitles(quotedSearchText, true));
    }

    if (ownTitles.length > 0) {
      labels.set(post.uri, {
        topics: ownTitles,
        onTopic: true,
        confidence: isVote ? 'high' : 'high',
        note: isVote ? 'Vote post with album list' : undefined,
        _source: 'explicit',
      });
    } else if (quotedTitles.length > 0 && !isVote) {
      // Post quotes another post that mentions albums.
      const ownTrimmed = (post.text || '').trim();
      if (ownTrimmed.length === 0 || isReaction(ownTrimmed)) {
        labels.set(post.uri, {
          topics: quotedTitles,
          onTopic: true,
          confidence: 'medium',
          note: 'Inherits from quoted post',
          _source: 'quoted',
        });
      } else {
        const lower = ownTrimmed.toLowerCase();
        const albumRelated =
          /album|record|music|listen|love[ds]?\b|great\b|classic|best\b|awesome|amazing|perfect|peak|underrated|debut|vinyl|vote/i.test(lower);
        if (albumRelated) {
          labels.set(post.uri, {
            topics: quotedTitles,
            onTopic: true,
            confidence: 'medium',
            note: 'Discusses quoted album(s)',
            _source: 'quoted',
          });
        } else {
          labels.set(post.uri, {
            topics: quotedTitles,
            onTopic: true,
            confidence: 'low',
            note: 'Quotes an album post but own text unclear',
            _source: 'quoted',
          });
        }
      }
    }
  }

  const pass1Count = [...labels.values()].filter((l) => l.onTopic).length;
  console.log(`  Found explicit/quoted titles in ${pass1Count} posts.`);

  // -----------------------------------------------------------------------
  // Pass 2: Context inheritance from parents
  // -----------------------------------------------------------------------
  console.log('\nPass 2: Context inheritance...');

  function inheritanceDepth(uri) {
    const label = labels.get(uri);
    if (!label) return Infinity;
    if (label._source === 'explicit' || label._source === 'quoted') return 0;
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
      const fullOwnText = getOwnText(post);

      // Does this post introduce its own title?
      const ownTitles = findTitles(fullOwnText, true);
      if (ownTitles.length > 0) {
        labels.set(post.uri, {
          topics: refineTitles(ownTitles),
          onTopic: true,
          confidence: 'high',
          note: 'Found titles on inheritance pass',
          _source: 'explicit',
        });
        changed = true;
        continue;
      }

      // Reaction/agreement -> inherit.
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

      // Short-ish post discussing the parent's albums without naming them.
      if (parentDepth === 0 && ownText.length <= 250) {
        const lower = ownText.toLowerCase();
        const discussingParent =
          /album|record|music|listen|love[ds]?\b|great\b|classic|best\b|awesome|amazing|perfect|peak|underrated|vinyl|debut|vote|list|choice|pick|shout|spot|jazz|rock|folk|blues|band|song|track/i.test(lower) ||
          /\b(it|that|this one|that one|that album|this album|that record|this record)\b/i.test(lower);

        if (discussingParent) {
          labels.set(post.uri, {
            topics: parentLabel.topics,
            onTopic: true,
            confidence: 'low',
            note: 'Discusses parent album(s) without naming them',
            _source: 'inherited',
          });
          changed = true;
        }
      }
    }
  }
  console.log(`  Completed in ${passCount} inheritance passes.`);

  // -----------------------------------------------------------------------
  // Pass 3: Label remaining unlabeled posts
  // -----------------------------------------------------------------------
  console.log('\nPass 3: Labeling remaining posts...');

  for (const post of posts) {
    if (labels.has(post.uri)) continue;

    const ownText = (post.text || '').trim();
    const fullText = getSearchableText(post);

    // Image-only with no text, no alt text.
    if (
      ownText.length === 0 &&
      (!post.fullText || post.fullText.trim().length === 0)
    ) {
      if (post.quotedText || (post.quotedAltText && post.quotedAltText.length > 0)) {
        const quotedSearchText = [
          post.quotedText || '',
          ...(post.quotedAltText || []),
        ].join('\n');
        const quotedTitles = findTitles(quotedSearchText, true);
        if (quotedTitles.length > 0) {
          labels.set(post.uri, {
            topics: refineTitles(quotedTitles),
            onTopic: true,
            confidence: 'medium',
            note: 'Empty post quoting an album mention',
            _source: 'quoted',
          });
          continue;
        }
      }

      labels.set(post.uri, {
        topics: [],
        onTopic: false,
        confidence: 'low',
        note: 'No text, no alt text, no quoted text with titles',
        _source: 'explicit',
      });
      continue;
    }

    // Try one more time with aggressive matching on full text.
    const lastChanceTitles = findTitles(fullText, true);
    if (lastChanceTitles.length > 0) {
      labels.set(post.uri, {
        topics: refineTitles(lastChanceTitles),
        onTopic: true,
        confidence: 'medium',
        note: 'Found on final pass with aggressive matching',
        _source: 'explicit',
      });
      continue;
    }

    // Truly unmatched. Determine if on-topic or off-topic.
    const lower = ownText.toLowerCase();

    // Posts discussing the poll, music in general, or voting process
    const seemsOnTopic =
      post.parentUri === rootUri ||
      (post.source === 'quote' &&
        (post.quotedText || '').toLowerCase().includes('#5debutalbums')) ||
      /album|debut|music|vinyl|record|listen|vote|poll|#5debut/i.test(lower) ||
      /\b(tough|hard|difficult|impossible)\b.{0,20}\b(choice|pick|task|decision|list)\b/i.test(lower) ||
      /what a (tough|hard|difficult|great)/i.test(lower) ||
      /my (list|vote|pick|choice)/i.test(lower);

    if (seemsOnTopic) {
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'On-topic discussion but no specific album identified',
        _source: 'explicit',
      });
    } else {
      // Check if this is a social reply in the thread context
      const parentPost = postByUri.get(post.parentUri);
      const isDeepReply = post.depth >= 2;
      const isShortSocial = ownText.length <= 100;

      if (isDeepReply && isShortSocial) {
        // Deep short replies are usually social/conversational within the thread
        labels.set(post.uri, {
          topics: [],
          onTopic: true,
          confidence: 'low',
          note: 'Short social reply within thread context',
          _source: 'explicit',
        });
      } else {
        labels.set(post.uri, {
          topics: [],
          onTopic: false,
          confidence: 'low',
          note: 'No album match found',
          _source: 'explicit',
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Post-processing cleanup
  // -----------------------------------------------------------------------
  console.log('\nPost-processing...');

  // Strip internal _source field before output.
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

  const sourceCounts = { explicit: 0, quoted: 0, inherited: 0 };
  for (const label of labels.values()) {
    sourceCounts[label._source] = (sourceCounts[label._source] || 0) + 1;
  }

  const output = {
    meta: {
      labeledAt: new Date().toISOString(),
      labeledBy: 'claude-opus-4-6',
      fixtureFile: 'debut-albums.json',
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
  console.log(`  On-topic:          ${onTopicCount} (${pct(onTopicCount, posts.length)})`);
  console.log(`  Off-topic:         ${labels.size - onTopicCount} (${pct(labels.size - onTopicCount, posts.length)})`);
  console.log(`  Unique titles:     ${allTitles.size}`);
  console.log(`  Confidence:        high=${confidenceCounts.high}  medium=${confidenceCounts.medium}  low=${confidenceCounts.low}`);
  console.log(`  Source:            explicit=${sourceCounts.explicit}  quoted=${sourceCounts.quoted}  inherited=${sourceCounts.inherited}`);

  console.log('\nTop 30 albums by mention count:');
  console.log('  ' + '-'.repeat(72));
  sortedTitles.slice(0, 30).forEach(([title, count], i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${title.padEnd(62)} ${String(count).padStart(4)}`);
  });

  if (sortedTitles.length > 30) {
    console.log(`\n  ... and ${sortedTitles.length - 30} more titles.`);
  }

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
