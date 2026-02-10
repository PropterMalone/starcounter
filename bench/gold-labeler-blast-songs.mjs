/**
 * Gold-standard labeler for the blast-songs benchmark fixture.
 *
 * Reads bench/fixtures/blast-songs.json + blast-songs-url-titles.json,
 * determines which song(s) each post references, and writes
 * bench/labels/blast-songs-gold.json.
 *
 * Three-pass approach:
 *   1. Explicit title detection (text patterns + URL title cache).
 *   2. Context inheritance from parent posts.
 *   3. Fallback labeling for remaining posts.
 *
 * Canonical format: "Song Title - Artist" (couples song and artist to prevent
 * artist names from being confused with song titles in benchmarks).
 *
 * Usage:  node bench/gold-labeler-blast-songs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'blast-songs.json');
const URL_TITLES_PATH = join(__dirname, 'fixtures', 'blast-songs-url-titles.json');
const OUTPUT_DIR = join(__dirname, 'labels');
const OUTPUT_PATH = join(OUTPUT_DIR, 'blast-songs-gold.json');

const MAX_INHERITANCE_DEPTH = 2;

// ---------------------------------------------------------------------------
// 1. Title dictionary
// ---------------------------------------------------------------------------

const TITLE_PATTERNS = buildTitlePatterns();

function buildTitlePatterns() {
  const raw = {
    // ---- Top mentions (40+) ----
    'Celebration - Kool & the Gang': [
      'celebration by kool',
      '"celebrate" by kool',
      'celebrate by kool',
      'kool & the gang',
      'kool and the gang',
      'kool & gang',
      'kool and gang',
      'kool and gang',
      'celebrate good times',
      'ceeeeelebrate',
      'ceeeelebrate',
      'ceeelebrate',
      'ceelebrate',
      'celebrate good',
      '"celebration"',
      '\u201ccelebration\u201d',
      '"celebrate"',
      '\u201ccelebrate\u201d',
      'celebration',
      'celebrate',
    ],

    // ---- Top mentions (20-40) ----
    'Yub Nub - Star Wars': [
      'yub nub',
      'yub. nub',
      'ewok celebration',
      'ewok song',
      'ewok finale',
      'the ewok',
    ],
    'Ding Dong the Witch Is Dead - Wizard of Oz': [
      'ding dong the witch',
      'ding-dong, the witch',
      'ding dong, the witch',
      'ding dong!',
      'ding dong',
    ],

    // ---- Top mentions (10-20) ----
    'FDT - YG & Nipsey Hussle': [
      'fuck donald trump',
      'f**k donald trump',
      'f*ck donald trump',
      'fdt',
    ],
    'Party in the USA - Miley Cyrus': [
      'party in the usa',
      'party in the u.s.a',
      'party in the u.s.a.',
    ],

    // ---- Frequently mentioned (5-10) ----
    'Dancing in the Street - Martha & the Vandellas': [
      'dancing in the street',
      'dancing in the streets',
    ],
    'Walking on Sunshine - Katrina & the Waves': [
      'walking on sunshine',
      "i'm walking on sunshine",
    ],
    'YMCA - Village People': ['ymca', 'y.m.c.a', 'y. m. c. a'],
    'Happy Days Are Here Again - Various': [
      'happy days are here again',
      'happy days are here',
    ],
    'Beautiful Day - U2': ['beautiful day'],
    'Another One Bites the Dust - Queen': [
      'another one bites the dust',
    ],
    'Feeling Good - Nina Simone': [
      'feeling good',
      "feelin' good",
      "feelin\u2019 good",
      'birds flying high',
    ],
    'At Last - Etta James': ['at last'],
    'Tramp the Dirt Down - Elvis Costello': [
      'tramp the dirt down',
      'tamp the dirt down',
    ],
    'Here Comes the Sun - The Beatles': [
      'here comes the sun',
    ],
    'Not Like Us - Kendrick Lamar': ['not like us'],
    'Battle Hymn of the Republic - Traditional': [
      'battle hymn of the republic',
    ],

    // ---- Mentioned 3-5 times ----
    'Hallelujah Chorus - Handel': [
      'hallelujah chorus',
      "handel's messiah",
      "hallelujah from handel",
    ],
    'Hallelujah - Leonard Cohen / Jeff Buckley': [
      'hallelujah by jeff buckley',
      'hallelujah by leonard cohen',
      'hallelujah - kate mckinnon',
      'hallelujah - kate',
    ],
    'Funeralopolis - Electric Wizard': [
      'funeralopolis',
      'electric wizard',
    ],
    "Don't Stop Me Now - Queen": [
      "don't stop me now",
      'dont stop me now',
    ],
    'We Are the Champions - Queen': [
      'we are the champions',
    ],
    'September - Earth, Wind & Fire': [
      'september by earth',
      'september',
    ],
    'Freedom - Beyonce': [
      'freedom by beyonce',
      'freedom by beyoncé',
    ],
    'Na Na Hey Hey Kiss Him Goodbye - Steam': [
      'nah nah nah nah',
      'na na hey hey',
      'na na na na hey hey goodbye',
      'na, na, na, na',
      'nah nah nah',
      'hey hey hey goodbye',
      'kiss him goodbye',
    ],
    'Party Rock Anthem - LMFAO': [
      'party rock anthem',
      'party rock',
    ],
    'Jump Around - House of Pain': ['jump around'],
    'Ode to Joy - Beethoven': [
      'ode to joy',
      "beethoven's 9th",
      "beethoven's ninth",
      'beethoven 9',
    ],
    'The Day the Nazi Died - Chumbawamba': [
      'the day the nazi died',
      'day the nazi died',
      'day the n—i died',
      'day the n---i died',
    ],
    'Turn Down for What - DJ Snake & Lil Jon': [
      'turn down for what',
    ],
    'Hit Em Up - 2Pac': [
      "hit 'em up",
      'hit em up',
    ],
    'Brand New Day - The Wiz': [
      'brand new day from the wiz',
      'brand new day',
    ],
    "Let's Go Crazy - Prince": [
      "let's go crazy",
      'lets go crazy',
    ],
    'About Damn Time - Lizzo': [
      'about damn time',
    ],
    "Boys Are Back in Town - Thin Lizzy": [
      'boys are back in town',
    ],
    'The Big Payback - James Brown': [
      'the big payback',
      'big payback',
    ],
    'Highway to Hell - AC/DC': [
      'highway to hell',
    ],
    'Born to Run - Bruce Springsteen': [
      'born to run',
    ],
    'Tubthumping - Chumbawamba': [
      'tubthumping',
      'chumbawumba',
      'chumbawamba',
    ],

    // ---- Mentioned 2-3 times ----
    'See You Later Fuckface - The Queers': [
      'see you later fuckface',
      'see ya later fuckface',
    ],
    'Oh Happy Day - Edwin Hawkins Singers': [
      'oh happy day',
    ],
    'We Like to Party - Vengaboys': [
      'we like to party',
      'vengabus',
      'vengaboys',
    ],
    'Go to Hell - Nina Simone': [
      'go to hell',
    ],
    'Rise Above - Black Flag': [
      'rise above by black flag',
      'rise above',
    ],
    "Everyone's a Winner - Hot Chocolate": [
      "everyone's a winner",
      'everyones a winner',
    ],
    'Dead Man\'s Party - Oingo Boingo': [
      "dead man's party",
      'dead mans party',
      'oingo boingo',
    ],
    'Sinnerman - Nina Simone': ['sinnerman'],
    "Ain't No Stoppin' Us Now - McFadden & Whitehead": [
      "ain't no stoppin",
      "ain't no stopping us",
      'aint no stopping us',
    ],
    'Ha Ha You\'re Dead - Green Day': [
      "ha ha you're dead",
      'ha ha youre dead',
      'ha ha your dead',
    ],
    'All I Do Is Win - DJ Khaled': [
      'all i do is win',
    ],
    'Sleep Now in the Fire - Rage Against the Machine': [
      'sleep now in the fire',
    ],
    'Freedom 90 - George Michael': [
      'freedom 90',
    ],
    'Mr. Blue Sky - ELO': [
      'mr. blue sky',
      'mr blue sky',
    ],
    'I Know the End - Phoebe Bridgers': [
      'i know the end',
    ],
    "God's Gonna Cut You Down - Johnny Cash": [
      "god's gonna cut you down",
      'gods gonna cut you down',
    ],
    'Fortunate Son - Creedence Clearwater Revival': [
      'fortunate son',
    ],
    'American Idiot - Green Day': [
      'american idiot',
    ],
    'Gasolina - Daddy Yankee': ['gasolina'],
    'Bye Bye Bye - NSYNC': ['bye bye bye'],
    'The Guillotine - The Coup': [
      'the guillotine',
    ],
    'I Believe in a Thing Called Love - The Darkness': [
      'i believe in a thing called love',
      'thing called love',
    ],
    'This Land Is Your Land - Woody Guthrie': [
      'this land is your land',
    ],
    "Killin' in the Name - Rage Against the Machine": [
      'killing in the name',
      "killin' in the name",
      'killin in the name',
    ],
    'Nazi Punks Fuck Off - Dead Kennedys': [
      'nazi punks fuck off',
      'nazi punks',
    ],
    'Signed Sealed Delivered - Stevie Wonder': [
      'signed sealed delivered',
      'signed, sealed, delivered',
    ],
    'Fight the Power - Public Enemy': [
      'fight the power',
    ],
    'Crab Rave - Noisestorm': [
      'crab rave',
      'noisestorm',
    ],
    'You Get What You Give - New Radicals': [
      'you get what you give',
    ],
    'Africa - Toto': [
      '"africa" by toto',
      'africa by toto',
    ],
    'Bang the Drum All Day - Todd Rundgren': [
      'bang the drum all day',
      'bang the drum',
    ],
    'Land of Hope and Dreams - Bruce Springsteen': [
      'land of hope and dreams',
    ],
    'Piss on Your Grave - The Coup': [
      'piss on your grave',
    ],
    'Best Day of My Life - American Authors': [
      'best day of my life',
    ],
    "Let's Get Loud - Jennifer Lopez": [
      "let's get loud",
      'lets get loud',
    ],
    'Revolution - The Beatles': [
      'revolution by the beatles',
    ],
    "Whoomp! (There It Is) - Tag Team": [
      'whoomp there it is',
      'whoomp! there it is',
      'whoomp',
    ],
    'Hamster Dance - Hampton the Hamster': [
      'hamster dance',
      'hampster dance',
    ],
    'Dopesmoker - Sleep': [
      'dopesmoker',
      'sleep dopesmoker',
    ],
    'It\'s the End of the World as We Know It - R.E.M.': [
      "it's the end of the world",
      'end of the world as we know it',
    ],
    "We're Not Gonna Take It - Twisted Sister": [
      "we're not gonna take it",
      'were not gonna take it',
    ],
    'La Marseillaise - French National Anthem': [
      'la marseillaise',
      'marseillaise',
    ],

    // ---- Single mentions (identified from sampling) ----
    'Witch Hunt - Misfits': ['witch hunt - misfits', 'witch hunt by misfits'],
    'When Will You Die - They Might Be Giants': [
      'when will you die',
    ],
    'Can You Feel It - Jackson 5': [
      'can you feel it',
    ],
    'Jesus Children of America - Stevie Wonder': [
      'jesus children of america',
    ],
    'Shout - Tears for Fears': [
      "shout, tears for fears",
      "'shout,' tears for fears",
      "shout by tears for fears",
    ],
    'Born to Be Alive - Patrick Hernandez': [
      'born to be alive',
    ],
    'Problem - Ariana Grande': [
      'problem -ariana grande',
      'problem by ariana grande',
    ],
    'Kaya - Bob Marley': [
      'kaya - bob marley',
      'kaya by bob marley',
    ],
    'The Cup of Life - Ricky Martin': [
      'the cup of life',
      'cup of life',
    ],
    'Alter Ego - Doechii': [
      'alter ego',
    ],
    "Let the Sunshine In - The 5th Dimension": [
      'let the sun shine in',
      'let the sunshine in',
    ],
    'Gonna Be a Beautiful Night - Prince': [
      'gonna be a beautiful night',
    ],
    'Better Things - Fountains of Wayne / The Kinks': [
      'better things',
    ],
    'Dragula - Rob Zombie': ['dragula'],
    "Having a Party - Sam Cooke": [
      'having a party',
    ],
    'Roadrunner - Modern Lovers': [
      'roadrunner',
    ],
    'Tequila - The Champs': ['tequila'],
    'Sweet Freedom - Michael McDonald': [
      'sweet freedom',
    ],
    "Poppin' My Collar - Three 6 Mafia": [
      "poppin' my collar",
      'poppin my collar',
    ],
    'California Love - 2Pac': [
      'california love',
    ],
    'Holiday - Turnstile': [
      '"holiday" by turnstile',
      'holiday by turnstile',
      'turnstile',
    ],
    'Song 2 - Blur': [
      'song 2',
    ],
    'O Fortuna - Apotheosis': [
      'o fortuna',
    ],
    'Curb Your Enthusiasm Theme - Luciano Michelini': [
      'curb your enthusiasm',
    ],
    'Leash - Pearl Jam': [
      'leash by pearl jam',
    ],
    'Violet - Hole': [
      'violet',
    ],
    'A Great Day for Freedom - Pink Floyd': [
      'a great day for freedom',
      'great day for freedom',
    ],
    'Triumph - Wu-Tang Clan': [
      'wu tang, triumph',
      'wu-tang, triumph',
    ],
    'Wipe Out - Surfaris': ['wipe out'],
    'Head Like a Hole - Nine Inch Nails': [
      'head like a hole',
    ],
    'Bodies - Drowning Pool': [
      'drowning pool',
      'bodies',
    ],
    'Fugazi - Waiting Room': [
      'fugazi - waiting room',
      'waiting room',
    ],
    'Seven Nation Army - White Stripes': [
      'seven nation army',
    ],
    'CPR - CupcakKe': [
      'cpr by cupcakke',
    ],
    'Tiny Dancer - Elton John': [
      'tiny dancer',
    ],
    'Kernkraft 400 - Zombie Nation': [
      'kernkraft 400',
      'zombie nation',
    ],
    'Go West - Pet Shop Boys': [
      'go west',
    ],
    'Ante Up - M.O.P.': [
      'ante up',
    ],
    'Temperature - Sean Paul': [
      'temperature',
    ],
    'Danza Kuduro - Don Omar': [
      'danza kuduro',
    ],
    'Gravel Pit - Wu-Tang Clan': [
      'gravel pit',
    ],
    'Smooth - Santana & Rob Thomas': [
      'smooth by santana',
    ],
    'Fuck the Pain Away - Peaches': [
      'fuck the pain away',
    ],
    'All You Fascists Bound to Lose - Woody Guthrie': [
      'all you fascists',
      'fascists bound to lose',
    ],
    'Don\'t Stop Believin\' - Journey': [
      "don't stop believin",
      'dont stop believin',
    ],
    'Higher Ground - Stevie Wonder': [
      'higher ground',
    ],
    'Uptown Girl - Billy Joel': [
      'uptown girl',
    ],
    'The Hero - Queen': [
      '"the hero" by queen',
      'the hero from flash gordon',
    ],
    'Small Axe - The Wailers': [
      'small axe',
      'the wailers - small axe',
    ],
    'Bagbak - Vince Staples': [
      'bagbak',
    ],
    'Cheeseburger in Paradise - Jimmy Buffett': [
      'cheeseburger in paradise',
    ],
    'When That Man Is Dead and Gone - Various': [
      'when that man is dead and gone',
    ],
    'Light of a Clear Blue Morning - Dolly Parton': [
      'light of a clear blue morning',
    ],
    "Don't Stop - Ke$ha": [
      "don't stop by ke$ha",
      "don't stop by kesha",
      'ke$ha',
    ],
    'Despacito - Luis Fonsi': ['despacito'],
    'Fade Into You - Mazzy Star': [
      'fade into you',
    ],
    'Good Times - Chic': [
      '"good times"',
      'good times',
    ],
    'Party Hard - Andrew W.K.': [
      'party hard',
      'andrew wk',
      'andrew w.k.',
    ],
    'Ooh La La - Run the Jewels': [
      'ooh la la',
    ],
    "Pony - Ginuwine": [
      'pony',
    ],
    'Be Prepared - Jeremy Irons / Lion King': [
      'be prepared',
    ],
    'The Battle Cry of Freedom - Traditional': [
      'battle cry of freedom',
    ],
    'When the Saints Go Marching In - Traditional': [
      'when the saints go marching',
      'saints go marching in',
    ],
    'Satisfaction - The Rolling Stones': [
      'satisfaction',
    ],
    "No One Mourns the Wicked - Wicked": [
      'no one mourns the wicked',
    ],
    "Motorhead - Dancing on Your Grave": [
      'dancing on your grave',
    ],
    'Angel of Death - Slayer': [
      'angel of death',
    ],
    'Stench from the Dumpster - Cattle Decapitation': [
      'stench from the dumpster',
    ],
    'Room Where It Happens - Hamilton': [
      'room where it happens',
    ],
    'Prisencolinensinainciusol - Adriano Celentano': [
      'prisencolinensinainciusol',
    ],
    'Thank You Very Much - Scaffold': [
      'thank you very much',
    ],
    'O Death - Jen Titus': [
      'o death',
    ],
    "Baker Street - Gerry Rafferty": [
      'baker street',
    ],
    'Percolator - Cajmere': [
      'percolator',
    ],
    'Free Bird - Lynyrd Skynyrd': [
      'free bird',
      'freebird',
    ],
    'Best Day Ever - SpongeBob': [
      'spongebob best day ever',
      'best day ever',
    ],
    'Faneto - Chief Keef': [
      'faneto',
    ],
    'Final Fantasy IX Victory Fanfare': [
      'final fantasy',
      'victory fanfare',
    ],
    "Run On - Moby": [
      "moby's run on",
      'run on',
    ],
    'Rubberhead - Butthole Surfers': [
      'rubberhead',
    ],
    'Me and Giuliani Down by the Schoolyard - Various': [
      'me and giuliani',
      'giuliani down by the schoolyard',
    ],
    "L'Internationale - Traditional": [
      "l'internationale",
      'internationale',
    ],
    'On the Day It Finally Happens - Malort & Savior': [
      'on the day it finally happens',
      'malort & savior',
      'malört & savior',
    ],
    'Sunshine Electric Raindrops - Steve Vai': [
      'sunshine electric raindrops',
    ],
    'Arto - System of a Down': [
      'arto by system',
    ],
    'Electric Wizard - We Hate You': [
      'we hate you',
    ],
    'I\'ve Been So Mad Lately - Butt Trumpet': [
      "i've been so mad lately",
    ],
    'The Emperor in His War Room - Van der Graaf Generator': [
      'emperor in his war room',
    ],
    'Luchini - Camp Lo': [
      'luchini',
    ],
    'The Great Storm Is Over - Bob Franke': [
      'the great storm is over',
    ],
    'Ghostbusters Theme - Ray Parker Jr.': [
      'ghostbusters',
    ],
    'Swan Lake - Tchaikovsky': [
      'swan lake',
    ],
    'Abbey Road - The Beatles': [
      'abbey road',
    ],
    "Can't Hardly Wait - The Replacements": [
      "can't hardly wait",
      'cant hardly wait',
    ],
    'Independent Women - Destiny\'s Child': [
      'independent ladies',
    ],
    "Ain't It Fun - Paramore": [
      "ain't it fun",
      'aint it fun',
    ],
    'You Can\'t Bring Me Down - Suicidal Tendencies': [
      "you can't bring me down",
      'you cant bring me down',
    ],
    'Party Party Party - Andrew W.K.': [
      'party party party',
    ],
    'Leash - Pearl Jam (duplicate)': [],
    'Handshake Drugs - Wilco': [
      'handshake drugs',
    ],
    'Ravel\'s Bolero - Maurice Ravel': [
      "ravel's bolero",
      "maurice ravel's bolero",
      'bolero',
    ],
    'God Is Real - Various': [
      'yes, god is real',
      'god is real',
    ],
    'Stick \'Em - Prodigy': [
      "stick 'em",
    ],
    'Now We Can See - The Thermals': [
      'now we can see',
    ],
    'Choke - Antigone Rising': [
      'choke by antigone',
    ],
    'You Will Remember Tonight - Andrew W.K.': [
      'you will remember tonight',
    ],
    "We Like to Party - Vengaboys (duplicate)": [],
    "F.U. Song - Reel Big Fish": [
      'reel big fish f.u.',
    ],
    'Run the Length - Kathe Green': [],
    'Unwritten - Natasha Bedingfield': [
      'unwritten',
    ],
    'The Hell of It - Paul Williams': [
      'the hell of it by paul williams',
      'the hell of it - paul williams',
      '"the hell of it"',
      '\u201cthe hell of it\u201d',
    ],
    "Fuck You - Lily Allen": [
      'f**k you by lily allen',
      'f**k you very much',
      'f*ck you very much',
      'fuck you very much',
      'fuck you by lily allen',
      'fuck you by lily',
      'f*** you',
      'lily allen',
    ],
    'My Way - Nina Hagen': [
      'nina hagen',
    ],
    'Party All Over the World - ELO': [
      'party all over the world',
    ],
    'Juicy Wiggle - Redfoo': [
      'juicy wiggle',
    ],
    'Chin High - Roots Manuva': [
      'chin high',
    ],
    'Berlin Nightmare - Various': [
      'berlin nightmare',
    ],
    "It's a Beautiful Day - Various": [
      "it's a beautiful day",
    ],
    'Johnny Strikes Up the Band - Warren Zevon': [
      'johnny strikes up the band',
    ],
    'Dives and Lazarus - June Tabor and Oysterband': [
      'dives and lazarus',
    ],
    'Shine On You Crazy Diamond - Pink Floyd': [
      'shine on you crazy diamond',
    ],
    'TSOP (The Sound of Philadelphia) - MFSB': [
      'the sound of philadelphia',
      'tsop',
    ],
    'Blood Rave - Blade': [
      'blood shower song from blade',
      'blood rave',
    ],
    'I Can See Clearly Now - Johnny Nash': [
      'i can see clearly now',
    ],
    'All Night Long - Lionel Richie': [
      'all night long',
    ],
    'Lovely Day - Bill Withers': [
      'lovely day',
    ],
    'Heads Will Roll - Yeah Yeah Yeahs': [
      'heads will roll',
    ],
    'Streams of Whiskey - The Pogues': [
      'streams of whiskey',
    ],
    'FUCK YOU - CeeLo Green': [
      'ceelo green',
      'cee lo green',
    ],
    'The Final Countdown - Europe': [
      'the final countdown',
      'final countdown',
    ],
    'Hey Man, Nice Shot - Filter': [
      'hey man, nice shot',
      'hey man nice shot',
    ],
    "Scotty Doesn't Know - Lustra": [
      "scotty doesn't know",
      'scotty doesnt know',
    ],
    'Goodbye My Dictator - Michelle Gurevich': [
      'goodbye my dictator',
    ],
    "I'll Be Glad When You're Dead You Rascal You - Louis Armstrong": [
      "i'll be glad when you're dead",
      'you rascal you',
    ],
    'Perfect Day - Hoku': [
      'perfect day by hoku',
      'perfect day',
    ],
    'Xanadu / All Over the World - ELO': [
      'all over the world',
      'xanadu',
    ],
    'Politicians in My Eyes - Death': [
      'politicians in my eyes',
    ],
    'Die Mother Fucker Die - Dope': [
      'die mother fucker die',
    ],
    'Everything\'s Coming Our Way - Santana': [
      "everything's coming our way",
    ],
    'Soul Bossa Nova - Quincy Jones': [
      'soul bossa nova',
    ],
    'Les Toreadors - Bizet': [
      'les toreadors',
    ],
    'Ave Maria - Schubert': [
      'ave maria',
    ],
    'Stomp! - Brothers Johnson': [
      'stomp',
    ],
    'Freedom of Naboo - Star Wars': [
      'freedom of naboo',
    ],
  };

  const map = new Map();
  for (const [canonical, patterns] of Object.entries(raw)) {
    if (patterns.length === 0) continue;
    const deduped = [...new Set(patterns.map((p) => p.toLowerCase()))].sort(
      (a, b) => b.length - a.length
    );
    map.set(canonical, deduped);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 2. Artist shorthand
// ---------------------------------------------------------------------------

/**
 * Maps bare artist mentions → canonical song, ONLY when there's one obvious
 * song for that artist in this thread context.
 */
const ARTIST_SHORTHAND = new Map([
  ['kool and the gang', 'Celebration - Kool & the Gang'],
  ['kool & the gang', 'Celebration - Kool & the Gang'],
  ['kool and gang', 'Celebration - Kool & the Gang'],
  ['kool & gang', 'Celebration - Kool & the Gang'],
  ['miley cyrus', 'Party in the USA - Miley Cyrus'],
  ['miley', 'Party in the USA - Miley Cyrus'],
  ['elvis costello', 'Tramp the Dirt Down - Elvis Costello'],
  ['lizzo', 'About Damn Time - Lizzo'],
  ['kendrick', 'Not Like Us - Kendrick Lamar'],
  ['kendrick lamar', 'Not Like Us - Kendrick Lamar'],
  ['thin lizzy', "Boys Are Back in Town - Thin Lizzy"],
  ['lmfao', 'Party Rock Anthem - LMFAO'],
  ['katrina & the waves', 'Walking on Sunshine - Katrina & the Waves'],
  ['katrina and the waves', 'Walking on Sunshine - Katrina & the Waves'],
  ['village people', 'YMCA - Village People'],
  ['phoebe bridgers', 'I Know the End - Phoebe Bridgers'],
  ['dolly parton', 'Light of a Clear Blue Morning - Dolly Parton'],
  ['run the jewels', 'Ooh La La - Run the Jewels'],
  ['rtj', 'Ooh La La - Run the Jewels'],
  ['jimmy buffett', 'Cheeseburger in Paradise - Jimmy Buffett'],
  ['green day', 'American Idiot - Green Day'],
  ['rage against the machine', 'Sleep Now in the Fire - Rage Against the Machine'],
  ['natasha bedingfield', 'Unwritten - Natasha Bedingfield'],
  ['todd rundgren', 'Bang the Drum All Day - Todd Rundgren'],
  ['woody guthrie', 'This Land Is Your Land - Woody Guthrie'],
  ['james brown', 'The Big Payback - James Brown'],
  ['house of pain', 'Jump Around - House of Pain'],
  ['earth wind & fire', 'September - Earth, Wind & Fire'],
  ['earth, wind & fire', 'September - Earth, Wind & Fire'],
  ['earth wind and fire', 'September - Earth, Wind & Fire'],
  ['earth, wind and fire', 'September - Earth, Wind & Fire'],
]);

// ---------------------------------------------------------------------------
// 3. Ambiguous titles
// ---------------------------------------------------------------------------

const AMBIGUOUS_TITLES = new Set([
  'Celebration - Kool & the Gang', // "celebration" is extremely common in this context
  'Beautiful Day - U2',
  'Feeling Good - Nina Simone',
  'At Last - Etta James',
  'Good Times - Chic',
  'Rise Above - Black Flag',
  'Bodies - Drowning Pool',
  'Satisfaction - The Rolling Stones',
  'September - Earth, Wind & Fire',
  'Violet - Hole',
  'Be Prepared - Jeremy Irons / Lion King',
  'Go to Hell - Nina Simone',
  'Temperature - Sean Paul',
  'Roadrunner - Modern Lovers',
  'Pony - Ginuwine',
  'Holiday - Turnstile',
  'Better Things - Fountains of Wayne / The Kinks',
  'Wipe Out - Surfaris',
  'Run On - Moby',
  'Unwritten - Natasha Bedingfield',
  'Go West - Pet Shop Boys',
  'Higher Ground - Stevie Wonder',
  "Baker Street - Gerry Rafferty",
  "Ravel's Bolero - Maurice Ravel",
  'Uptown Girl - Billy Joel',
  'Thank You Very Much - Scaffold', // "thank you very much" is common English
  'God Is Real - Various',
  'Ghostbusters Theme - Ray Parker Jr.',
  "It's a Beautiful Day - Various",
  'Percolator - Cajmere',
  'Best Day Ever - SpongeBob',
  "Ain't It Fun - Paramore",
  'Brand New Day - The Wiz', // "brand new day" is common English
  'Ha Ha You\'re Dead - Green Day', // "ha ha" is common
  'Crab Rave - Noisestorm', // "crab" emoji/meme reference
  'Witch Hunt - Misfits', // "witch hunt" is common in political context
  'The Hell of It - Paul Williams', // "the hell of it" is common English
  'Despacito - Luis Fonsi', // short, could be casual mention
  'Can You Feel It - Jackson 5', // "can you feel it" is common
  'Alter Ego - Doechii', // "alter ego" is common
  'Song 2 - Blur', // "song" appears in every other post
  'O Death - Jen Titus', // too short
  'Ante Up - M.O.P.', // too short
  'Dragula - Rob Zombie',
  "Having a Party - Sam Cooke", // "having a party" is common
  'On the Day It Finally Happens - Malort & Savior', // "it finally happens" echoes the prompt
  'When That Man Is Dead and Gone - Various', // can match non-song references
  'Lovely Day - Bill Withers', // "lovely day" is common
  'All Night Long - Lionel Richie', // "all night long" is common
  'Perfect Day - Hoku', // "perfect day" is common
  'Stomp! - Brothers Johnson', // "stomp" is common
  'Ave Maria - Schubert', // religious, could be non-song
]);

/**
 * Music-context words for this thread (songs/blast/celebration).
 */
const MUSIC_CONTEXT_WORDS = [
  'song', 'play ', 'blast', 'playlist', 'listen', 'queue',
  'music', 'album', 'band ', 'banger', 'anthem', 'track',
  'volume', 'speakers', 'blasting', 'loop', 'repeat',
  'gonna blast', 'first song', 'on repeat',
];

function isMusicContext(title, fullText) {
  const lower = normalizeQuotes(fullText.toLowerCase());

  // 1. Title-case match in original text
  const titleWords = title.split(' - ')[0];
  const titleCaseRegex = new RegExp(`\\b${escapeRegex(titleWords)}\\b`);
  if (titleCaseRegex.test(fullText)) return true;

  // 2. In quotes
  if (lower.includes(`"${titleWords.toLowerCase()}"`) ||
      lower.includes(`\u201c${titleWords.toLowerCase()}\u201d`)) return true;

  // 3. Music context words
  for (const cw of MUSIC_CONTEXT_WORDS) {
    if (lower.includes(cw)) return true;
  }

  // 4. Numbered list
  if (/^\s*\d[.)]\s/m.test(fullText)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchableText(post, urlTitles) {
  const parts = [];
  if (post.fullText) parts.push(post.fullText);
  else if (post.text) parts.push(post.text);
  if (post.quotedText) parts.push(post.quotedText);
  if (post.quotedAltText && Array.isArray(post.quotedAltText)) {
    parts.push(post.quotedAltText.join(' '));
  }
  // Append URL title info if available
  const urlEntry = urlTitles[post.uri];
  if (urlEntry) {
    if (urlEntry.parsedSong) parts.push(urlEntry.parsedSong);
    if (urlEntry.parsedArtist) parts.push(urlEntry.parsedArtist);
    if (urlEntry.videoTitle) parts.push(urlEntry.videoTitle);
  }
  return parts.join('\n');
}

function getOwnText(post, urlTitles) {
  const parts = [];
  if (post.fullText) parts.push(post.fullText);
  else if (post.text) parts.push(post.text);
  // Include URL title for own text too
  const urlEntry = urlTitles[post.uri];
  if (urlEntry) {
    if (urlEntry.parsedSong) parts.push(urlEntry.parsedSong);
    if (urlEntry.parsedArtist) parts.push(urlEntry.parsedArtist);
    if (urlEntry.videoTitle) parts.push(urlEntry.videoTitle);
  }
  return parts.join('\n');
}

function getPlainOwnText(post) {
  if (post.fullText) return post.fullText;
  if (post.text) return post.text;
  return '';
}

// ---------------------------------------------------------------------------
// 5. Title matching
// ---------------------------------------------------------------------------

function normalizeQuotes(str) {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

function findTitles(text, isDirectAnswer = false) {
  if (!text || text.trim().length === 0) return [];

  const lower = normalizeQuotes(text.toLowerCase());
  const found = new Set();

  // 5a. Artist shorthand (only for direct answers or music-context posts)
  for (const [shorthand, canonical] of ARTIST_SHORTHAND) {
    if (shorthand.length <= 4) {
      const regex = new RegExp(`\\b${escapeRegex(shorthand)}\\b`, 'i');
      if (regex.test(lower)) {
        if (isDirectAnswer || isMusicContext(canonical, text)) {
          found.add(canonical);
        }
      }
    } else {
      if (lower.includes(shorthand)) {
        found.add(canonical);
      }
    }
  }

  // 5b. Primary title patterns
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
          if (isDirectAnswer || isMusicContext(canonical, text)) {
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
// 6. Reaction / agreement detection
// ---------------------------------------------------------------------------

const REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|ya|yea|yass|yasss)[\s!.\u2026]*$/i,
  /^(this|this one|this is it|this is the one|this is the way)[\s!.\u2026]*$/i,
  /^(same|same here|me too|mine too|same same)[\s!.\u2026]*$/i,
  /^(great choice|good choice|excellent choice|good pick|great pick|nice pick|solid choice|solid pick)[\s!.\u2026]*$/i,
  /^(absolutely|exactly|correct|100%|1000%)[\s!.\u2026]*$/i,
  /^(based|so based|incredibly based)[\s!.\u2026]*$/i,
  /^(oh hell yes|oh yes|oh yeah|hell yes|hell yeah)[\s!.\u2026]*$/i,
  /^(w|dub|huge W|massive W)[\s!.\u2026]*$/i,
  /^(goated|peak|elite|banger|certified|classic)[\s!.\u2026]*$/i,
  /^(respect|valid|taste|you have taste|good taste|excellent taste|impeccable taste)[\s!.\u2026]*$/i,
  /^(underrated|so underrated|criminally underrated)[\s!.\u2026]*$/i,
  /^(mine too|mine as well|me too|ditto|seconded|second this)[\s!.]*$/i,
  /^(so good|so so good|it's so good|such a good)[\s!.]*$/i,
  /^(right\??|right!|correct!|true|facts|fr|fax)[\s!.]*$/i,
  /^(the best|one of the best)[\s!.]*$/i,
  /^(love (this|that|it)|loved (this|that|it))[\s!.]*$/i,
  /^(banger|what a song|what a tune|what a banger|peak music)[\s!.]*$/i,
  /^(great list|great choices|nice list|good list|excellent list)[\s!.]*$/i,
  /^(great shout|nice one|fair play|top list)[\s!.]*$/i,
  /^(nice|lovely|brilliant|superb|fantastic|wonderful|awesome|amazing|great|cool)[\s!.\u2026]*$/i,
  /^(duh|easy|obvi|obviously|nailed it|winner|iconic|perfect)[\s!.]*$/i,
  // Pure emoji / punctuation
  /^[\s!?\u2764\u{1F44D}\u{1F44F}\u{1F525}\u{1F60D}\u{1F64F}\u{1F389}\u{1F3B5}\u{1F3B6}\u{1F3B8}\u{1F3B9}\u{2B50}\u{1F4AF}\u{1F91D}\u{1F44C}\u{1F64C}\u{2705}\u{1F3C6}\u{1F602}\u{1F923}\u{1F62D}\u{1F60E}\u{1F929}\u{1F4AA}\u{270A}\u{1F64B}\u{200D}\u{2640}\u{FE0F}\u{200D}\u{2642}\u{FE0F}\u{1F91C}\u{1F91B}\u{1F91E}\u{1F633}\u{1F641}\u{1F914}\u{1F60A}\u{1F197}\u{1F483}\u{1F64E}\u{1F57A}\u{1F918}\u{270C}\u{1F30A}\u{1F37E}\u{1F942}\u{1F4A3}]+$/u,
  // Very short (<=3 chars)
  /^.{0,3}$/,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;

  for (const pattern of REACTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Very short non-title-case text
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 7. Direct answer detection
// ---------------------------------------------------------------------------

function isDirectAnswer(post, rootUri) {
  if (post.parentUri === rootUri && post.depth === 1) return true;
  if (post.source === 'quote' && post.depth === 0) return true;
  if (post.source === 'quote-reply' && post.depth <= 1) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 8. Title refinement
// ---------------------------------------------------------------------------

function refineTitles(titles) {
  const result = [...new Set(titles)];

  // If "Celebration" appears alongside "Kool & the Gang" shorthand, dedupe
  const celIdx = result.indexOf('Celebration - Kool & the Gang');
  // no-op, the title dictionary already handles this

  return result;
}

// ---------------------------------------------------------------------------
// 9. URL title → canonical label
// ---------------------------------------------------------------------------

/**
 * Noise patterns in video titles that indicate non-music content.
 */
const URL_TITLE_NOISE = [
  /^a (man|woman|group|person|close up)/i, // Image alt text, not a title
  /dancing on a stage/i,
  /funny face/i,
  /\blyrics?\b.*\blyrics?\b/i, // Double "lyrics" is just lyrics pages
];

/**
 * Build a canonical "Song - Artist" label from URL title data.
 * Returns null if the title is noise or unparseable.
 */
function buildCanonicalFromUrl(urlEntry) {
  if (!urlEntry) return null;

  const { parsedSong, parsedArtist, videoTitle, platform } = urlEntry;

  // Skip image alt text and non-music titles
  for (const noise of URL_TITLE_NOISE) {
    if (noise.test(videoTitle || '')) return null;
    if (noise.test(parsedSong || '')) return null;
  }

  // Skip very long titles (likely descriptions, not song titles)
  if (parsedSong && parsedSong.length > 100) return null;

  // Skip playlist entries
  if (platform === 'spotify' && (urlEntry.url || '').includes('/playlist/')) return null;
  if (platform === 'apple' && (urlEntry.url || '').includes('/playlist/')) return null;

  // Handle "Song by Artist on Apple Music" format
  let song = parsedSong;
  let artist = parsedArtist;
  if (!artist && song) {
    const appleMatch = song.match(/^(.+?)\s+by\s+(.+?)\s+on\s+Apple Music$/i);
    if (appleMatch) {
      song = appleMatch[1].trim();
      artist = appleMatch[2].trim();
    }
  }

  if (artist && song) {
    // Clean up common suffixes in parsed song
    const cleanSong = song
      .replace(/\s*\(.*?\)\s*$/g, '') // Remove trailing parens
      .replace(/\s*\[.*?\]\s*$/g, '') // Remove trailing brackets
      .replace(/\s*\/\/\s*Lyrics?\s*$/i, '') // Remove "// Lyrics"
      .replace(/\s*-\s*Lyrics?\s*$/i, '') // Remove "- Lyrics"
      .trim();
    const cleanArtist = artist
      .replace(/\s*\(.*?\)\s*$/g, '')
      .trim();
    if (cleanSong && cleanArtist) {
      return `${cleanSong} - ${cleanArtist}`;
    }
  }

  // Song title only (no artist parsed)
  if (song) {
    const cleanSong = song
      .replace(/\s*\(.*?\)\s*$/g, '')
      .replace(/\s*\[.*?\]\s*$/g, '')
      .replace(/\s*\/\/\s*Lyrics?\s*$/i, '')
      .replace(/\s*-\s*Lyrics?\s*$/i, '')
      .trim();
    if (cleanSong && cleanSong.length >= 3 && cleanSong.length <= 60) {
      return cleanSong;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 10. Multi-song post parsing
// ---------------------------------------------------------------------------

function parseSongLines(text, isDirectPost, urlTitles) {
  const titles = new Set();
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lineTitles = findTitles(trimmed, isDirectPost);
    for (const t of lineTitles) {
      titles.add(t);
    }
  }
  return [...titles];
}

// ---------------------------------------------------------------------------
// 10. Manual overrides
// ---------------------------------------------------------------------------

/**
 * Post URIs with manually assigned labels for edge cases.
 */
const MANUAL_OVERRIDES = new Map([
  // Root OP's summary post
  [
    'at://did:plc:p2dcugajbtsn44h5n2kgt7ox/app.bsky.feed.post/3mehntwmpxk24',
    {
      topics: [
        'Yub Nub - Star Wars',
        'Celebration - Kool & the Gang',
        'FDT - YG & Nipsey Hussle',
      ],
      onTopic: true,
      confidence: 'high',
      note: 'OP summary of top picks',
    },
  ],
]);

// ---------------------------------------------------------------------------
// 11. Main labeling pipeline
// ---------------------------------------------------------------------------

function main() {
  console.log('Reading fixtures...');
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const posts = data.posts;

  let urlTitlesData = { titles: {} };
  try {
    urlTitlesData = JSON.parse(readFileSync(URL_TITLES_PATH, 'utf8'));
  } catch {
    console.warn('  Warning: URL titles cache not found. Run resolve-blast-songs-urls.mjs first.');
  }
  const urlTitles = urlTitlesData.titles || {};

  console.log(`  ${posts.length} posts, ${Object.keys(urlTitles).length} URL titles loaded.`);

  const postByUri = new Map();
  for (const post of posts) {
    postByUri.set(post.uri, post);
  }

  const rootUri = posts[0].uri;

  /** @type {Map<string, {topics: string[], onTopic: boolean, confidence: string, note?: string, _source: string}>} */
  const labels = new Map();

  let urlResolvedCount = 0;
  let artistShorthandCount = 0;

  // -----------------------------------------------------------------------
  // Pass 1: Explicit title detection
  // -----------------------------------------------------------------------
  console.log('\nPass 1: Explicit title detection...');

  for (const post of posts) {
    // Check manual overrides first
    if (MANUAL_OVERRIDES.has(post.uri)) {
      const override = MANUAL_OVERRIDES.get(post.uri);
      labels.set(post.uri, { ...override, _source: 'explicit' });
      continue;
    }

    // Root prompt post
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

    const isDirect = isDirectAnswer(post, rootUri);
    const ownText = getOwnText(post, urlTitles);
    const plainText = getPlainOwnText(post);

    // Find titles in the post's own text (including URL title metadata)
    let ownTitles = isDirect
      ? parseSongLines(ownText, true, urlTitles)
      : findTitles(ownText, false);

    // Also run full-text matching for multi-song posts
    if (isDirect) {
      const fullTextTitles = findTitles(ownText, true);
      for (const t of fullTextTitles) {
        if (!ownTitles.includes(t)) ownTitles.push(t);
      }
    }

    ownTitles = refineTitles(ownTitles);

    // Track URL-resolved
    if (ownTitles.length > 0 && urlTitles[post.uri]) {
      urlResolvedCount++;
    }

    // Track artist shorthand usage
    const lower = ownText.toLowerCase();
    for (const [shorthand] of ARTIST_SHORTHAND) {
      if (lower.includes(shorthand) && ownTitles.length > 0) {
        artistShorthandCount++;
        break;
      }
    }

    // Quoted text
    let quotedTitles = [];
    if (post.quotedText || (post.quotedAltText && post.quotedAltText.length > 0)) {
      const quotedSearchText = [
        post.quotedText || '',
        ...(post.quotedAltText || []),
      ].join('\n');
      quotedTitles = refineTitles(findTitles(quotedSearchText, true));
    }

    // URL-title fallback: if dictionary didn't match but we have resolved URL data,
    // generate a canonical label from the parsed song/artist
    if (ownTitles.length === 0 && urlTitles[post.uri]) {
      const urlEntry = urlTitles[post.uri];
      const urlCanonical = buildCanonicalFromUrl(urlEntry);
      if (urlCanonical) {
        ownTitles = [urlCanonical];
        urlResolvedCount++;
      }
    }

    if (ownTitles.length > 0) {
      labels.set(post.uri, {
        topics: ownTitles,
        onTopic: true,
        confidence: isDirect ? 'high' : 'high',
        _source: 'explicit',
      });
    } else if (quotedTitles.length > 0) {
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
        const lr = ownTrimmed.toLowerCase();
        const songRelated =
          /song|play|blast|music|listen|love[ds]?\b|great\b|classic|banger|anthem|volume|repeat|loop|playlist|vibe/i.test(lr);
        if (songRelated) {
          labels.set(post.uri, {
            topics: quotedTitles,
            onTopic: true,
            confidence: 'medium',
            note: 'Discusses quoted song(s)',
            _source: 'quoted',
          });
        } else {
          labels.set(post.uri, {
            topics: quotedTitles,
            onTopic: true,
            confidence: 'low',
            note: 'Quotes a song post but own text unclear',
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
      if (!parentLabel || !parentLabel.onTopic || parentLabel.topics.length === 0) continue;

      const parentDepth = inheritanceDepth(post.parentUri);
      if (parentDepth >= MAX_INHERITANCE_DEPTH) continue;

      const ownText = (post.text || '').trim();
      const fullOwnText = getOwnText(post, urlTitles);

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

      // Short discussion post about parent's song
      if (parentDepth === 0 && ownText.length <= 250) {
        const lower = ownText.toLowerCase();
        const discussingParent =
          /song|play|blast|music|listen|love[ds]?\b|great\b|classic|banger|anthem|choice|pick|volume|vibe|tune|jam/i.test(lower) ||
          /\b(it|that|this one|that one|that song|this song)\b/i.test(lower);

        if (discussingParent) {
          labels.set(post.uri, {
            topics: parentLabel.topics,
            onTopic: true,
            confidence: 'low',
            note: 'Discusses parent song without naming it',
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
    const fullText = getSearchableText(post, urlTitles);

    // Empty post with possible quoted content
    if (ownText.length === 0 && (!post.fullText || post.fullText.trim().length === 0)) {
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
            note: 'Empty post quoting a song mention',
            _source: 'quoted',
          });
          continue;
        }
      }

      labels.set(post.uri, {
        topics: [],
        onTopic: false,
        confidence: 'low',
        note: 'No text, no quoted titles',
        _source: 'explicit',
      });
      continue;
    }

    // Final aggressive match on full text
    const lastChanceTitles = findTitles(fullText, true);
    if (lastChanceTitles.length > 0) {
      labels.set(post.uri, {
        topics: refineTitles(lastChanceTitles),
        onTopic: true,
        confidence: 'medium',
        note: 'Found on final pass',
        _source: 'explicit',
      });
      continue;
    }

    // Determine on-topic vs off-topic
    const lower = ownText.toLowerCase();
    const isDirect = isDirectAnswer(post, rootUri);

    const seemsOnTopic =
      isDirect ||
      /\b(song|blast|playlist|banger|anthem)\b/i.test(lower) ||
      /\b(tough|hard|difficult|impossible)\b.{0,20}\b(choice|pick|decision)\b/i.test(lower) ||
      /my (list|pick|choice|song|playlist)/i.test(lower);

    if (seemsOnTopic) {
      labels.set(post.uri, {
        topics: [],
        onTopic: true,
        confidence: 'low',
        note: 'On-topic but no specific song identified',
        _source: 'explicit',
      });
    } else {
      const isDeepReply = post.depth >= 2;
      const isShortSocial = ownText.length <= 100;

      if (isDeepReply && isShortSocial) {
        labels.set(post.uri, {
          topics: [],
          onTopic: true,
          confidence: 'low',
          note: 'Short social reply within thread',
          _source: 'explicit',
        });
      } else {
        labels.set(post.uri, {
          topics: [],
          onTopic: false,
          confidence: 'low',
          note: 'No song match found',
          _source: 'explicit',
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Post-processing
  // -----------------------------------------------------------------------
  console.log('\nPost-processing...');

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
      fixtureFile: 'blast-songs.json',
      postCount: posts.length,
      labeledCount: labels.size,
      onTopicCount,
      offTopicCount: labels.size - onTopicCount,
      uniqueTitles: allTitles.size,
      confidence: confidenceCounts,
      urlResolvedCount,
      artistShorthandCount,
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
  console.log(`  Unique songs:      ${allTitles.size}`);
  console.log(`  Confidence:        high=${confidenceCounts.high}  medium=${confidenceCounts.medium}  low=${confidenceCounts.low}`);
  console.log(`  Source:            explicit=${sourceCounts.explicit}  quoted=${sourceCounts.quoted}  inherited=${sourceCounts.inherited}`);
  console.log(`  URL-resolved:      ${urlResolvedCount}`);
  console.log(`  Artist-shorthand:  ${artistShorthandCount}`);

  console.log('\nTop 50 songs by mention count:');
  console.log('  ' + '-'.repeat(72));
  sortedTitles.slice(0, 50).forEach(([title, count], i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${title.padEnd(62)} ${String(count).padStart(4)}`);
  });

  if (sortedTitles.length > 50) {
    console.log(`\n  ... and ${sortedTitles.length - 50} more songs.`);
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
