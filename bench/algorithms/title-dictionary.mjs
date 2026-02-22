/**
 * Title Dictionary algorithm:
 * Uses a known list of movie titles and fuzzy-matches against post text.
 * This is basically "search for known titles in text" rather than
 * "extract unknown titles from text patterns."
 *
 * Advantages: catches lowercase mentions, abbreviations, partial titles
 * Disadvantages: can't find titles not in the dictionary
 */

// Comprehensive dad movie title dictionary with aliases
const TITLE_DICTIONARY = [
  { canonical: 'Master and Commander: The Far Side of the World', aliases: ['master and commander', 'm&c', 'master & commander', 'master and commander the far side of the world'] },
  { canonical: 'The Hunt for Red October', aliases: ['hunt for red october', 'red october', 'hfro'] },
  { canonical: 'Die Hard', aliases: ['die hard', 'diehard'] },
  { canonical: 'The Fugitive', aliases: ['the fugitive', 'fugitive'] },
  { canonical: 'Ronin', aliases: ['ronin'] },
  { canonical: 'Indiana Jones and the Last Crusade', aliases: ['indiana jones', 'last crusade', 'indy'] },
  { canonical: 'The Shawshank Redemption', aliases: ['shawshank', 'shawshank redemption'] },
  { canonical: 'Field of Dreams', aliases: ['field of dreams'] },
  { canonical: 'Gladiator', aliases: ['gladiator'] },
  { canonical: 'Heat', aliases: ['heat'] },
  { canonical: 'The Great Escape', aliases: ['great escape', 'the great escape'] },
  { canonical: 'Top Gun', aliases: ['top gun'] },
  { canonical: 'Top Gun: Maverick', aliases: ['top gun maverick', 'top gun: maverick'] },
  { canonical: 'Apollo 13', aliases: ['apollo 13'] },
  { canonical: 'Tombstone', aliases: ['tombstone'] },
  { canonical: 'Sneakers', aliases: ['sneakers'] },
  { canonical: 'A Few Good Men', aliases: ['a few good men', 'few good men'] },
  { canonical: 'Casablanca', aliases: ['casablanca'] },
  { canonical: 'The Good, the Bad and the Ugly', aliases: ['good bad and ugly', 'good the bad and the ugly', 'good bad ugly'] },
  { canonical: 'Gettysburg', aliases: ['gettysburg'] },
  { canonical: 'The Princess Bride', aliases: ['princess bride', 'the princess bride'] },
  { canonical: 'Lawrence of Arabia', aliases: ['lawrence of arabia'] },
  { canonical: 'Star Trek II: The Wrath of Khan', aliases: ['wrath of khan', 'star trek 2', 'star trek ii'] },
  { canonical: 'Goodfellas', aliases: ['goodfellas'] },
  { canonical: 'The Godfather', aliases: ['godfather', 'the godfather'] },
  { canonical: 'The Godfather Part II', aliases: ['godfather ii', 'godfather 2', 'godfather part ii'] },
  { canonical: 'The Dirty Dozen', aliases: ['dirty dozen', 'the dirty dozen'] },
  { canonical: 'Cool Hand Luke', aliases: ['cool hand luke'] },
  { canonical: 'Blazing Saddles', aliases: ['blazing saddles'] },
  { canonical: 'The Natural', aliases: ['the natural'] },
  { canonical: 'Interstellar', aliases: ['interstellar'] },
  { canonical: 'The Martian', aliases: ['the martian', 'martian'] },
  { canonical: 'Ford v Ferrari', aliases: ['ford v ferrari', 'ford vs ferrari', 'ford v. ferrari'] },
  { canonical: 'Silverado', aliases: ['silverado'] },
  { canonical: 'The Warriors', aliases: ['the warriors', 'warriors'] },
  { canonical: 'True Grit', aliases: ['true grit'] },
  { canonical: 'The Sting', aliases: ['the sting'] },
  { canonical: "Kelly's Heroes", aliases: ["kelly's heroes", 'kellys heroes'] },
  { canonical: 'The Man Who Shot Liberty Valance', aliases: ['liberty valance', 'man who shot liberty valance'] },
  { canonical: 'Rio Bravo', aliases: ['rio bravo'] },
  { canonical: 'The Magnificent Seven', aliases: ['magnificent seven', 'the magnificent seven'] },
  { canonical: 'Seven Samurai', aliases: ['seven samurai'] },
  { canonical: 'Shane', aliases: ['shane'] },
  { canonical: 'Zulu', aliases: ['zulu'] },
  { canonical: 'Airplane!', aliases: ['airplane'] },
  { canonical: 'The Naked Gun', aliases: ['naked gun', 'the naked gun'] },
  { canonical: 'Grumpy Old Men', aliases: ['grumpy old men'] },
  { canonical: 'The Untouchables', aliases: ['the untouchables', 'untouchables'] },
  { canonical: 'A River Runs Through It', aliases: ['river runs through it', 'a river runs through it'] },
  { canonical: 'Dr. Strangelove', aliases: ['strangelove', 'doctor strangelove', 'dr strangelove', 'dr. strangelove'] },
  { canonical: 'The Third Man', aliases: ['the third man', 'third man'] },
  { canonical: 'Midnight Run', aliases: ['midnight run'] },
  { canonical: 'Reservoir Dogs', aliases: ['reservoir dogs'] },
  { canonical: 'In Bruges', aliases: ['in bruges'] },
  { canonical: 'Das Boot', aliases: ['das boot'] },
  { canonical: 'Con Air', aliases: ['con air'] },
  { canonical: 'Gran Torino', aliases: ['gran torino'] },
  { canonical: 'The Abyss', aliases: ['the abyss', 'abyss'] },
  { canonical: 'Independence Day', aliases: ['independence day'] },
  { canonical: 'Unforgiven', aliases: ['unforgiven'] },
  { canonical: 'The Blues Brothers', aliases: ['blues brothers', 'the blues brothers'] },
  { canonical: 'MASH', aliases: ['mash', 'm*a*s*h', 'm.a.s.h'] },
  { canonical: 'Patton', aliases: ['patton'] },
  { canonical: 'The Bridge on the River Kwai', aliases: ['bridge on the river kwai', 'river kwai', 'bridge over the river kwai'] },
  { canonical: 'A Bridge Too Far', aliases: ['a bridge too far', 'bridge too far'] },
  { canonical: 'The Great Santini', aliases: ['great santini', 'the great santini'] },
  { canonical: 'Jeremiah Johnson', aliases: ['jeremiah johnson'] },
  { canonical: 'Evil Dead II', aliases: ['evil dead', 'evil dead 2', 'evil dead ii'] },
  { canonical: 'Edge of Tomorrow', aliases: ['edge of tomorrow'] },
  { canonical: 'Return of the Jedi', aliases: ['return of the jedi'] },
  { canonical: 'Saving Private Ryan', aliases: ['saving private ryan', 'private ryan'] },
  { canonical: 'Clear and Present Danger', aliases: ['clear and present danger'] },
  { canonical: 'Patriot Games', aliases: ['patriot games'] },
  { canonical: 'Air Force One', aliases: ['air force one'] },
  { canonical: 'Bloodsport', aliases: ['bloodsport'] },
  { canonical: 'The Man Who Would Be King', aliases: ['man who would be king'] },
  { canonical: 'Quigley Down Under', aliases: ['quigley down under', 'quigley'] },
  { canonical: 'Papillon', aliases: ['papillon'] },
  { canonical: 'Godzilla Minus One', aliases: ['godzilla minus one'] },
  { canonical: 'Boyhood', aliases: ['boyhood'] },
  { canonical: 'The Firm', aliases: ['the firm'] },
  { canonical: 'Dodgeball', aliases: ['dodgeball'] },
  { canonical: 'Ladyhawke', aliases: ['ladyhawke'] },
  { canonical: 'The Treasure of the Sierra Madre', aliases: ['treasure of the sierra madre', 'sierra madre'] },
  { canonical: 'The Day the Earth Stood Still', aliases: ['day the earth stood still'] },
  { canonical: 'Heavy Metal', aliases: ['heavy metal'] },
  { canonical: 'The Taking of Pelham One Two Three', aliases: ['taking of pelham', 'pelham 123', 'pelham one two three'] },
  { canonical: 'Uncle Buck', aliases: ['uncle buck'] },
  { canonical: 'Mrs. Doubtfire', aliases: ['mrs doubtfire', 'mrs. doubtfire'] },
  { canonical: 'Hook', aliases: ['hook'] },
  { canonical: 'Young Frankenstein', aliases: ['young frankenstein'] },
  { canonical: 'Father of the Bride', aliases: ['father of the bride'] },
  { canonical: 'A League of Their Own', aliases: ['league of their own', 'a league of their own'] },
  { canonical: 'Band of Brothers', aliases: ['band of brothers'] },
  { canonical: 'Henry V', aliases: ['henry v', 'henry the fifth'] },
  { canonical: 'The Pacific', aliases: ['the pacific'] },
  { canonical: 'The Bourne Identity', aliases: ['bourne identity', 'bourne', 'jason bourne'] },
  { canonical: 'Reign of Fire', aliases: ['reign of fire'] },
  { canonical: 'The Nice Guys', aliases: ['the nice guys', 'nice guys'] },
  { canonical: 'Harry and the Hendersons', aliases: ['harry and the hendersons'] },
  { canonical: 'Force 10 from Navarone', aliases: ['force 10', 'force 10 from navarone', 'navarone'] },
  { canonical: 'The Andromeda Strain', aliases: ['andromeda strain'] },
  { canonical: "It's a Mad, Mad, Mad, Mad World", aliases: ['mad mad mad mad world', "it's a mad"] },
  { canonical: 'Hail, Caesar!', aliases: ['hail caesar', 'hail, caesar'] },
  { canonical: 'Down Periscope', aliases: ['down periscope'] },
  { canonical: 'The Pentagon Wars', aliases: ['pentagon wars'] },
  { canonical: 'Iron Eagle', aliases: ['iron eagle'] },
  { canonical: 'Spartacus', aliases: ['spartacus'] },
  { canonical: 'The Battle of Britain', aliases: ['battle of britain'] },
  { canonical: 'Deja Vu', aliases: ['deja vu'] },
  { canonical: 'Unstoppable', aliases: ['unstoppable'] },
  { canonical: 'Jackie Brown', aliases: ['jackie brown'] },
  { canonical: 'The Usual Suspects', aliases: ['usual suspects'] },
  { canonical: 'Seven Days in May', aliases: ['seven days in may'] },
  { canonical: 'Midnight Special', aliases: ['midnight special'] },
  { canonical: 'The Sandlot', aliases: ['the sandlot', 'sandlot'] },
  { canonical: 'Honey, I Shrunk the Kids', aliases: ['honey i shrunk', 'honey, i shrunk'] },
  { canonical: 'Lonesome Dove', aliases: ['lonesome dove'] },
  { canonical: 'Wag the Dog', aliases: ['wag the dog'] },
  { canonical: 'The Birdcage', aliases: ['the birdcage', 'birdcage'] },
  { canonical: "Ocean's Thirteen", aliases: ["ocean's thirteen", "oceans thirteen", "oceans 13", "ocean's 13"] },
  { canonical: 'Michael Clayton', aliases: ['michael clayton'] },
  { canonical: 'Logan', aliases: ['logan'] },
  { canonical: 'The Maltese Falcon', aliases: ['maltese falcon'] },
  { canonical: 'Casino Royale', aliases: ['casino royale'] },
  { canonical: 'The Ninth Gate', aliases: ['ninth gate'] },
  { canonical: 'The Birds', aliases: ['the birds'] },
  { canonical: 'Twelve Monkeys', aliases: ['twelve monkeys', '12 monkeys'] },
  { canonical: 'Romeo + Juliet', aliases: ['romeo and juliet', 'romeo+juliet', 'romeo + juliet'] },
  { canonical: 'Last of the Mohicans', aliases: ['last of the mohicans', 'mohicans'] },
  { canonical: 'Charade', aliases: ['charade'] },
  { canonical: 'Once Upon a Time in the West', aliases: ['once upon a time in the west'] },
  { canonical: 'Bridge of Spies', aliases: ['bridge of spies'] },
  { canonical: 'In the Line of Fire', aliases: ['in the line of fire', 'line of fire'] },
  { canonical: 'Dirty Harry', aliases: ['dirty harry'] },
  { canonical: 'Slap Shot', aliases: ['slap shot'] },
  { canonical: 'Enemy of the State', aliases: ['enemy of the state'] },
  { canonical: 'The Town', aliases: ['the town'] },
  { canonical: 'Popeye', aliases: ['popeye'] },
  { canonical: 'Jurassic Park', aliases: ['jurassic park'] },
  { canonical: 'The Matrix', aliases: ['the matrix', 'matrix'] },
  { canonical: 'Star Wars', aliases: ['star wars'] },
  { canonical: 'Pride and Prejudice', aliases: ['pride and prejudice', 'pride & prejudice'] },
  { canonical: "All the President's Men", aliases: ["all the president's men", 'all the presidents men'] },
  { canonical: 'Hoosiers', aliases: ['hoosiers'] },
  { canonical: 'High Noon', aliases: ['high noon'] },
  { canonical: 'The Pursuit of Happyness', aliases: ['pursuit of happiness', 'pursuit of happyness'] },
  { canonical: 'Madagascar: Escape 2 Africa', aliases: ['madagascar', 'madagascar 2', 'madagascar escape'] },
  { canonical: 'Tar', aliases: ['tár', 'tar'] },
  { canonical: 'The Lord of the Rings', aliases: ['lord of the rings', 'lotr'] },
  { canonical: 'James Bond', aliases: ['james bond', 'bond movies', 'bond films', 'sean connery bond'] },
  { canonical: 'Support Your Local Sheriff!', aliases: ['support your local sheriff'] },
  { canonical: 'The Ballad of Buster Scruggs', aliases: ['ballad of buster scruggs', 'buster scruggs'] },
  { canonical: 'The Raid', aliases: ['the raid'] },
  { canonical: 'Sky Captain and the World of Tomorrow', aliases: ['sky captain'] },
  { canonical: 'The Dollars Trilogy', aliases: ['dollars trilogy', 'spaghetti westerns'] },
  { canonical: 'Dune', aliases: ['dune'] },
  { canonical: 'The Shining', aliases: ['the shining'] },
  { canonical: 'A Night to Remember', aliases: ['a night to remember', 'night to remember'] },
  { canonical: 'The Great Waldo Pepper', aliases: ['great waldo pepper', 'waldo pepper'] },
  { canonical: 'Lifeforce', aliases: ['lifeforce'] },
  { canonical: 'The Last of Sheila', aliases: ['last of sheila'] },
  // Additional titles spotted in the thread
  { canonical: 'The Pursuit of Happyness', aliases: ['pursuit of happiness'] },
  { canonical: 'Midnight Run', aliases: ['midnight run'] },
  { canonical: "Abbott and Costello Meets Frankenstein", aliases: ['abbott and costello'] },
  { canonical: "Anne of Green Gables", aliases: ['anne of green gables'] },
  { canonical: 'Airplane!', aliases: ['airplane!'] },
  { canonical: 'Deja Vu', aliases: ['déjà vu'] },
  { canonical: "Oh! What a Lovely War", aliases: ["oh what a lovely war"] },
  { canonical: 'A Night at the Opera', aliases: ['night at the opera'] },
  { canonical: 'The Fatal Glass of Beer', aliases: ['fatal glass of beer'] },
  { canonical: 'Bananas', aliases: ['bananas'] },
  { canonical: 'Love and Death', aliases: ['love and death'] },
  { canonical: 'THEM!', aliases: ['them!', 'them'] },
  { canonical: 'Creature from the Black Lagoon', aliases: ['creature from the black lagoon'] },
];

// Build a search index: lowercase alias -> canonical title
const aliasIndex = new Map();
for (const entry of TITLE_DICTIONARY) {
  for (const alias of entry.aliases) {
    aliasIndex.set(alias.toLowerCase(), entry.canonical);
  }
}

// Sort aliases by length descending so longer matches take priority
const sortedAliases = [...aliasIndex.entries()].sort((a, b) => b[0].length - a[0].length);

/**
 * Search for known titles in text using the dictionary.
 * Returns canonical title names found.
 */
function findTitlesInText(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set();

  for (const [alias, canonical] of sortedAliases) {
    if (alias.length < 4) continue; // Skip very short aliases to avoid false matches

    // Word boundary check: alias must be surrounded by non-alphanumeric chars or string boundaries
    const idx = lower.indexOf(alias);
    if (idx === -1) continue;

    const before = idx > 0 ? lower[idx - 1] : ' ';
    const after = idx + alias.length < lower.length ? lower[idx + alias.length] : ' ';
    const isWordBoundary = (ch) => !ch.match(/[a-z0-9]/);

    if (isWordBoundary(before) && isWordBoundary(after)) {
      found.add(canonical);
    }
  }

  return [...found];
}

/**
 * Run title-dictionary extraction on all posts.
 * @param {Array} posts - Array of fixture posts
 * @returns {Map<string, string[]>} - Map of URI -> predicted titles
 */
export function run(posts) {
  const predictions = new Map();

  for (const post of posts) {
    let textToSearch = post.fullText || post.text || '';
    if (post.quotedText) textToSearch += '\n' + post.quotedText;

    const titles = findTitlesInText(textToSearch);
    if (titles.length > 0) {
      predictions.set(post.uri, titles);
    }
  }

  return predictions;
}

// Export for use by hybrid algorithm
export { findTitlesInText, TITLE_DICTIONARY };
