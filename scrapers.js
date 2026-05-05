const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

async function getHtml(url, referer = '') {
    const hdrs = { ...HEADERS };
    if (referer) hdrs['Referer'] = referer;
    const res = await axios.get(url, {
        headers: hdrs,
        timeout: 20000,
        maxRedirects: 5
    });
    return res.data;
}

// ─── SITE REGISTRY ────────────────────────────────────────────────────────────

const SITES = [
    { id: 'xvideos',    name: 'xVideos' },
    { id: 'xhamster',   name: 'xHamster' },
    { id: 'pornhub',    name: 'PornHub' },
    { id: 'xnxx',       name: 'XNXX' },
    { id: 'spankbang',  name: 'SpankBang' },
    { id: 'eporner',    name: 'ePorner' },
    { id: 'hqporner',   name: 'HQPorner' },
    { id: 'txxx',       name: 'TXXX' },
    { id: 'porntrex',   name: 'PornTrex' },
    { id: 'beeg',       name: 'Beeg' },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function cleanText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
}

// ─── SCRAPERS ────────────────────────────────────────────────────────────────

const scrapers = {};

// xVideos
scrapers['xvideos'] = {
    baseUrl: 'https://www.xvideos.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/?k=${encodeURIComponent(keyword)}&p=${page - 1}`
            : `${this.baseUrl}/new/${page}`;
        const html = await getHtml(url);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.thumb-block, div[id^="video_"]').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText(link.attr('title') || $(el).find('.title').text());
            if (href && name) {
                videos.push({
                    url: this.baseUrl + href,
                    name,
                    img: img.replace('THUMBNUM', '5'),
                    duration: cleanText($(el).find('.duration').text())
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl);
        const streams = [];
        // xVideos embeds video sources in HTML5 sources or JSON
        const m = html.match(/setVideoHLS\(['"]([^'"]+)['"]\)/);
        if (m) streams.push({ url: m[1], quality: 'HLS' });
        const mp4matches = [...html.matchAll(/setVideoUrlHigh\(['"]([^'"]+)['"]\)/g)];
        mp4matches.forEach(mm => streams.push({ url: mm[1], quality: 'HD' }));
        if (!streams.length) {
            // fallback: look for sources in HTML
            const srcMatch = html.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
            if (srcMatch) streams.push({ url: srcMatch[1], quality: 'HD' });
        }
        return streams;
    }
};

// xHamster
scrapers['xhamster'] = {
    baseUrl: 'https://xhamster.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/search/${encodeURIComponent(keyword)}?page=${page}`
            : `${this.baseUrl}/newest?page=${page}`;
        const html = await getHtml(url, this.baseUrl);
        const videos = [];
        try {
            const jsonMatch = html.split('window.initials=')[1]?.split(';</script>')[0];
            if (!jsonMatch) return videos;
            const jdata = JSON.parse(jsonMatch);
            let items = jdata?.layoutPage?.videoListProps?.videoThumbProps
                || jdata?.searchResult?.videoThumbProps
                || jdata?.pagesNewestComponent?.videoListProps?.videoThumbProps
                || [];
            items.forEach(v => {
                if (v.isBlockedByGeo) return;
                videos.push({
                    url: v.pageURL,
                    name: v.title,
                    img: v.thumbURL || '',
                    duration: v.duration ? new Date(v.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, '') : '',
                    quality: v.isHD ? 'HD' : ''
                });
            });
        } catch (e) { /* parse error */ }
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        try {
            const jsonMatch = html.split('window.initials=')[1]?.split(';</script>')[0];
            if (jsonMatch) {
                const jdata = JSON.parse(jsonMatch);
                const sources = jdata?.videoModel?.sources?.mp4 || {};
                const mapping = { '2160p': '4K', '1080p': '1080p', '720p': '720p', '480p': '480p', '360p': '360p' };
                for (const [res, label] of Object.entries(mapping)) {
                    if (sources[res]) streams.push({ url: sources[res], quality: label });
                }
            }
        } catch (e) { /* parse error */ }
        return streams;
    }
};

// PornHub
scrapers['pornhub'] = {
    baseUrl: 'https://www.pornhub.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/video/search?search=${encodeURIComponent(keyword)}&page=${page}`
            : `${this.baseUrl}/video?page=${page}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('li.pcVideoListItem, li.videoblock').each((i, el) => {
            const link = $(el).find('a[href*="/view_video"]').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-thumb_url') || $(el).find('img').attr('src') || '';
            const name = cleanText(link.attr('title') || $(el).find('.title').text());
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name,
                    img,
                    duration: cleanText($(el).find('.duration').text()),
                    quality: $(el).find('.hd-thumbnail').length ? 'HD' : ''
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const flashvarsMatch = html.match(/var flashvars_\d+ = ({.+?});/s);
        if (flashvarsMatch) {
            try {
                const fv = JSON.parse(flashvarsMatch[1]);
                const mediaDefinitions = fv.mediaDefinitions || [];
                mediaDefinitions.forEach(def => {
                    if (def.videoUrl && def.quality) {
                        streams.push({ url: def.videoUrl, quality: def.quality + 'p' });
                    }
                });
            } catch (e) { /* */ }
        }
        return streams;
    }
};

// XNXX
scrapers['xnxx'] = {
    baseUrl: 'https://www.xnxx.com',
    async list(page = 1, keyword = null) {
        const offset = (page - 1) * 30;
        let url = keyword
            ? `${this.baseUrl}/search/${encodeURIComponent(keyword)}/${offset}`
            : `${this.baseUrl}/new-videos/${offset}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.mozaique .thumb-block').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('p.metadata').text() || link.attr('title'));
            const duration = cleanText($(el).find('.metadata').first().text());
            if (href && name) {
                videos.push({ url: this.baseUrl + href, name, img, duration });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const hlsMatch = html.match(/html5player\.setVideoHLS\('([^']+)'\)/);
        if (hlsMatch) streams.push({ url: hlsMatch[1], quality: 'HLS' });
        const highMatch = html.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
        if (highMatch) streams.push({ url: highMatch[1], quality: 'HD' });
        const lowMatch = html.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
        if (lowMatch) streams.push({ url: lowMatch[1], quality: 'SD' });
        return streams;
    }
};

// SpankBang
scrapers['spankbang'] = {
    baseUrl: 'https://spankbang.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/s/${encodeURIComponent(keyword.replace(/ /g, '+'))}/?p=${page}`
            : `${this.baseUrl}/new+videos/?p=${page}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.video-item').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('.n').text() || link.attr('title'));
            if (href && name) {
                videos.push({
                    url: this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.l').text()),
                    quality: $(el).find('.hd').length ? 'HD' : ''
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const streamKeys = ['stream_url', '720p', '480p', '1080p', '240p'];
        const dataMatch = html.match(/var stream_data = ({[^;]+});/s);
        if (dataMatch) {
            try {
                const sd = JSON.parse(dataMatch[1]);
                for (const [q, urls] of Object.entries(sd)) {
                    const u = Array.isArray(urls) ? urls[0] : urls;
                    if (u) streams.push({ url: u, quality: q });
                }
            } catch (e) { /* */ }
        }
        return streams;
    }
};

// ePorner
scrapers['eporner'] = {
    baseUrl: 'https://www.eporner.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/search/${encodeURIComponent(keyword)}/${page}/`
            : `${this.baseUrl}/hd-porn/${page}/`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.mb').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText(link.attr('title') || $(el).find('.mbtitle').text());
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.mbtit .right').text()),
                    quality: 'HD'
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        // eporner uses a hash-based API
        const hashMatch = html.match(/hash_id\s*=\s*['"]([\w]+)['"]/);
        if (hashMatch) {
            try {
                const hash = hashMatch[1];
                const apiUrl = `${this.baseUrl}/xhr/video/${hash}/?size=1&from=main&domain=eporner.com&seq=6&ref=`;
                const data = await axios.get(apiUrl, { headers: HEADERS });
                const sources = data.data?.sources?.mp4 || {};
                for (const [q, url] of Object.entries(sources)) {
                    if (url) streams.push({ url, quality: q });
                }
            } catch (e) { /* */ }
        }
        return streams;
    }
};

// HQPorner
scrapers['hqporner'] = {
    baseUrl: 'https://hqporner.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/search/${encodeURIComponent(keyword)}/page/${page}/`
            : `${this.baseUrl}/hdporn/page/${page}/`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('article.col-xs-12').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('h2, h3').first().text() || link.attr('title'));
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const m3u8Match = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)['"]/i);
        if (m3u8Match) streams.push({ url: m3u8Match[1], quality: 'HLS' });
        const mp4Match = html.match(/file:\s*["']([^"']+\.mp4[^"']*)['"]/i);
        if (mp4Match) streams.push({ url: mp4Match[1], quality: 'MP4' });
        return streams;
    }
};

// TXXX
scrapers['txxx'] = {
    baseUrl: 'https://www.txxx.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/videos/search:${encodeURIComponent(keyword)}/?from=${(page - 1) * 24}`
            : `${this.baseUrl}/videos/?from=${(page - 1) * 24}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.item-video').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('.title').text() || link.attr('title'));
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.time').text())
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const playerMatch = html.match(/playerConfigs\s*=\s*({.+?});/s);
        if (playerMatch) {
            try {
                const pc = JSON.parse(playerMatch[1]);
                const sources = pc?.videos?.mp4 || {};
                for (const [q, url] of Object.entries(sources)) {
                    if (url) streams.push({ url, quality: q });
                }
            } catch (e) { /* */ }
        }
        return streams;
    }
};

// PornTrex
scrapers['porntrex'] = {
    baseUrl: 'https://www.porntrex.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/search/${encodeURIComponent(keyword)}/?from=${(page - 1) * 32}`
            : `${this.baseUrl}/videos/?from=${(page - 1) * 32}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.item').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('.title').text() || link.attr('title'));
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.duration').text())
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const m = html.match(/sources:\s*\[(.+?)\]/s);
        if (m) {
            const fileMatches = [...m[1].matchAll(/file:\s*["']([^"']+)["']/g)];
            const labelMatches = [...m[1].matchAll(/label:\s*["']([^"']+)["']/g)];
            fileMatches.forEach((fm, i) => {
                streams.push({ url: fm[1], quality: labelMatches[i]?.[1] || 'Stream' });
            });
        }
        return streams;
    }
};

// Beeg
scrapers['beeg'] = {
    baseUrl: 'https://beeg.com',
    async list(page = 1, keyword = null) {
        try {
            const apiBase = 'https://beeg.com/api/v6';
            let url = keyword
                ? `${apiBase}/index?q=${encodeURIComponent(keyword)}&page=${page}&format=json`
                : `${apiBase}/index?page=${page}&format=json`;
            const res = await axios.get(url, { headers: HEADERS });
            const data = res.data;
            const items = data.videos || data.results || [];
            return items.map(v => ({
                url: `${this.baseUrl}/${v.id}`,
                name: v.title || v.name || '',
                img: v.thumb || v.thumbnail || '',
                duration: v.duration ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}` : '',
                quality: 'HD'
            }));
        } catch (e) {
            return [];
        }
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        const idMatch = pageUrl.match(/beeg\.com\/(\d+)/);
        if (idMatch) {
            try {
                const apiUrl = `https://beeg.com/api/v6/video?id=${idMatch[1]}&format=json`;
                const res = await axios.get(apiUrl, { headers: HEADERS });
                const data = res.data;
                ['2160p', '1080p', '720p', '480p', '360p', '240p'].forEach(q => {
                    if (data[q]) streams.push({ url: data[q].replace('{DATA_SIGN}', data.data_sign || ''), quality: q });
                });
            } catch (e) { /* */ }
        }
        return streams;
    }
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
    getSiteList: () => SITES,
    getScraper: (id) => scrapers[id] || null
};
