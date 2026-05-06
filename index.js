const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const scrapers = require('./scrapers');

const SUPPORTED_SITES = scrapers.getSiteList();

// Statické kategorie — pro weby bez live API kategorie
const CATEGORIES = [
    'Amateur', 'Anal', 'Asian', 'BBW', 'BDSM', 'Big Ass', 'Big Tits',
    'Blonde', 'Brunette', 'Casting', 'Compilation', 'Creampie', 'Cuckold',
    'Czech', 'Ebony', 'Gay', 'German', 'Granny', 'Hardcore', 'Hentai',
    'Interracial', 'Japanese', 'Latina', 'Lesbian', 'MILF', 'Massage',
    'Masturbation', 'Mature', 'Orgasm', 'POV', 'Public', 'Redhead',
    'Russian', 'Skinny', 'Solo', 'Squirt', 'Stepmom', 'Stockings',
    'Swinger', 'Threesome', 'Teen', 'Vintage'
];

// Cache Upornia kategorií (načte se při startu)
let uporniaCategories = CATEGORIES.slice(); // fallback = statické
let uporniaCatLoaded = false;

async function loadUporniaCategories() {
    try {
        const s = scrapers.getScraper('upornia');
        if (s && s.getCategories) {
            const cats = await s.getCategories();
            if (cats && cats.length > 5) {
                uporniaCategories = cats.map(c => c.name);
                uporniaCatLoaded = true;
                console.log(`[Upornia] Načteno ${uporniaCategories.length} kategorií z API`);
            }
        }
    } catch (e) {
        console.error('[Upornia categories load]', e.message);
    }
}

// Načti kategorie ihned při startu
loadUporniaCategories();

function getCategoriesForSite(siteId) {
    if (siteId === 'upornia') return uporniaCategories;
    return CATEGORIES;
}

const manifest = {
    id: 'com.cumination.stremio',
    version: '2.0.0',
    name: 'Cumination',
    description: 'Adult video addon – xVideos, Upornia, DrTuber, PornKai. S kategoriemi a vyhledáváním.',
    logo: 'https://i.imgur.com/GbmClBZ.png',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie'],
    idPrefixes: ['cum_'],
    catalogs: SUPPORTED_SITES.map(site => ({
        id: `cum_${site.id}`,
        name: site.name,
        type: 'movie',
        extra: [
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false },
            {
                name: 'genre',
                isRequired: false,
                options: getCategoriesForSite(site.id)
            }
        ]
    }))
};

const builder = new addonBuilder(manifest);

// ── CATALOG ───────────────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ id, extra }) => {
    const siteId = id.replace('cum_', '');
    const scraper = scrapers.getScraper(siteId);
    if (!scraper) return { metas: [] };

    try {
        const page = extra.skip ? Math.floor(parseInt(extra.skip) / 20) + 1 : 1;
        const keyword = extra.search || extra.genre || null;
        const videos = await scraper.list(page, keyword);

        const metas = videos.map(v => {
            const encodedUrl = Buffer.from(v.url).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            return {
                id: `cum_${siteId}_${encodedUrl}`,
                type: 'movie',
                name: v.name,
                poster: v.img || '',
                posterShape: 'landscape',
                description: [
                    v.duration ? `⏱ ${v.duration}` : '',
                    v.quality ? `📺 ${v.quality}` : '',
                ].filter(Boolean).join('  '),
                background: v.img || '',
            };
        });

        return { metas };
    } catch (e) {
        console.error(`[catalog] ${siteId} error:`, e.message);
        return { metas: [] };
    }
});

// ── META ──────────────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
    const parts = id.split('_');
    if (parts.length < 3) return { meta: null };
    const siteId = parts[1];
    const encodedUrl = parts.slice(2).join('_');
    const url = decodeBase64Url(encodedUrl);

    return {
        meta: {
            id,
            type: 'movie',
            name: url.split('/').pop().replace(/-/g, ' '),
            description: `Zdroj: ${siteName(siteId)}`
        }
    };
});

// ── STREAM ────────────────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split('_');
    if (parts.length < 3) return { streams: [] };
    const siteId = parts[1];
    const encodedUrl = parts.slice(2).join('_');
    const url = decodeBase64Url(encodedUrl);
    const scraper = scrapers.getScraper(siteId);
    if (!scraper) return { streams: [] };

    try {
        const streams = await scraper.resolve(url);
        return {
            streams: streams.map(s => ({
                url: s.url,
                title: s.quality || 'Přehrát',
                behaviorHints: { notWebReady: false }
            }))
        };
    } catch (e) {
        console.error(`[stream] ${siteId} error:`, e.message);
        return { streams: [] };
    }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function siteName(id) {
    const site = SUPPORTED_SITES.find(s => s.id === id);
    return site ? site.name : id;
}

function decodeBase64Url(str) {
    try {
        const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        return Buffer.from(padded, 'base64').toString('utf-8');
    } catch (e) {
        return str;
    }
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Cumination Stremio addon running on http://localhost:${PORT}`);
console.log(`Add to Stremio: http://localhost:${PORT}/manifest.json`);
console.log(`HTTP addon accessible at: http://127.0.0.1:${PORT}/manifest.json`);
