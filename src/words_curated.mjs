// Curated dictionary of "beautiful" words. Short ones (3 letters) are taken ONLY from here.
// Edit freely: one word per token, case does not matter.
export const CURATED = `
ton toncoin nft nfts dao dex defi pump dump moon lambo hodl hold rekt rug rugs wagmi ngmi lfg fomo yolo
whale whales shark doge pepe shib bonk notcoin dogs hamster durov telegram gram wallet cash money rich
bank gold golden king queen boss god gods vip alpha sigma chad based meme memes degen ape apes bull bulls
bear bears pog gem gems fire ice lol kek omg wow jackpot lucky luck winner win wins zero hero ninja
satoshi bitcoin btc eth sol usdt airdrop mint burn stake yield fund coin coins token tokens rocket mars
star stars sun moon dragon tiger lion wolf fox owl bee bees dog cat cats boom bang crypto gang club team
crew ceo legend magic super mega ultra hyper turbo cyber neon pixel diamond diamonds hands hand ruby
jade pearl crown throne empire royal lord lady prince sultan pharaoh baron duke shogun samurai viking
pirate ghost devil angel demon saint holy heaven hell sky cloud storm thunder flash light dark night
shadow blood bone skull death life love heart soul mind dream dreams sweet honey sugar candy cake pizza
burger taco sushi beer wine vodka coffee tea milk juice apple lemon cherry banana mango peach
red blue green black white pink purple orange silver bronze iron steel stone rock metal glass
fast slow big small tiny huge giant mini max pro top best cool hot cold warm wild free easy hard
happy sad funny crazy lazy smart rare epic real fake true good bad evil nice dope sick lit fresh
alpha beta gamma delta omega zeta nova star void zen chill vibe vibes mood wave waves ocean sea
river lake island beach desert forest jungle mountain snow rain wind earth world planet space
galaxy cosmos comet orbit astro rocket alien robot cyborg android matrix code hack hacker bot
bots data byte bits node chain block blocks hash key keys lock vault safe secret
boy boys girl girls man men bro bros sis dad mom baby babe kid kids papa mama dude guy
ace joker card cards dice bet bets poker casino slot slots lotto spin roll
car cars bike jet ship boat yacht plane train taxi truck
game games play player level boss quest loot raid farm farmer miner mining
art artist music song songs dance party club rave disco funk jazz rock rap hiphop beat beats
shop store market trade trader trading buy sell long short pump moon mooning
cash flow profit gain gains loss win pay paid tip tips bonus prize reward
home house city town street road bridge tower castle palace temple
fish frog duck bird eagle hawk crow snake shark whale panda koala bunny rabbit bear horse pony
unicorn monkey mouse rat bat goat sheep cow pig chicken turtle octopus squid crab lobster
lucky lucker winner champ champion victory glory honor power force energy speed rush
time day days week year now soon never always forever today tonight
yes yeah yep nope okay hey hello hola hai bye ciao
fuck shit damn hell wtf lmao rofl haha hehe lmfao
egor egorka vodka blin suka kot kotik mama papa baba deda dengi bablo bratan brat pacan
krasava kruto topchik lox loh nahui pizda huy ebal durak zaebis davai poehali privet poka
babki kesh zoloto almaz car tsar korol boss moroz medved kremlin rus russia
`.split(/\s+/).filter(Boolean);

// Favorite themes: profanity, rofl jokes, irony, crypto slang, 420, booze, boobs, moon.
// These words get extra weight in scoring.
export const THEMES = {
  crypto: `soon wen ser gm gn wagmi ngmi lfg hodl rekt rug rugged pump dump moon mooning lambo degen ape aped
    fud fomo bags bag shill shiller copium hopium cope seethe ponzi scam scammer airdrop farm farming rekt
    whale shrimp jeet jeets paper diamond hands gwei gas mint minted wen lambo bullish bearish bull bear
    alpha beta chad based normie pleb anon dyor nfa ser bro frens fren wojak pepe doge shib bonk floor
    exit liquidity rugpull honeypot dev devs kek giga cap nocap cope ton toncoin durov gram notcoin dogs`,
  mat: `fuck fucked fucker fucking shit shitty shitcoin damn hell ass asshole dick cock cunt bitch bastard
    wtf stfu gtfo omfg crap piss pissed tits titty bollocks wank wanker
    blyat blya suka nahui nahuy pizda pizdec hui huy ebal ebat zaebis zaebal mudak pidor gavno govno
    lox loh durak dura churka xuy`,
  rofl: `lol lmao lmfao rofl kek kekw haha hehe xaxa omg wtf bruh bro sus cringe based yeet yolo
    noob n00b pwned owned gg ez rip oof meh lit fire dope sick savage boss goat clown joke prank troll
    meme memes dank simp karen chad virgin sigma alpha uwu owo baka`,
  irony: `sorry oops nope yikes legit totally surely trust believe honest real fake broke rich poor
    genius idiot loser winner king queen lord peasant slave master expert pro noob zero hero
    nice cool lucky unlucky blessed cursed doomed rekt saved free paid cheap scam safe`,
  weed: `420 weed kush bud blunt joint dank stoned stoner high blaze blazed bong hash ganja mary jane
    smoke smoker toke chill vibe vibes hemp grass herb trip tripping acid shroom shrooms lean codeine
    sizzurp molly xanax pills dealer plug stash`,
  booze: `beer beers lean vodka wine whisky whiskey rum gin tequila shot shots drunk drink drinks booze
    party bar pub cheers vino sake soju cider ale lager stout brew brewery hangover`,
  boobs: `boobs boob tits titty titties booty butt ass milf babe babes hottie sexy nude nudes thicc thick
    curvy bra bikini kiss lick moan horny daddy mommy baby honey sugar`,
  moon: `moon moons lunar luna mars rocket rockets space star stars sun galaxy cosmos orbit alien ufo
    launch astro nasa elon`,
};
export const THEMED = [...new Set(Object.values(THEMES).flatMap((s) => s.split(/\s+/)).filter(Boolean))];
