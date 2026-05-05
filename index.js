const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const scrapers = require('./scrapers');

const SUPPORTED_SITES = scrapers.getSiteList();

// Kategorie — používají se jako search query na daném webu
const CATEGORIES = [
    'Amateur',
    'Anal',
    'Asian',
    'BBW',
    'BDSM',
    'Big Ass',
    'Big Tits',
    'Blonde',
    'Brunette',
    'Casting',
    'Compilation',
    'Creampie',
    'Czech',
    'Ebony',
    'Gay',
    'German',
    'Hardcore',
    'Hentai',
    'Latina',
    'Lesbian',
    'MILF',
    'Massage',
    'Masturbation',
    'Mature',
    'POV',
    'Public',
    'Russian',
    'Squirt',
    'Stepmom',
    'Threesome',
    'Teen',
    'Vintage',
];

const manifest = {
    id: 'com.cumination.stremio',
    version: '1.1.0',
    name: 'Cumination',
    description: 'Adult video addon – port of Kodi Cumination plugin. Aggregates content from 10 sites with category filtering.',
    logo: 'https://i.imgur.com/cumination.png',
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
            { name: 'genre', isRequired: false, options: CATEGORIES }
        ]
    }))
};

const builder = new addonBuilder(manifest);

// CATALOG handler
builder.defineCatalogHandler(async ({ id, extra }) => {
    const siteId = id.replace('cum_', '');
    const scraper = scrapers.getScraper(siteId);
    if (!scraper) return { metas: [] };

    try {
        const page = extra.skip ? Math.floor(parseInt(extra.skip) / 20) + 1 : 1;
        // Priorita: search > genre > výchozí (nejnovější)
        const keyword = extra.search || extra.genre || null;
        const videos = await scraper.list(page, keyword);
        const metas = videos.map(v => ({
            id: `cum_${siteId}_${encodeURIComponent(v.url)}`,
            type: 'movie',
            name: v.name,
            poster: v.img || '',
            description: `Duration: ${v.duration || 'N/A'} | Quality: ${v.quality || 'N/A'}`,
            background: v.img || '',
            genres: [site_name(siteId), ...(extra.genre ? [extra.genre] : [])]
        }));
        return { metas };
    } catch (e) {
        console.error(`[catalog] ${siteId} error:`, e.message);
        return { metas: [] };
    }
});

// META handler
builder.defineMetaHandler(async ({ id }) => {
    const parts = id.split('_');
    if (parts.length < 3) return { meta: null };
    const siteId = parts[1];
    const url = decodeURIComponent(parts.slice(2).join('_'));
    return {
        meta: {
            id,
            type: 'movie',
            name: url.split('/').pop().replace(/-/g, ' '),
            description: `From: ${site_name(siteId)}\nURL: ${url}`
        }
    };
});

// STREAM handler
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split('_');
    if (parts.length < 3) return { streams: [] };
    const siteId = parts[1];
    const url = decodeURIComponent(parts.slice(2).join('_'));
    const scraper = scrapers.getScraper(siteId);
    if (!scraper) return { streams: [] };

    try {
        const streams = await scraper.resolve(url);
        return {
            streams: streams.map(s => ({
                url: s.url,
                title: s.quality || 'Stream',
                behaviorHints: { notWebReady: false }
            }))
        };
    } catch (e) {
        console.error(`[stream] ${siteId} error:`, e.message);
        return { streams: [] };
    }
});

function site_name(id) {
    const site = SUPPORTED_SITES.find(s => s.id === id);
    return site ? site.name : id;
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Cumination Stremio addon running on http://localhost:${PORT}`);
console.log(`Add to Stremio: http://localhost:${PORT}/manifest.json`);
console.log(`HTTP addon accessible at: http://127.0.0.1:${PORT}/manifest.json`);
