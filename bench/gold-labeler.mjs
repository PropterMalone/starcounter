/**
 * Gold-standard labeler for the dad-movies benchmark fixture.
 *
 * Reads bench/fixtures/dad-movies.json, determines which movie title(s) each
 * post references, and writes bench/labels/dad-movies-gold.json.
 *
 * Three-pass approach:
 *   1. Build a title-matching index (canonical titles, aliases, abbreviations).
 *   2. Scan every post for explicit title matches.
 *   3. Context pass: inherit titles from parents for reaction/agreement posts.
 *
 * Usage:  node bench/gold-labeler.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'dad-movies.json');
const OUTPUT_DIR = join(__dirname, 'labels');
const OUTPUT_PATH = join(OUTPUT_DIR, 'dad-movies-gold.json');

/**
 * Maximum inheritance chain depth. A reaction to a movie mention (depth 1) is
 * fine. A reply to that reaction (depth 2) is borderline. Beyond that we lose
 * confidence that the conversation is still about the original movie.
 */
const MAX_INHERITANCE_DEPTH = 2;

// ---------------------------------------------------------------------------
// 1. Title universe
// ---------------------------------------------------------------------------

/** Abbreviations and informal shorthand -> canonical title. */
const ABBREVIATIONS = new Map([
  ['m&c', 'Master and Commander: The Far Side of the World'],
  ['m & c', 'Master and Commander: The Far Side of the World'],
  ['master & commander', 'Master and Commander: The Far Side of the World'],
  ['master and commander', 'Master and Commander: The Far Side of the World'],
  ['master & commmander', 'Master and Commander: The Far Side of the World'],
  ['master and commmander', 'Master and Commander: The Far Side of the World'],
  ['hms surprise', 'Master and Commander: The Far Side of the World'],
  ['hms suprise', 'Master and Commander: The Far Side of the World'],
  ['far side of the world', 'Master and Commander: The Far Side of the World'],
  ['hfro', 'The Hunt for Red October'],
  ['lotr', 'The Lord of the Rings'],
  ['lord of the rings', 'The Lord of the Rings'],
  ['tdk', 'The Dark Knight'],
  ['the dark knight', 'The Dark Knight'],
  ['jason bourne', 'The Bourne Identity'],
  ['bourne identity', 'The Bourne Identity'],
  ['bourne trilogy', 'The Bourne Identity'],
  ['bourne movies', 'The Bourne Identity'],
  ['bourne series', 'The Bourne Identity'],
  ['bourne films', 'The Bourne Identity'],
  ['bond movies', 'James Bond'],
  ['bond films', 'James Bond'],
  ['james bond', 'James Bond'],
  ['007', 'James Bond'],
  ['indy', 'Indiana Jones'],
  ['indiana jones', 'Indiana Jones'],
  ['raiders of the lost ark', 'Indiana Jones'],
  ['temple of doom', 'Indiana Jones'],
  ['kingdom of the crystal skull', 'Indiana Jones'],
  ['ford vs ferrari', 'Ford v Ferrari'],
  ['ford v. ferrari', 'Ford v Ferrari'],
  ['ford v ferrari', 'Ford v Ferrari'],
  ['dr strangelove', 'Dr. Strangelove'],
  ['dr. strangelove', 'Dr. Strangelove'],
  ['strangelove', 'Dr. Strangelove'],
  ['mrs doubtfire', 'Mrs. Doubtfire'],
  ['mrs. doubtfire', 'Mrs. Doubtfire'],
  ['oceans eleven', "Ocean's Eleven"],
  ["ocean's eleven", "Ocean's Eleven"],
  ['oceans 11', "Ocean's Eleven"],
  ["ocean's 11", "Ocean's Eleven"],
  ['oceans thirteen', "Ocean's Thirteen"],
  ["ocean's thirteen", "Ocean's Thirteen"],
  ['oceans 13', "Ocean's Thirteen"],
  ["ocean's 13", "Ocean's Thirteen"],
  ['star wars ot', 'Star Wars'],
  ['star wars', 'Star Wars'],
  ['a new hope', 'Star Wars'],
  ['empire strikes back', 'Star Wars'],
  ['return of the jedi', 'Star Wars'],
  ['star trek ii', 'Star Trek II: The Wrath of Khan'],
  ['wrath of khan', 'Star Trek II: The Wrath of Khan'],
  ['star trek', 'Star Trek'],
  ['la confidential', 'L.A. Confidential'],
  ['l.a. confidential', 'L.A. Confidential'],
  ['monty python and the holy grail', 'Monty Python and the Holy Grail'],
  ['holy grail', 'Monty Python and the Holy Grail'],
  ['life of brian', "Monty Python's Life of Brian"],
  ['top gun: maverick', 'Top Gun: Maverick'],
  ['top gun maverick', 'Top Gun: Maverick'],
  ['planes trains and automobiles', 'Planes, Trains and Automobiles'],
  ['planes, trains', 'Planes, Trains and Automobiles'],
  ['planes trains', 'Planes, Trains and Automobiles'],
  ['honey i shrunk the kids', 'Honey, I Shrunk the Kids'],
  ['honey, i shrunk', 'Honey, I Shrunk the Kids'],
  ['honey i shrunk', 'Honey, I Shrunk the Kids'],
  ["it's a mad mad mad mad world", "It's a Mad, Mad, Mad, Mad World"],
  ['mad mad mad', "It's a Mad, Mad, Mad, Mad World"],
  ["kelly's heroes", "Kelly's Heroes"],
  ['kellys heroes', "Kelly's Heroes"],
  ['butch cassidy and the sundance kid', 'Butch Cassidy and the Sundance Kid'],
  ['butch cassidy', 'Butch Cassidy and the Sundance Kid'],
  ['the good, the bad and the ugly', 'The Good, the Bad and the Ugly'],
  ['the good the bad and the ugly', 'The Good, the Bad and the Ugly'],
  ['good bad ugly', 'The Good, the Bad and the Ugly'],
  ['good bad and ugly', 'The Good, the Bad and the Ugly'],
  ['good the bad', 'The Good, the Bad and the Ugly'],
  ['dollars trilogy', 'The Good, the Bad and the Ugly'],
  ['fistful of dollars', 'A Fistful of Dollars'],
  ['for a few dollars more', 'For a Few Dollars More'],
  ['bridge on the river kwai', 'The Bridge on the River Kwai'],
  ['bridge over the river kwai', 'The Bridge on the River Kwai'],
  ['river kwai', 'The Bridge on the River Kwai'],
  ['a bridge too far', 'A Bridge Too Far'],
  ['bridge too far', 'A Bridge Too Far'],
  ['big trouble in little china', 'Big Trouble in Little China'],
  ['once upon a time in the west', 'Once Upon a Time in the West'],
  ['taking of pelham one two three', 'The Taking of Pelham One Two Three'],
  ['taking of pelham 123', 'The Taking of Pelham One Two Three'],
  ['taking of pelham', 'The Taking of Pelham One Two Three'],
  ['pelham one two three', 'The Taking of Pelham One Two Three'],
  ['pelham 123', 'The Taking of Pelham One Two Three'],
  ['man who shot liberty valance', 'The Man Who Shot Liberty Valance'],
  ['liberty valance', 'The Man Who Shot Liberty Valance'],
  ['man who would be king', 'The Man Who Would Be King'],
  ['the man from u.n.c.l.e.', 'The Man from U.N.C.L.E.'],
  ['man from uncle', 'The Man from U.N.C.L.E.'],
  ['treasure of the sierra madre', 'The Treasure of the Sierra Madre'],
  ['sierra madre', 'The Treasure of the Sierra Madre'],
  ['day the earth stood still', 'The Day the Earth Stood Still'],
  ["all the president's men", "All the President's Men"],
  ['all the presidents men', "All the President's Men"],
  ['last of the mohicans', 'The Last of the Mohicans'],
  ['ballad of buster scruggs', 'The Ballad of Buster Scruggs'],
  ['buster scruggs', 'The Ballad of Buster Scruggs'],
  ['support your local sheriff', 'Support Your Local Sheriff!'],
  ['support your local gunfighter', 'Support Your Local Gunfighter'],
  ['night to remember', 'A Night to Remember'],
  ['league of their own', 'A League of Their Own'],
  ['river runs through it', 'A River Runs Through It'],
  ['river runs through', 'A River Runs Through It'],
  ['to live and die in la', 'To Live and Die in L.A.'],
  ['to live and die in l.a.', 'To Live and Die in L.A.'],
  ['three days of the condor', 'Three Days of the Condor'],
  ['no country for old men', 'No Country for Old Men'],
  ['romeo and juliet', 'Romeo + Juliet'],
  ['romeo + juliet', 'Romeo + Juliet'],
  ['romeo+juliet', 'Romeo + Juliet'],
  ['right stuff', 'The Right Stuff'],
  ['the right stuff', 'The Right Stuff'],
  ['outlaw josey wales', 'The Outlaw Josey Wales'],
  ['josey wales', 'The Outlaw Josey Wales'],
  ['christmas vacation', "National Lampoon's Christmas Vacation"],
  ['national lampoon', "National Lampoon's Christmas Vacation"],
  ['guns of navarone', 'The Guns of Navarone'],
  ['to kill a mockingbird', 'To Kill a Mockingbird'],
  ['the searchers', 'The Searchers'],
  ['french connection', 'The French Connection'],
  ['escape from new york', 'Escape from New York'],
  ['the quiet man', 'The Quiet Man'],
  ['quiet man', 'The Quiet Man'],
  ['fury road', 'Mad Max: Fury Road'],
  ['mad max fury road', 'Mad Max: Fury Road'],
  ['mad max', 'Mad Max'],
  ['road warrior', 'Mad Max 2: The Road Warrior'],
  ['the longest day', 'The Longest Day'],
  ['tora tora tora', 'Tora! Tora! Tora!'],
  ['tora! tora! tora!', 'Tora! Tora! Tora!'],
  ['tora tora', 'Tora! Tora! Tora!'],
  ['black hawk down', 'Black Hawk Down'],
  ['when harry met sally', 'When Harry Met Sally...'],
  ['saving private ryan', 'Saving Private Ryan'],
  ['shawshank redemption', 'The Shawshank Redemption'],
  ['shawshank', 'The Shawshank Redemption'],
  ['pride and prejudice', 'Pride and Prejudice'],
  ['pride & prejudice', 'Pride and Prejudice'],
  ['indiana jones and the last crusade', 'Indiana Jones and the Last Crusade'],
  ['last crusade', 'Indiana Jones and the Last Crusade'],
  ['clear and present danger', 'Clear and Present Danger'],
  ['clear & present danger', 'Clear and Present Danger'],
  ['sound of music', 'The Sound of Music'],
  ['my fair lady', 'My Fair Lady'],
  ['godzilla minus one', 'Godzilla Minus One'],
  ["wayne's world", "Wayne's World"],
  ['waynes world', "Wayne's World"],
  ['dog day afternoon', 'Dog Day Afternoon'],
  ['in the line of fire', 'In the Line of Fire'],
  ['andromeda strain', 'The Andromeda Strain'],
  ['battle of britain', 'Battle of Britain'],
  ['seven days in may', 'Seven Days in May'],
  ['enemy at the gates', 'Enemy at the Gates'],
  ['we were soldiers', 'We Were Soldiers'],
  ['thin red line', 'The Thin Red Line'],
  ['full metal jacket', 'Full Metal Jacket'],
  ['high plains drifter', 'High Plains Drifter'],
  ['a bronx tale', 'A Bronx Tale'],
  ['bronx tale', 'A Bronx Tale'],
  ['count of monte cristo', 'The Count of Monte Cristo'],
  ['great waldo pepper', 'The Great Waldo Pepper'],
  ['henry v', 'Henry V'],
  ['great santini', 'The Great Santini'],
  ['quigley down under', 'Quigley Down Under'],
]);

/**
 * Canonical title -> array of match patterns (lowercase).
 * Each pattern is matched as a substring of the post text (case-insensitive).
 * Longer / more specific patterns come first within each title.
 */
const TITLE_PATTERNS = buildTitlePatterns();

function buildTitlePatterns() {
  const raw = {
    'Master and Commander: The Far Side of the World': [
      'master and commander: the far side of the world',
      'master and commander',
      'master & commander',
      'master and commmander',
      'master & commmander',
    ],
    'The Hunt for Red October': [
      'the hunt for red october',
      'hunt for red october',
      'red october',
    ],
    'Die Hard': ['die hard'],
    'The Fugitive': ['the fugitive'],
    'Ronin': ['ronin'],
    'Indiana Jones and the Last Crusade': [
      'indiana jones and the last crusade',
      'last crusade',
    ],
    'The Shawshank Redemption': ['shawshank redemption', 'shawshank'],
    'Field of Dreams': ['field of dreams'],
    'Gladiator': ['gladiator'],
    'Heat': ['heat'],
    'The Great Escape': ['the great escape', 'great escape'],
    'Top Gun': ['top gun'],
    'Top Gun: Maverick': ['top gun: maverick', 'top gun maverick'],
    'Apollo 13': ['apollo 13', 'apollo xiii'],
    'Tombstone': ['tombstone'],
    'Sneakers': ['sneakers'],
    'A Few Good Men': ['a few good men', 'few good men'],
    'Casablanca': ['casablanca'],
    'The Good, the Bad and the Ugly': [
      'the good, the bad and the ugly',
      'the good the bad and the ugly',
      'good, the bad',
      'good the bad',
    ],
    'Gettysburg': ['gettysburg'],
    'The Princess Bride': ['the princess bride', 'princess bride'],
    'Lawrence of Arabia': ['lawrence of arabia'],
    'Star Trek II: The Wrath of Khan': [
      'star trek ii: the wrath of khan',
      'wrath of khan',
      'star trek ii',
    ],
    'Goodfellas': ['goodfellas'],
    'The Godfather': ['the godfather', 'godfather'],
    'The Dirty Dozen': ['the dirty dozen', 'dirty dozen'],
    'Cool Hand Luke': ['cool hand luke'],
    'Blazing Saddles': ['blazing saddles'],
    'The Natural': ['the natural'],
    'Interstellar': ['interstellar'],
    'The Martian': ['the martian'],
    'Ford v Ferrari': ['ford v ferrari', 'ford vs ferrari', 'ford v. ferrari'],
    'Silverado': ['silverado'],
    'The Warriors': ['the warriors'],
    'True Grit': ['true grit'],
    'The Sting': ['the sting'],
    "Kelly's Heroes": ["kelly's heroes", 'kellys heroes'],
    'The Man Who Shot Liberty Valance': [
      'the man who shot liberty valance',
      'liberty valance',
    ],
    'Rio Bravo': ['rio bravo'],
    'The Magnificent Seven': ['the magnificent seven', 'magnificent seven'],
    'Seven Samurai': ['seven samurai'],
    'Shane': ['shane'],
    'Zulu': ['zulu'],
    'Airplane!': ['airplane!', 'airplane'],
    'The Naked Gun': ['the naked gun', 'naked gun'],
    'Grumpy Old Men': ['grumpy old men'],
    'The Untouchables': ['the untouchables', 'untouchables'],
    'A River Runs Through It': [
      'a river runs through it',
      'river runs through it',
      'river runs through',
    ],
    'Dr. Strangelove': ['dr. strangelove', 'dr strangelove', 'strangelove'],
    'The Third Man': ['the third man'],
    'Midnight Run': ['midnight run'],
    'Reservoir Dogs': ['reservoir dogs'],
    'In Bruges': ['in bruges'],
    'Das Boot': ['das boot'],
    'Con Air': ['con air'],
    'Gran Torino': ['gran torino'],
    'The Abyss': ['the abyss'],
    'Independence Day': ['independence day'],
    'Unforgiven': ['unforgiven'],
    'The Blues Brothers': ['the blues brothers', 'blues brothers'],
    'MASH': ['m*a*s*h', 'mash'],
    'Patton': ['patton'],
    'The Bridge on the River Kwai': [
      'bridge on the river kwai',
      'bridge over the river kwai',
      'river kwai',
    ],
    'A Bridge Too Far': ['a bridge too far', 'bridge too far'],
    'The Great Santini': ['the great santini', 'great santini'],
    'Jeremiah Johnson': ['jeremiah johnson'],
    'Evil Dead II': ['evil dead ii', 'evil dead 2', 'evil dead'],
    'Edge of Tomorrow': ['edge of tomorrow'],
    'Saving Private Ryan': ['saving private ryan'],
    'Clear and Present Danger': ['clear and present danger', 'clear & present danger'],
    'Patriot Games': ['patriot games'],
    'Air Force One': ['air force one'],
    'Bloodsport': ['bloodsport'],
    'The Man Who Would Be King': ['the man who would be king', 'man who would be king'],
    'Quigley Down Under': ['quigley down under'],
    'Papillon': ['papillon'],
    'Godzilla Minus One': ['godzilla minus one'],
    'Boyhood': ['boyhood'],
    'The Firm': ['the firm'],
    'Dodgeball': ['dodgeball'],
    'Ladyhawke': ['ladyhawke'],
    'The Treasure of the Sierra Madre': [
      'treasure of the sierra madre',
      'sierra madre',
    ],
    'The Day the Earth Stood Still': ['day the earth stood still'],
    'Heavy Metal': ['heavy metal'],
    'The Taking of Pelham One Two Three': [
      'taking of pelham one two three',
      'taking of pelham 123',
      'taking of pelham',
      'pelham one two three',
      'pelham 123',
    ],
    'Uncle Buck': ['uncle buck'],
    'Mrs. Doubtfire': ['mrs. doubtfire', 'mrs doubtfire'],
    'Hook': ['hook'],
    'Young Frankenstein': ['young frankenstein'],
    'Father of the Bride': ['father of the bride'],
    'A League of Their Own': ['a league of their own', 'league of their own'],
    'Band of Brothers': ['band of brothers'],
    'Henry V': ['henry v'],
    'The Pacific': ['the pacific'],
    'The Bourne Identity': ['bourne identity', 'the bourne identity'],
    'Reign of Fire': ['reign of fire'],
    'The Nice Guys': ['the nice guys', 'nice guys'],
    'Harry and the Hendersons': ['harry and the hendersons'],
    'Force 10 from Navarone': ['force 10 from navarone', 'force 10'],
    'The Andromeda Strain': ['the andromeda strain', 'andromeda strain'],
    "It's a Mad, Mad, Mad, Mad World": [
      "it's a mad mad mad mad world",
      'mad mad mad mad world',
      'mad mad mad',
    ],
    'Hail, Caesar!': ['hail caesar', 'hail, caesar'],
    'Down Periscope': ['down periscope'],
    'The Pentagon Wars': ['the pentagon wars', 'pentagon wars'],
    'Iron Eagle': ['iron eagle'],
    'Spartacus': ['spartacus'],
    'Battle of Britain': ['battle of britain'],
    'Deja Vu': ['deja vu', 'déjà vu'],
    'Unstoppable': ['unstoppable'],
    'Jackie Brown': ['jackie brown'],
    'The Usual Suspects': ['the usual suspects', 'usual suspects'],
    'Seven Days in May': ['seven days in may'],
    'Midnight Special': ['midnight special'],
    'The Sandlot': ['the sandlot', 'sandlot'],
    'Honey, I Shrunk the Kids': ['honey i shrunk the kids', 'honey, i shrunk'],
    'Lonesome Dove': ['lonesome dove'],
    'Wag the Dog': ['wag the dog'],
    'The Birdcage': ['the birdcage', 'birdcage'],
    "Ocean's Thirteen": ["ocean's thirteen", 'oceans thirteen'],
    'Michael Clayton': ['michael clayton'],
    'Madagascar: Escape 2 Africa': ['madagascar: escape 2 africa', 'madagascar'],
    'Logan': ['logan'],
    'The Maltese Falcon': ['the maltese falcon', 'maltese falcon'],
    'Casino Royale': ['casino royale'],
    'The Ninth Gate': ['the ninth gate', 'ninth gate'],
    'The Birds': ['the birds'],
    'Twelve Monkeys': ['twelve monkeys', '12 monkeys'],
    'Romeo + Juliet': ['romeo + juliet', 'romeo+juliet', 'romeo and juliet'],
    'The Last of the Mohicans': [
      'the last of the mohicans',
      'last of the mohicans',
    ],
    'Charade': ['charade'],
    'Once Upon a Time in the West': ['once upon a time in the west'],
    'Lifeforce': ['lifeforce'],
    'The Last of Sheila': ['last of sheila'],
    'Bridge of Spies': ['bridge of spies'],
    'In the Line of Fire': ['in the line of fire'],
    'Dirty Harry': ['dirty harry'],
    'Slap Shot': ['slap shot'],
    'Enemy of the State': ['enemy of the state'],
    'The Town': ['the town'],
    'Popeye': ['popeye'],
    'Jurassic Park': ['jurassic park'],
    'The Matrix': ['the matrix'],
    'Star Wars': ['star wars'],
    'Dune': ['dune'],
    'Batman': ['batman'],
    'Carrie': ['carrie'],
    'The Shining': ['the shining'],
    'A Night to Remember': ['a night to remember', 'night to remember'],
    'Support Your Local Sheriff!': [
      'support your local sheriff',
      'support your local',
    ],
    'The Ballad of Buster Scruggs': [
      'ballad of buster scruggs',
      'buster scruggs',
    ],
    'The Raid': ['the raid'],
    'High Noon': ['high noon'],
    'Sky Captain and the World of Tomorrow': ['sky captain'],
    'The Pursuit of Happyness': [
      'the pursuit of happyness',
      'pursuit of happiness',
      'pursuit of happyness',
    ],
    'Pride and Prejudice': ['pride and prejudice', 'pride & prejudice'],
    "All the President's Men": [
      "all the president's men",
      'all the presidents men',
    ],
    'Hoosiers': ['hoosiers'],
    'The Great Waldo Pepper': ['great waldo pepper'],
    // Additional titles discovered in the data
    'Crimson Tide': ['crimson tide'],
    'The Rock': ['the rock'],
    'Big Fish': ['big fish'],
    'The Right Stuff': ['the right stuff', 'right stuff'],
    'Where Eagles Dare': ['where eagles dare'],
    'The Last Castle': ['the last castle', 'last castle'],
    'Moneyball': ['moneyball', 'money ball'],
    'The Big Lebowski': ['the big lebowski', 'big lebowski'],
    'Escape from New York': ['escape from new york'],
    'Rudy': ['rudy'],
    'WarGames': ['war games', 'wargames'],
    "When Harry Met Sally...": ['when harry met sally'],
    'The Sound of Music': ['sound of music'],
    'My Fair Lady': ['my fair lady'],
    "Wayne's World": ["wayne's world", 'waynes world'],
    'Indiana Jones': ['indiana jones'],
    'James Bond': ['james bond', 'bond movies', 'bond films', '007'],
    'The Lord of the Rings': [
      'lord of the rings',
      'fellowship of the ring',
      'two towers',
      'return of the king',
    ],
    'The Dark Knight': ['the dark knight', 'dark knight'],
    "Ocean's Eleven": ["ocean's eleven", 'oceans eleven', "ocean's 11"],
    'L.A. Confidential': ['la confidential', 'l.a. confidential'],
    'Monty Python and the Holy Grail': [
      'monty python and the holy grail',
      'holy grail',
    ],
    "Monty Python's Life of Brian": ['life of brian'],
    'Back to the Future': ['back to the future'],
    'Point Break': ['point break'],
    'Predator': ['predator'],
    'Aliens': ['aliens'],
    'The Terminator': ['terminator'],
    'Lethal Weapon': ['lethal weapon'],
    'Beverly Hills Cop': ['beverly hills cop'],
    "Ferris Bueller's Day Off": ['ferris bueller'],
    'National Treasure': ['national treasure'],
    'Twister': ['twister'],
    'Armageddon': ['armageddon'],
    'The Departed': ['the departed'],
    'Fight Club': ['fight club'],
    'The Count of Monte Cristo': ['count of monte cristo'],
    'Troy': ['troy'],
    'Braveheart': ['braveheart'],
    'Jaws': ['jaws'],
    'Galaxy Quest': ['galaxy quest'],
    'Men in Black': ['men in black'],
    'RoboCop': ['robocop'],
    'Speed': ['speed'],
    'The Fifth Element': ['fifth element'],
    'Tremors': ['tremors'],
    'Total Recall': ['total recall'],
    'Three Amigos': ['three amigos'],
    'Groundhog Day': ['groundhog day'],
    'Ghostbusters': ['ghostbusters'],
    'The Thing': ['the thing'],
    'Big Trouble in Little China': ['big trouble in little china'],
    'Conan the Barbarian': ['conan the barbarian', 'conan'],
    'Excalibur': ['excalibur'],
    'Mad Max': ['mad max'],
    'Mad Max: Fury Road': ['fury road', 'mad max fury road', 'mad max: fury road'],
    'The Revenant': ['the revenant'],
    'No Country for Old Men': ['no country for old men'],
    'Sicario': ['sicario'],
    'The Wind and the Lion': ['wind and the lion'],
    'Three Days of the Condor': ['three days of the condor'],
    'Marathon Man': ['marathon man'],
    'Black Hawk Down': ['black hawk down'],
    'The Longest Day': ['the longest day', 'longest day'],
    'The Guns of Navarone': ['guns of navarone'],
    'Tora! Tora! Tora!': ['tora tora tora', 'tora! tora! tora!', 'tora tora'],
    'To Kill a Mockingbird': ['to kill a mockingbird'],
    'Cool Runnings': ['cool runnings'],
    'Rocky': ['rocky'],
    'First Blood': ['first blood'],
    'Rambo': ['rambo'],
    'Commando': ['commando'],
    'Spaceballs': ['spaceballs'],
    'Caddyshack': ['caddyshack'],
    'Animal House': ['animal house'],
    'Stripes': ['stripes'],
    'Butch Cassidy and the Sundance Kid': [
      'butch cassidy and the sundance kid',
      'butch cassidy',
    ],
    'North by Northwest': ['north by northwest'],
    'Rear Window': ['rear window'],
    'We Were Soldiers': ['we were soldiers'],
    'The Thin Red Line': ['thin red line'],
    'Full Metal Jacket': ['full metal jacket'],
    'Apocalypse Now': ['apocalypse now'],
    'Platoon': ['platoon'],
    'The Outlaw Josey Wales': ['outlaw josey wales', 'josey wales'],
    'Pale Rider': ['pale rider'],
    'High Plains Drifter': ['high plains drifter'],
    'Clash of the Titans': ['clash of the titans'],
    'Willow': ['willow'],
    'The Searchers': ['the searchers'],
    'Red River': ['red river'],
    'The Quiet Man': ['the quiet man', 'quiet man'],
    'A Fistful of Dollars': ['fistful of dollars'],
    'For a Few Dollars More': ['for a few dollars more'],
    'John Wick': ['john wick'],
    'Taken': ['taken'],
    'The Accountant': ['the accountant'],
    'Jack Reacher': ['jack reacher'],
    'Nobody': ['nobody'],
    'Man on Fire': ['man on fire'],
    'The Negotiator': ['the negotiator'],
    'Under Siege': ['under siege'],
    'The Last Samurai': ['the last samurai', 'last samurai'],
    'Collateral': ['collateral'],
    'Training Day': ['training day'],
    'Shutter Island': ['shutter island'],
    'The Prestige': ['the prestige'],
    'Inception': ['inception'],
    'Tenet': ['tenet'],
    'Dunkirk': ['dunkirk'],
    'Oppenheimer': ['oppenheimer'],
    'To Live and Die in L.A.': ['to live and die in la', 'to live and die in l.a.'],
    'Cooley High': ['cooley high'],
    'Glory': ['glory'],
    'Three Kings': ['three kings'],
    'Major League': ['major league'],
    'Bull Durham': ['bull durham'],
    'A Bronx Tale': ['a bronx tale', 'bronx tale'],
    'Casino': ['casino'],
    'Scarface': ['scarface'],
    'Dog Day Afternoon': ['dog day afternoon'],
    'Serpico': ['serpico'],
    'The French Connection': ['french connection'],
    'Contact': ['contact'],
    'The Patriot': ['the patriot'],
    'Enemy at the Gates': ['enemy at the gates'],
    'Sahara': ['sahara'],
    "National Lampoon's Christmas Vacation": [
      "national lampoon's christmas vacation",
      'christmas vacation',
      'national lampoon',
    ],
    'Fletch': ['fletch'],
    'Spy Game': ['spy game'],
    'Chinatown': ['chinatown'],
    'The Big Country': ['the big country', 'big country'],
    'Open Range': ['open range'],
    'Wyatt Earp': ['wyatt earp'],
    'Road House': ['road house', 'roadhouse'],
    'Maverick': ['maverick'],
    'The Great Outdoors': ['the great outdoors', 'great outdoors'],
    'Dutch': ['dutch'],
    "The 'Burbs": ['the burbs', "the 'burbs"],
    'Miracle': ['miracle'],
    'Magnum Force': ['magnum force'],
    'Stagecoach': ['stagecoach'],
    'Sands of Iwo Jima': ['sands of iwo jima'],
    'Alien': ['alien'],
    'Blade Runner': ['blade runner'],
    'Top Secret!': ['top secret'],
    'The Great Dictator': ['great dictator'],
    'Vertigo': ['vertigo'],
    'Psycho': ['psycho'],
    'Stand by Me': ['stand by me'],
    'The Goonies': ['the goonies', 'goonies'],
    'E.T.': ['e.t.'],
    'Close Encounters of the Third Kind': ['close encounters'],
    "Schindler's List": ["schindler's list", 'schindlers list'],
    'Crocodile Dundee': ['crocodile dundee'],
    'The Karate Kid': ['karate kid'],
    'Highlander': ['highlander'],
    'Red Dawn': ['red dawn'],
    'War of the Worlds': ['war of the worlds'],
    // Thread-specific: "boats" meme titles are handled separately
  };

  const map = new Map();
  for (const [canonical, patterns] of Object.entries(raw)) {
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
 * to count these as movie mentions: title-case, quotes, or movie-context words.
 * The isDirectAnswer flag from the call-site bypasses this guard.
 */
const AMBIGUOUS_TITLES = new Set([
  'Heat', 'Hook', 'Shane', 'Troy', 'Taken', 'Speed', 'Alien', 'Logan',
  'Contact', 'Glory', 'Casino', 'Dutch', 'Stripes', 'Willow', 'Charade',
  'Carrie', 'Tenet', 'Nobody', 'Collateral', 'Popeye', 'Rudy',
  'Maverick', 'Miracle', 'Dune', 'Fletch', 'Sahara', 'Psycho', 'Vertigo',
  'Stagecoach', 'Excalibur', 'Predator', 'Commando', 'Platoon', 'Dunkirk',
  'Ronin', 'Papillon',
  // These are distinctive enough when title-cased but too common as plain words:
  'The Firm', 'The Town', 'The Thing', 'The Birds', 'The Pacific',
  'The Raid', 'The Natural', 'The Sting',
]);

/**
 * Check if an ambiguous title is used in a movie-reference context.
 */
function isMovieContext(title, fullText) {
  const lower = fullText.toLowerCase();
  const titleLower = title.toLowerCase();

  // 1. Appears in quotes
  for (const q of ['"', '\u201c', '\u2018', "'"]) {
    const close = q === '"' ? '"' : q === '\u201c' ? '\u201d' : q === '\u2018' ? '\u2019' : "'";
    if (lower.includes(`${q}${titleLower}${close}`)) return true;
  }

  // 2. Appears in title-case in the original text (exact case match)
  const titleCaseRegex = new RegExp(`\\b${escapeRegex(title)}\\b`);
  if (titleCaseRegex.test(fullText)) return true;

  // 3. ALL CAPS version
  const upperRegex = new RegExp(`\\b${escapeRegex(title.toUpperCase())}\\b`);
  if (upperRegex.test(fullText)) return true;

  // 4. Appears near movie-related context words
  const contextWords = [
    'movie', 'film', 'watch', 'watched', 'favorite', 'favourite', 'classic',
    'rewatch', 'rewatched', 'dad movie', 'dad film', 'cinema', 'dvd', 'blu-ray',
    'theatre', 'theater', 'director', 'starring', 'cast',
    'sequel', 'trilogy', 'franchise', 'poster', 'scene',
  ];
  for (const cw of contextWords) {
    if (lower.includes(cw)) return true;
  }

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
 * Find all movie titles mentioned in a text string.
 * @param {string} text
 * @param {boolean} isDirectAnswer - If true, bypass ambiguity guards.
 * @returns {string[]} Array of canonical title strings.
 */
function findTitles(text, isDirectAnswer = false) {
  if (!text || text.trim().length === 0) return [];

  const lower = text.toLowerCase();
  const found = new Set();

  // 4a. Abbreviations (exact match via word boundary for short ones).
  for (const [abbr, canonical] of ABBREVIATIONS) {
    const abbrLower = abbr.toLowerCase();
    if (abbr.length <= 4) {
      const regex = new RegExp(`\\b${escapeRegex(abbrLower)}\\b`, 'i');
      if (regex.test(lower)) found.add(canonical);
    } else {
      if (lower.includes(abbrLower)) found.add(canonical);
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
          if (isDirectAnswer || isMovieContext(canonical, text)) {
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
  /^(oh hell yes|oh yes|oh yeah|fuck yes|hell yes|hell yeah|fuck yeah)[\s!.\u2026]*$/i,
  /^(w|dub|huge W|massive W)[\s!.\u2026]*$/i,
  /^(goated|peak|elite|banger|certified|classic)[\s!.\u2026]*$/i,
  /^(respect|valid|taste|you have taste|good taste|excellent taste|impeccable taste)[\s!.\u2026]*$/i,
  /^(underrated|so underrated|criminally underrated|highly underrated)[\s!.\u2026]*$/i,
  /^(mine too|mine as well|me too|ditto|seconded|second this)[\s!.]*$/i,
  /^(so good|so so good|it's so good|such a good)[\s!.]*$/i,
  /^(right\??|right!|correct!|true|facts|fr|fax)[\s!.]*$/i,
  /^(the best|one of the best|best movie|best film)[\s!.]*$/i,
  /^(love (this|that|it)|loved (this|that|it))[\s!.]*$/i,
  /^(banger|what a movie|what a film|peak cinema)[\s!.]*$/i,
  /^(came here to say this|came here for this|here for this)[\s!.]*$/i,
  /^(I was going to say this|was going to say this|was gonna say this)[\s!.]*$/i,
  /^(chef.?s? kiss|magnifique|perfection|perfecto)[\s!.]*$/i,
  /^(great movie|great film|amazing movie|amazing film|genuinely good movie)[\s!.\u2026]*$/i,
  /^(as is right and proper|a man of culture|a person of culture)[\s!.]*$/i,
  /^(hell of a movie|hell of a film|absolute banger)[\s!.]*$/i,
  /^(I DON'T CARE|i don't care)[\s!.]*$/i,
  // Pure emoji / punctuation
  /^[\s!?\u2764\u{1F44D}\u{1F44F}\u{1F525}\u{1F60D}\u{1F64F}\u{1F389}\u{1F3AC}\u{1F6A2}\u{2B50}\u{1F4AF}\u{1F91D}\u{1F44C}\u{1F64C}\u{2705}\u{1F3C6}\u{1F602}\u{1F923}\u{1F62D}\u{1F60E}\u{1F929}\u{1F4AA}\u{270A}\u{1F64B}\u{200D}\u{2640}\u{FE0F}\u{200D}\u{2642}\u{FE0F}\u{1F91C}\u{1F91B}\u{1F91E}]+$/u,
  // Very short (<=2 chars)
  /^.{0,2}$/,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;

  for (const pattern of REACTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Very short non-title-case text is likely a reaction
  if (trimmed.length <= 12 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 6. Meta-discussion detection
// ---------------------------------------------------------------------------

const META_PATTERNS = [
  /what (?:is|are|counts? as|qualifies? as|makes?) (?:a )?(?:dad|"dad"|"dad") movies?/i,
  /what (?:is|does) (?:a )?(?:dad|"dad") movie/i,
  /define (?:a )?(?:dad|"dad") movie/i,
  /definition of (?:a )?(?:dad|"dad") movie/i,
  /what does .?dad movie.? mean/i,
  /the concept of (?:a )?dad movie/i,
  /introducing starcounter/i,
];

function isMetaDiscussion(text) {
  const trimmed = (text || '').trim();
  for (const pattern of META_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 7. "Boats" meme
// ---------------------------------------------------------------------------

function checkBoatsMeme(text) {
  const lower = (text || '').toLowerCase();
  const titles = [];
  if (/\bold boats?\b/i.test(lower))
    titles.push('Master and Commander: The Far Side of the World');
  if (/\bunderwater boats?\b/i.test(lower))
    titles.push('The Hunt for Red October');
  if (/\bspace boats?\b/i.test(lower)) titles.push('Apollo 13');
  if (/\bsky boats?\b/i.test(lower)) titles.push('Top Gun');
  if (/\bsubmarine boats?\b/i.test(lower))
    titles.push('The Hunt for Red October');
  return titles;
}

// ---------------------------------------------------------------------------
// 8. Title refinement
// ---------------------------------------------------------------------------

function refineTitles(titles) {
  const result = [...new Set(titles)];

  // Specific overrides generic
  const overrides = [
    { generic: 'Indiana Jones', specifics: ['Indiana Jones and the Last Crusade'] },
    { generic: 'Star Trek', specifics: ['Star Trek II: The Wrath of Khan'] },
    { generic: 'Mad Max', specifics: ['Mad Max: Fury Road', 'Mad Max 2: The Road Warrior'] },
    { generic: 'Top Gun', specifics: ['Top Gun: Maverick'] },
    { generic: 'Maverick', specifics: ['Top Gun: Maverick'] },
  ];

  for (const { generic, specifics } of overrides) {
    if (result.includes(generic)) {
      for (const specific of specifics) {
        if (result.includes(specific)) {
          const idx = result.indexOf(generic);
          if (idx !== -1) result.splice(idx, 1);
          break;
        }
      }
    }
  }

  // Remove "Top Gun" if "Top Gun: Maverick" is present
  if (result.includes('Top Gun: Maverick') && result.includes('Top Gun')) {
    result.splice(result.indexOf('Top Gun'), 1);
  }
  // Remove "Maverick" if "Top Gun: Maverick" is present
  if (result.includes('Top Gun: Maverick') && result.includes('Maverick')) {
    result.splice(result.indexOf('Maverick'), 1);
  }
  // "Casino Royale" is specific; remove generic "Casino" if both present
  if (result.includes('Casino Royale') && result.includes('Casino')) {
    result.splice(result.indexOf('Casino'), 1);
  }

  return result;
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

  // Track which labels came from explicit detection vs inheritance, so we can
  // measure inheritance depth and cap it.
  // labelSource: 'explicit' | 'quoted' | 'inherited'
  /** @type {Map<string, {topics: string[], onTopic: boolean, confidence: string, note?: string, _source: string}>} */
  const labels = new Map();

  // -----------------------------------------------------------------------
  // Pass 1: Explicit title detection
  // -----------------------------------------------------------------------
  console.log('\nPass 1: Explicit title detection...');

  for (const post of posts) {
    const ownText = getOwnText(post);

    // Is this a direct answer to the root prompt?
    const isDirectAnswer =
      post.parentUri === rootUri ||
      (post.source === 'quote' &&
        (post.quotedText || '').toLowerCase().includes('favorite dad movie')) ||
      (post.source === 'quote-reply' && post.depth <= 1);

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

    // Meta-discussion.
    if (isMetaDiscussion(ownText)) {
      // Meta posts may still mention specific titles as examples.
      const metaTitles = findTitles(ownText, isDirectAnswer);
      labels.set(post.uri, {
        topics: refineTitles(metaTitles),
        onTopic: metaTitles.length > 0,
        confidence: metaTitles.length > 0 ? 'medium' : 'medium',
        note: metaTitles.length > 0
          ? 'Meta-discussion that also names specific titles'
          : 'Meta-discussion about dad movies',
        _source: 'explicit',
      });
      continue;
    }

    // Find titles in the post's own text + alt text.
    let ownTitles = findTitles(ownText, isDirectAnswer);

    // Boats meme.
    const boatTitles = checkBoatsMeme(ownText);
    if (boatTitles.length > 0) {
      ownTitles = [...new Set([...ownTitles, ...boatTitles])];
    }

    // Alt text from own images (fullText includes alt text after the post text).
    const altText = post.fullText && post.text
      ? post.fullText.substring(post.text.length)
      : '';
    if (altText.trim().length > 0) {
      const altTitles = findTitles(altText, true);
      if (altTitles.length > 0) {
        ownTitles = [...new Set([...ownTitles, ...altTitles])];
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
        confidence: 'high',
        note: undefined,
        _source: 'explicit',
      });
    } else if (quotedTitles.length > 0) {
      // Post quotes another post that mentions movies.
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
        // Has own text. If it's movie-related, inherit the quoted titles.
        const lower = ownTrimmed.toLowerCase();
        const movieRelated =
          /movie|film|watch|favor|dad|classic|love[ds]?\b|great\b|best\b|awesome|amazing|perfect|peak|underrated|overrated|rewatch/i.test(lower);
        if (movieRelated) {
          labels.set(post.uri, {
            topics: quotedTitles,
            onTopic: true,
            confidence: 'medium',
            note: 'Discusses quoted movie(s)',
            _source: 'quoted',
          });
        } else {
          // Unclear relationship to quoted content. Still on-topic (it's
          // a quote-post in a movie thread) but low confidence.
          labels.set(post.uri, {
            topics: quotedTitles,
            onTopic: true,
            confidence: 'low',
            note: 'Quotes a movie post but own text unclear',
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

  /**
   * Compute how many hops from the nearest explicit (non-inherited) label.
   * Returns 0 for explicit labels, 1+ for inherited ones.
   */
  function inheritanceDepth(uri) {
    const label = labels.get(uri);
    if (!label) return Infinity;
    if (label._source === 'explicit' || label._source === 'quoted') return 0;
    const post = postByUri.get(uri);
    if (!post || !post.parentUri) return 1;
    return 1 + inheritanceDepth(post.parentUri);
  }

  // Single pass: inherit from labeled parents (reactions and short discussions).
  // We do multiple rounds but cap inheritance depth.
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

      // Check depth: how far is the parent from an explicit label?
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

      // Short-ish post (~120 chars) discussing the parent's movie without
      // naming it. Only inherit at depth 0 (direct child of explicit label).
      if (parentDepth === 0 && ownText.length <= 200) {
        const lower = ownText.toLowerCase();
        const discussingParent =
          /movie|film|watch|watched|love[ds]?\b|great\b|classic|favor|best\b|awesome|amazing|perfect|peak|underrated|overrated|scene|character|actor|actress|director|role|performance|sequel|rewatch/i.test(lower) ||
          /\b(it|that|this one|that one|that movie|this movie|that film|this film|my dad)\b/i.test(lower);

        if (discussingParent) {
          labels.set(post.uri, {
            topics: parentLabel.topics,
            onTopic: true,
            confidence: 'low',
            note: 'Discusses parent movie without naming it',
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
      // Check if it quotes something with a title.
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
            note: 'Empty post quoting a movie mention',
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

    // Try one more time with aggressive matching on full text (own + quoted + alt).
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

    // Check image alt text for title-case movie names not in our list.
    if (post.hasImages) {
      const altPart =
        post.fullText && post.text
          ? post.fullText.substring(post.text.length)
          : '';
      if (altPart.trim()) {
        const altBlocks = altPart.match(/\[image alt:\s*([^\]]+)\]/gi) || [];
        let foundInAlt = false;
        for (const block of altBlocks) {
          const altContent = block.replace(/\[image alt:\s*/i, '').replace(/\]$/, '').trim();
          const titles = findTitles(altContent, true);
          if (titles.length > 0) {
            labels.set(post.uri, {
              topics: refineTitles(titles),
              onTopic: true,
              confidence: 'medium',
              note: 'Title found in image alt text',
              _source: 'explicit',
            });
            foundInAlt = true;
            break;
          }
        }
        if (foundInAlt) continue;
      }
    }

    // Truly unmatched. Determine if on-topic (trying to answer) or off-topic.
    const lower = ownText.toLowerCase();
    const seemsLikeAnswer =
      post.parentUri === rootUri ||
      (post.source === 'quote' &&
        (post.quotedText || '').toLowerCase().includes('favorite dad movie')) ||
      /my (?:dad|father|pop|old man).{0,30}(?:movie|film|watch|love)/i.test(lower) ||
      /(?:movie|film) (?:is|was|would be|has to be)/i.test(lower);

    if (seemsLikeAnswer) {
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'Appears to answer the prompt but title not recognized',
        _source: 'explicit',
      });
    } else {
      labels.set(post.uri, {
        topics: [],
        onTopic: false,
        confidence: 'low',
        note: 'No title match found',
        _source: 'explicit',
      });
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
      fixtureFile: 'dad-movies.json',
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

  console.log('\nTop 50 titles by mention count:');
  console.log('  ' + '-'.repeat(62));
  sortedTitles.slice(0, 50).forEach(([title, count], i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${title.padEnd(52)} ${String(count).padStart(4)}`);
  });

  console.log(`\n  ... and ${Math.max(0, sortedTitles.length - 50)} more titles.`);

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
