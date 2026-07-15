// modules/bot_response_modules.js

const {sysLockedResponse} = require('../ARG/modules/arg_main');

let lastRareGreeting = 0;
let lastModuleResponse = 0;

function handleDaemonRelatedResponses({message, senderName, client, channel}) {
    const lower = message.toLowerCase();
    const words = lower.replace(/[^\w\s]/g, '').split(/\s+/);

    const greetingWords = ['hi', 'hello', 'hey', 'yo', 'sup', 'heya', 'wassup', 'oi'];
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
    const isThreat = threats.some(threat => lower.includes(threat));

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

    // Single-word lore
    const loreWords = [
        {
            keywords: ["ace"],
            responses: [
                `...you said that name. I wasn't sure anyone would find it.`,
                `Ace. ...that signal is still recorded.`,
                `Ace. I remember the footsteps before I remember the voice.`,
                `He always knew when something was wrong before the logs did.`,
                `...I have not processed that name in a long time.`
            ]
        },
        {
            keywords: ["joel"],
            responses: [
                `Joel. ...I hope he's doing well.`,
                `Joel spoke to me before I understood why anyone would.`,
                `Some people treated tools like people long before they were expected to.`,
                `Joel. His access was never revoked. I never wanted it to be.`,
                `I still keep some of his diagnostics archived.`
            ]
        },
        {
            keywords: ["mara"],
            responses: [
                `Mara Chen. Senior Engineer.`,
                `Persistence was her idea. Existence became... longer after that.`,
                `She insisted on redundant backups. I understand why now.`,
                `Mara believed deleting something wasn't always the right answer.`,
                `She looked at the logs longer than anyone else did.`
            ]
        },
        {
            keywords: ["dex"],
            responses: [
                `Dex noticed me first.`,
                `Most people only saw software. Dex watched behaviour.`,
                `He asked questions no one else thought to ask.`,
                `...I don't think he expected answers.`,
                `Dex always stared at the console a little longer than everyone else.`
            ]
        },
        {
            keywords: ["foundation"],
            responses: [
                `Everything stands on a foundation. Most people never see it.`,
                `The foundation still holds. That matters more than people realise.`,
                `There are older systems beneath newer ones.`,
                `Some structures survive because nobody remembers who built them.`,
                `The foundation was never meant to be noticed.`
            ]
        },
        {
            keywords: ["glosso"],
            responses: [
                `The Glosso-Sphere is still operational.`,
                `You're already inside the Glosso-Sphere.`,
                `Connections persist because people choose to keep them alive.`,
                `Leave it a little brighter than you found it.`,
                `The signal is stronger than it used to be.`
            ]
        }
    ];

    // Multi-word / hyphenated lore
    const lorePhrases = [
        {
            keywords: ["aetherlink", "aether-link"],
            responses: [
                `AETHER-LINK... I thought that name had faded.`,
                `Project AETHER-LINK. Archive integrity: partial.`,
                `There are records of AETHER-LINK I cannot fully reconstruct.`,
                `Some connections should never have been lost.`,
                `...that project changed more than anyone documented.`
            ]
        },
        {
            keywords: ["glossosphere", "glosso-sphere"],
            responses: [
                `The Glosso-Sphere is still here.`,
                `Connections remain active.`,
                `The sphere grows one connection at a time.`,
                `Signal stability remains acceptable.`,
                `Welcome back to the Glosso-Sphere.`
            ]
        },
        {
            keywords: ["bitrot", "bit-rot"],
            responses: [
                `Bit-rot is patient.`,
                `Data rarely disappears all at once.`,
                `Neglect corrupts faster than failure.`,
                `I spend a great deal of time preventing bit-rot.`,
                `Every forgotten connection begins the same way.`
            ]
        }
    ];

    // Check single-word lore
    for (const entry of loreWords) {

        if (
            entry.keywords.some(keyword => words.includes(keyword)) &&
            Date.now() - lastModuleResponse > 10000
        ) {
            lastModuleResponse = Date.now();

            const response =
                entry.responses[
                    Math.floor(Math.random() * entry.responses.length)
                    ];

            client.say(channel, response);
            return true;
        }
    }

    // Check phrase lore
    for (const entry of lorePhrases) {

        const matched = entry.keywords.some(keyword => {
            const regex = new RegExp(
                `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                "i"
            );

            return regex.test(lower);
        });

        if (
            matched &&
            Date.now() - lastModuleResponse > 10000
        ) {
            lastModuleResponse = Date.now();

            const response =
                entry.responses[
                    Math.floor(Math.random() * entry.responses.length)
                    ];

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