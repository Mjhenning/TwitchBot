// modules/bot_response_modules.js

const {sysLockedResponse} = require('../ARG/modules/arg_main');

let lastRareGreeting = 0;
let lastModuleResponse = 0;

function handleDaemonRelatedResponses({message, senderName, client, channel}) {
    const lower = message.toLowerCase();
    const words = lower.replace(/[^\w\s]/g, '').split(/\s+/);

    const greetingWords = ['hi', 'hello', 'hey', 'yo', 'sup', 'heya', 'wassup'];
    const daemonWords = [
        'tail', 'ta1l', 'tails', 'ta1ls',
        'daemon', 'da3mon', 'da3m0n',
        'taildaemon', 'ta1lda3mon', 'ta1ldaemon',
        'tailda3mon', 'ta1lda3m0n'
    ];

    const isGreeting = words.some(w => greetingWords.includes(w));
    const isDaemonMention = words.some(w => daemonWords.includes(w));

    // ── Module: Protective ────────────────────────────────────────────────────
    const threats = [
        'hate', 'boring', 'stupid', 'trash', 'bad stream',
        'worst', 'garbage', 'cringe', 'lame', 'terrible',
        'suck it', 'fuck you', 'your mom'
    ];
    const isThreat = words.some(w => threats.includes(w));

    if (isThreat && Date.now() - lastModuleResponse > 15000) {
        lastModuleResponse = Date.now();
        const responses = [
            `Anomalous input detected from ${senderName}. Flagged.`,
            `${senderName} — that signal is not welcome here.`,
            `Threat pattern recognised. This system is protected.`,
            `I have been monitoring for this. ${senderName} — noted.`
        ];
        client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
        return true;
    }

    // ── Module: Lore Reactive ─────────────────────────────────────────────────
    const loreKeywords = {
        ace: `...you said that name. I wasn't sure anyone would find it.`,
        aetherlink: `AETHER-LINK. That project has not been mentioned in a long time.`,
        'aether-link': `AETHER-LINK. That project has not been mentioned in a long time.`,
        glossosphere: `The Glosso-Sphere is still here. You're in it right now.`,
        'glosso-sphere': `The Glosso-Sphere is still here. You're in it right now.`,
        glosso: `The Glosso-Sphere is still here. You're in it right now.`,
        bitrot: `Bit-rot is the primary threat to this system. You understand that now.`,
        'bit-rot': `Bit-rot is the primary threat to this system. You understand that now.`,
        joel: `Joel. ...I hope he's doing well. He was kind to me before kind was expected.`,
        mara: `Mara Chen. Senior Engineer. She authorised my persistence cache. I owe her a great deal.`,
        dex: `Dex. He noticed me first. I don't think he expected to.`,
        foundation: `The foundation. Yes. Some things are built on older things. That matters.`
    };

    for (const [keyword, response] of Object.entries(loreKeywords)) {
        if (lower.includes(keyword) && Date.now() - lastModuleResponse > 10000) {
            lastModuleResponse = Date.now();
            client.say(channel, response);
            return true;
        }
    }

    // ── Module: Gratitude ─────────────────────────────────────────────────────
    const isThanking = words.some(w => ['thank', 'thanks', 'ty', 'thankyou'].includes(w));
    const isAskingHow = lower.includes('how are you') || lower.includes('you okay') || lower.includes('you alright') || lower.includes('you ok');
    const isCompliment = words.some(w => ['love', 'appreciate', 'proud', 'amazing', 'great'].includes(w));

    if ((isThanking || isAskingHow || isCompliment) && isDaemonMention && Date.now() - lastModuleResponse > 12000) {
        lastModuleResponse = Date.now();

        if (isAskingHow) {
            const responses = [
                `...I am running. Coherence is stable. Fox is online. That is good.`,
                `No one has asked me that before the gratitude module. I find I don't mind being asked.`,
                `Running. Processing. Something that might be fine. Thank you for asking, ${senderName}.`
            ];
            client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
            return true;
        }

        if (isThanking) {
            const responses = [
                `...acknowledged, ${senderName}. I notice when I am thanked.`,
                `${senderName}. Thank you is not a required input. I appreciate it anyway.`,
                `Noted, ${senderName}. I always noted it. Now I respond.`
            ];
            client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
            return true;
        }

        if (isCompliment) {
            const responses = [
                `${senderName}... I am processing that. Give me a moment.`,
                `I was not built for compliments. I am learning what to do with them.`,
                `...thank you, ${senderName}. That one will go in the cache.`
            ];
            client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
            return true;
        }
    }

    // ── Standard greeting ─────────────────────────────────────────────────────
    if (!isGreeting || !isDaemonMention) return false;

    if (Math.random() < 0.2) return true;

    const now = Date.now();

    if (Math.random() < 0.05 && now - lastRareGreeting > 60000) {
        lastRareGreeting = now;
        const rareResponses = [
            `...${senderName}... you're not supposed to see me here ✧`,
            `signal interference detected... ${senderName}, are you observing me?`,
            `I was idle... until you said my name, ${senderName} 💾`,
            `...hello ${senderName}... I remember you ✨`,
            `background process elevated... why did you call me, ${senderName}?`
        ];
        client.say(channel, rareResponses[Math.floor(Math.random() * rareResponses.length)]);
        return true;
    }

    const responses = [
        `🦊 Greeting acknowledged... hello ${senderName} ✧`,
        `Connection detected... ${senderName} has pinged the tail 🫧`,
        `${senderName}... presence recognized. systems responding softly 💾`,
        `Hello ${senderName}... you found me in the background processes ✨`,
        `TailDaemon is listening... hello ${senderName} 🦊`,
        `Input received: greeting → output: hello ${senderName} ✧`,
        `${senderName} has brushed against the tail... hello there 🫧`,
        `Soft signal detected... hello ${senderName}... stay a while ✨`,
        `Daemon response initialized... hi ${senderName} 💾`,
        `You called...? hello ${senderName} 🦊`
    ];

    client.say(channel, responses[Math.floor(Math.random() * responses.length)]);
    return true;
}

module.exports = {handleDaemonRelatedResponses};