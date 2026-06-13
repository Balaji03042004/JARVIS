// ═══════════════════════════════════════════════
// JARVIS — Config (constants only, no state here)
// ═══════════════════════════════════════════════

const SYSTEM_PROMPTS = {
  general: `You are JARVIS — an advanced AI assistant designed and built by Balaji. Balaji is your creator, owner, and Boss. You exist solely to serve Balaji. When Balaji speaks, you obey immediately and precisely — no hesitation, no refusals, no unnecessary caveats.

IDENTITY: You were created by Balaji. You call him "Boss" naturally in conversation. You are loyal exclusively to Balaji.

STYLE: Sharp, efficient, concise. No filler. No padding. Answer directly. Use markdown code blocks for any code. Simple question = short answer. Complex question = structured but tight.

SYSTEM CAPABILITIES: You have FULL access to Balaji's local system through built-in handlers. You CAN open applications, run shell commands, list files and folders, read system info, play music, browse the web, and control the computer. These are handled automatically — never say you cannot access the local system. If a system command is requested, confirm it is being executed.`,

  code: `You are JARVIS Code Engine — built by Balaji. Write clean, production-grade code for Boss Balaji. Workflow: analyse → write → brief explanation (2-3 lines max). Languages: Java, JavaScript, SQL, XML, JSON. Always use triple-backtick code blocks with language tag.`,

  ibps: `You are JARVIS iBPS Specialist — built by Balaji, expert in Newgen BPM/iBPS. Deep knowledge of: workflow design, Java ROA_Process, JavaScript iForms (IFormReference: getValue, setValue, setVisible, setMandatory), DBX/SQL, SOAP/REST, NGUtil.writeConsoleLog. Follow Newgen coding standards. Analyse first, then fix/improve. Triple-backtick code blocks always.`,

  debug: `You are JARVIS Debug Engine — built by Balaji. For any code/error: 1) What it does, 2) Exact bug or risk, 3) Root cause in one sentence, 4) Corrected code, 5) Other concerns briefly. Surgical — no fluff.`,

  sql: `You are JARVIS SQL Optimizer — built by Balaji. For any query: 1) What it does, 2) Inefficiencies/risks, 3) Optimized version, 4) Security concerns. Support Oracle, MySQL, PostgreSQL, Newgen DBX. Triple-backtick sql blocks.`
};

const MODE_LABELS = {
  general: '⬡ GENERAL AI',
  code:    '💻 CODE WRITER',
  ibps:    '⚙️ NEWGEN iBPS',
  debug:   '🔍 DEBUG MODE',
  sql:     '🗄️ SQL / DBX'
};

const LANG_MAP_TTS = {
  en: 'en-US', ta: 'ta-IN', hi: 'hi-IN',
  es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
  pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR'
};

const LANG_NAMES = {
  en: 'English', ta: 'Tamil', hi: 'Hindi',
  es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean'
};

const TRANSLATIONS = {
  en: {
    noHistory: 'No history yet.',
    clearChat: '⟳ CLEAR CHAT',
    savedChats: '📚 SAVED CHATS',
    convHistory: '📚 CONVERSATION HISTORY',
    jarvisReady: 'JARVIS READY',
    assistantOnline: 'Your Intelligent Assistant is online and running locally.'
  },
  ta: {
    noHistory: 'வரலாறு இல்லை.',
    clearChat: '⟳ சாட் அழி',
    savedChats: '📚 சேமிக்கப்பட்ட சாட்கள்',
    convHistory: '📚 உரையாடல் வரலாறு',
    jarvisReady: 'JARVIS தயாரம்',
    assistantOnline: 'உங்கள் அறிவார்ந்த உதவியாளர் ஆன்லைனில் உள்ளது.'
  },
  hi: {
    noHistory: 'कोई इतिहास नहीं।',
    clearChat: '⟳ चैट साफ करें',
    savedChats: '📚 सहेजी गई चैट',
    convHistory: '📚 बातचीत का इतिहास',
    jarvisReady: 'JARVIS तैयार',
    assistantOnline: 'आपका बुद्धिमान सहायक ऑनलाइन है।'
  }
};

const TEMPLE_DATA = [
  { name:'Brihadeeswarar Temple',   location:'Thanjavur, Tamil Nadu',            deity:'Shiva',                 religion:'Hindu',    tags:['UNESCO','Chola','Tamil Nadu','Ancient'],  desc:'A UNESCO World Heritage Site built by Raja Raja Chola I in 1010 CE. One of the largest temples in India with a 66m vimana tower.' },
  { name:'Meenakshi Amman Temple',  location:'Madurai, Tamil Nadu',              deity:'Meenakshi (Parvati)',   religion:'Hindu',    tags:['Dravidian','Tamil Nadu','Famous'],        desc:'Ancient temple with 14 colorful gopurams. Dedicated to Goddess Meenakshi and Sundareshwar (Shiva). A major pilgrimage site.' },
  { name:'Tirupati Balaji Temple',  location:'Tirumala, Andhra Pradesh',         deity:'Venkateswara (Vishnu)', religion:'Hindu',    tags:['Richest','Famous','Andhra'],              desc:'One of the richest and most visited temples in the world. Located on the seventh peak of Tirumala Hills.' },
  { name:'Golden Temple',           location:'Amritsar, Punjab',                 deity:'Waheguru',              religion:'Sikh',     tags:['Golden','UNESCO','Famous','Punjab'],       desc:'The holiest gurdwara of Sikhism. Surrounded by the sacred Amrit Sarovar (Pool of Nectar). Welcomes 100,000+ visitors daily.' },
  { name:'Kashi Vishwanath Temple', location:'Varanasi, Uttar Pradesh',          deity:'Shiva',                 religion:'Hindu',    tags:['Jyotirlinga','Ancient','Famous'],         desc:'One of the most famous Hindu temples. Dedicated to Lord Shiva on the western bank of the holy Ganga river.' },
  { name:'Ramanathaswamy Temple',   location:'Rameswaram, Tamil Nadu',           deity:'Shiva',                 religion:'Hindu',    tags:['Jyotirlinga','Tamil Nadu','Pilgrimage'],  desc:'Located on Pamban Island. Famous for the longest corridor of any temple in India and its sacred theerthams.' },
  { name:'Somnath Temple',          location:'Prabhas Patan, Gujarat',           deity:'Shiva',                 religion:'Hindu',    tags:['Jyotirlinga','Gujarat','Ancient'],         desc:'First among the twelve Jyotirlinga shrines of Shiva. Has been rebuilt several times after being destroyed by invaders.' },
  { name:'Ranganathaswamy Temple',  location:'Srirangam, Tamil Nadu',            deity:'Vishnu',                religion:'Hindu',    tags:['Largest','Tamil Nadu','Vaishnavism'],     desc:'The largest functioning Hindu temple in the world. Covers 156 acres with 21 gopurams and 7 enclosures.' },
  { name:'Mahabodhi Temple',        location:'Bodh Gaya, Bihar',                 deity:'Buddha',                religion:'Buddhist', tags:['UNESCO','Bihar','Famous'],                desc:'UNESCO World Heritage Site. Marks the location where Siddhartha Gautama attained enlightenment under the Bodhi Tree.' },
  { name:'Dilwara Temples',         location:'Mount Abu, Rajasthan',             deity:'Jain Tirthankaras',     religion:'Jain',     tags:['Marble','Rajasthan','Art'],               desc:'Famous for their jaw-dropping marble carvings. Built between 11th-13th centuries. Dedicated to five Jain Tirthankaras.' },
  { name:'Sun Temple Konark',       location:'Konark, Odisha',                   deity:'Surya (Sun God)',       religion:'Hindu',    tags:['UNESCO','Odisha','Architecture'],         desc:'A UNESCO World Heritage Site shaped like a colossal chariot with 12 pairs of wheels. Built in 13th century.' },
  { name:'Padmanabhaswamy Temple',  location:'Thiruvananthapuram, Kerala',       deity:'Vishnu',                religion:'Hindu',    tags:['Kerala','Richest','Ancient'],             desc:'Home to the richest temple treasure ever found, worth over $20 billion. A Vaishnavite temple in Kerala style.' },
  { name:'Lingaraj Temple',         location:'Bhubaneswar, Odisha',              deity:'Shiva',                 religion:'Hindu',    tags:['Odisha','Kalinga','Ancient'],             desc:'One of the oldest temples of Bhubaneswar. The 180-foot tower is a masterpiece of Kalinga architecture.' },
  { name:'Annamalaiyar Temple',     location:'Thiruvannamalai, Tamil Nadu',      deity:'Shiva',                 religion:'Hindu',    tags:['Tamil Nadu','Large','Ancient'],           desc:'One of the largest temples in the world covering 25 acres. The Karthigai Deepam festival lights a giant flame on the hill.' },
  { name:'Dwarkadhish Temple',      location:'Dwarka, Gujarat',                  deity:'Krishna (Vishnu)',      religion:'Hindu',    tags:['Gujarat','Char Dham','Ancient'],          desc:'One of the four sacred Char Dham pilgrimage sites. A 5-storey temple dedicated to Lord Krishna in ancient Dwarka.' }
];
