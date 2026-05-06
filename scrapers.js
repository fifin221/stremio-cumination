const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
};

async function getHtml(url, referer = '') {
    const hdrs = { ...HEADERS };
    if (referer) hdrs['Referer'] = referer;
    const res = await axios.get(url, {
        headers: hdrs,
        timeout: 25000,
        maxRedirects: 5
    });
    return res.data;
}

// ─── SITE REGISTRY ────────────────────────────────────────────────────────────

const SITES = [
    { id: 'xvideos',   name: 'xVideos' },
    { id: 'xhamster',  name: 'xHamster' },
    { id: 'xnxx',      name: 'XNXX' },
    { id: 'spankbang', name: 'SpankBang' },
    { id: 'eporner',   name: 'ePorner' },
    { id: 'hqporner',  name: 'HQPorner' },
    { id: 'txxx',      name: 'TXXX' },
    { id: 'beeg',      name: 'Beeg' },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function cleanText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
}

// ─── SCRAPERS ────────────────────────────────────────────────────────────────

const scrapers = {};

// ── xVideos ──────────────────────────────────────────────────────────────────
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
        // HLS (nejlepší kvalita)
        const hlsMatch = html.match(/html5player\.setVideoHLS\('([^']+)'\)/);
        if (hlsMatch) streams.push({ url: hlsMatch[1], quality: 'HLS' });
        // MP4 high
        const highMatch = html.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
        if (highMatch) streams.push({ url: highMatch[1], quality: 'HD' });
        // MP4 low fallback
        const lowMatch = html.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
        if (lowMatch) streams.push({ url: lowMatch[1], quality: 'SD' });
        // Alternativní pattern
        if (!streams.length) {
            const alt = html.match(/setVideoHLS\("([^"]+)"\)/);
            if (alt) streams.push({ url: alt[1], quality: 'HLS' });
        }
        return streams;
    }
};

// ── xHamster ─────────────────────────────────────────────────────────────────
scrapers['xhamster'] = {
    baseUrl: 'https://xhamster.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/search/${encodeURIComponent(keyword)}?page=${page}`
            : `${this.baseUrl}/newest?page=${page}`;
        const html = await getHtml(url, this.baseUrl);
        const videos = [];
        try {
            // xHamster ukládá data do window.initials jako JSON
            const jsonMatch = html.split('window.initials=')[1]?.split(';</script>')[0];
            if (!jsonMatch) return videos;
            const jdata = JSON.parse(jsonMatch);
            // Různé cesty podle typu stránky
            let items = jdata?.videoList?.videos
                || jdata?.searchResult?.data?.videos
                || jdata?.layoutPage?.videoListProps?.videos
                || jdata?.newest?.videos
                || [];
            // Pokud je to pole objektů
            if (!Array.isArray(items)) items = Object.values(items);
            items.forEach(v => {
                if (!v || v.isBlockedByGeo) return;
                const videoUrl = v.pageURL || v.url || v.link;
                const title = v.title || v.name;
                if (!videoUrl || !title) return;
                videos.push({
                    url: videoUrl,
                    name: title,
                    img: v.thumbURL || v.thumbnail || v.thumbs?.[0]?.src || '',
                    duration: v.duration ? new Date(v.duration * 1000).toISOString().substr(11, 8).replace(/^00:/, '') : '',
                    quality: v.isHD ? 'HD' : ''
                });
            });
        } catch (e) {
            console.error('[xhamster list]', e.message);
        }
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        try {
            const jsonMatch = html.split('window.initials=')[1]?.split(';</script>')[0];
            if (jsonMatch) {
                const jdata = JSON.parse(jsonMatch);
                // Nová cesta v xHamster
                const sources = jdata?.videoModel?.sources?.mp4
                    || jdata?.video?.sources?.mp4
                    || {};
                const order = ['2160p', '1080p', '720p', '480p', '360p'];
                for (const res of order) {
                    if (sources[res]) streams.push({ url: sources[res], quality: res });
                }
                // HLS fallback
                const hls = jdata?.videoModel?.sources?.hls || jdata?.video?.sources?.hls;
                if (!streams.length && hls?.url) {
                    streams.push({ url: hls.url, quality: 'HLS' });
                }
            }
        } catch (e) {
            console.error('[xhamster resolve]', e.message);
        }
        // Fallback: hledat MP4 přímo v HTML
        if (!streams.length) {
            const mp4Match = html.match(/"mp4":\s*\{[^}]*"(\d+p)":\s*"([^"]+)"/);
            if (mp4Match) streams.push({ url: mp4Match[2], quality: mp4Match[1] });
        }
        return streams;
    }
};

// ── XNXX ─────────────────────────────────────────────────────────────────────
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
            const name = cleanText($(el).find('p.metadata').text() || link.attr('title') || $(el).find('.title').text());
            if (href && name && href.startsWith('/video')) {
                videos.push({
                    url: this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.metadata').first().text())
                });
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

// ── SpankBang ─────────────────────────────────────────────────────────────────
scrapers['spankbang'] = {
    baseUrl: 'https://spankbang.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/s/${encodeURIComponent(keyword.replace(/ /g, '+'))}/?p=${page}`
            : `${this.baseUrl}/new+videos/?p=${page}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.video-item, div[class*="stream_item"]').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('.n, .title').text() || link.attr('title'));
            if (href && name && !href.includes('playlist')) {
                videos.push({
                    url: this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.l, .video-duration').text()),
                    quality: $(el).find('.hd, .flag-hd').length ? 'HD' : ''
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        // SpankBang ukládá streamy do stream_data objektu
        const dataMatch = html.match(/var stream_data\s*=\s*({[\s\S]+?});/);
        if (dataMatch) {
            try {
                const sd = JSON.parse(dataMatch[1]);
                const order = ['4k', '1080p', '720p', '480p', '320p', '240p'];
                for (const q of order) {
                    if (sd[q]) {
                        const u = Array.isArray(sd[q]) ? sd[q][0] : sd[q];
                        if (u) streams.push({ url: u, quality: q });
                    }
                }
            } catch (e) { /* */ }
        }
        // Fallback: hledat MP4 URL přímo
        if (!streams.length) {
            const mp4Match = html.match(/['"](https?:\/\/[^'"]+\.mp4[^'"]*)['"]/);
            if (mp4Match) streams.push({ url: mp4Match[1], quality: 'MP4' });
        }
        return streams;
    }
};

// ── ePorner ───────────────────────────────────────────────────────────────────
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
            const name = cleanText(link.attr('title') || $(el).find('.mbtitle, h3').text());
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.mbtit .right, .duration').text()),
                    quality: 'HD'
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        // ePorner používá hash ID pro API volání
        const hashMatch = html.match(/hash:\s*['"]([\w]+)['"]/i)
            || html.match(/videohash\s*=\s*['"]([\w]+)['"]/i)
            || html.match(/["']hash["']:\s*["']([\w]+)["']/i);
        if (hashMatch) {
            try {
                const hash = hashMatch[1];
                const apiUrl = `${this.baseUrl}/xhr/video/${hash}/?size=1&from=main&domain=eporner.com&seq=6&ref=`;
                const res = await axios.get(apiUrl, { headers: HEADERS, timeout: 15000 });
                const sources = res.data?.sources?.mp4 || {};
                const order = ['1080p', '720p', '480p', '360p'];
                for (const q of order) {
                    if (sources[q]) streams.push({ url: sources[q], quality: q });
                }
            } catch (e) {
                console.error('[eporner resolve api]', e.message);
            }
        }
        // Fallback: hledat MP4 přímo
        if (!streams.length) {
            const mp4Matches = [...html.matchAll(/['"](https?:\/\/[^'"]+\.mp4[^'"]*)['"]/g)];
            mp4Matches.slice(0, 2).forEach(m => streams.push({ url: m[1], quality: 'MP4' }));
        }
        return streams;
    }
};

// ── HQPorner ──────────────────────────────────────────────────────────────────
scrapers['hqporner'] = {
    baseUrl: 'https://hqporner.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/hdporn/page/${page}/?s=${encodeURIComponent(keyword)}`
            : `${this.baseUrl}/hdporn/page/${page}/`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('article.col-xs-12, .video-item').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('h2, h3, .title').first().text() || link.attr('title'));
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img,
                    quality: 'HD'
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        // HQPorner — jwplayer nebo file:
        const m3u8Match = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
        if (m3u8Match) streams.push({ url: m3u8Match[1], quality: 'HLS' });
        const mp4Matches = [...html.matchAll(/file:\s*["']([^"']+\.mp4[^"']*)["']/gi)];
        mp4Matches.forEach(m => {
            if (!streams.find(s => s.url === m[1]))
                streams.push({ url: m[1], quality: 'MP4' });
        });
        // jwplayer sources array
        if (!streams.length) {
            const jwMatch = html.match(/sources:\s*\[([^\]]+)\]/s);
            if (jwMatch) {
                const fileMatches = [...jwMatch[1].matchAll(/file["']?\s*:\s*["']([^"']+)["']/g)];
                fileMatches.forEach(fm => streams.push({ url: fm[1], quality: 'Stream' }));
            }
        }
        return streams;
    }
};

// ── TXXX ──────────────────────────────────────────────────────────────────────
scrapers['txxx'] = {
    baseUrl: 'https://www.txxx.com',
    async list(page = 1, keyword = null) {
        let url = keyword
            ? `${this.baseUrl}/videos/search:${encodeURIComponent(keyword)}/?from=${(page - 1) * 24}`
            : `${this.baseUrl}/videos/?from=${(page - 1) * 24}`;
        const html = await getHtml(url, this.baseUrl);
        const $ = cheerio.load(html);
        const videos = [];
        $('div.item-video, .thumb').each((i, el) => {
            const link = $(el).find('a').first();
            const href = link.attr('href') || '';
            const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
            const name = cleanText($(el).find('.title').text() || link.attr('title'));
            if (href && name) {
                videos.push({
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                    name, img,
                    duration: cleanText($(el).find('.time, .duration').text())
                });
            }
        });
        return videos;
    },
    async resolve(pageUrl) {
        const html = await getHtml(pageUrl, this.baseUrl);
        const streams = [];
        // TXXX používá playerConfigs
        const playerMatch = html.match(/playerConfigs\s*=\s*({[\s\S]+?});/);
        if (playerMatch) {
            try {
                const pc = JSON.parse(playerMatch[1]);
                const sources = pc?.videos?.mp4 || pc?.sources || {};
                const order = ['1080p', '720p', '480p', '360p', '240p'];
                for (const q of order) {
                    if (sources[q]) streams.push({ url: sources[q], quality: q });
                }
            } catch (e) { /* */ }
        }
        // Fallback: hledej MP4
        if (!streams.length) {
            const mp4Match = html.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
            if (mp4Match) streams.push({ url: mp4Match[1], quality: 'MP4' });
        }
        // Fallback 2: jwplayer file
        if (!streams.length) {
            const jwFile = html.match(/file:\s*["']([^"']+)["']/);
            if (jwFile) streams.push({ url: jwFile[1], quality: 'Stream' });
        }
        return streams;
    }
};

// ── Beeg ──────────────────────────────────────────────────────────────────────
scrapers['beeg'] = {
    baseUrl: 'https://beeg.com',
    async list(page = 1, keyword = null) {
        try {
            const apiBase = 'https://beeg.com/api/v6';
            let url = keyword
                ? `${apiBase}/index?q=${encodeURIComponent(keyword)}&page=${page}&format=json`
                : `${apiBase}/index?page=${page}&format=json`;
            const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
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
            console.error('[beeg list]', e.message);
            return [];
        }
    },
    async resolve(pageUrl) {
        const streams = [];
        const idMatch = pageUrl.match(/beeg\.com\/(\d+)/);
        if (idMatch) {
            try {
                const apiUrl = `https://beeg.com/api/v6/video?id=${idMatch[1]}&format=json`;
                const res = await axios.get(apiUrl, { headers: HEADERS, timeout: 15000 });
                const data = res.data;
                const sign = data.data_sign || data.sign || '';
                const order = ['2160p', '1080p', '720p', '480p', '360p', '240p'];
                for (const q of order) {
                    if (data[q]) {
                        const url = sign ? data[q].replace('{DATA_SIGN}', sign) : data[q];
                        streams.push({ url, quality: q });
                    }
                }
            } catch (e) {
                console.error('[beeg resolve]', e.message);
            }
        }
        return streams;
    }
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
    getSiteList: () => SITES,
    getScraper: (id) => scrapers[id] || null
};
