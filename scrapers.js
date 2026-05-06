const axios = require('axios');
const cheerio = require('cheerio');
const base64 = require('buffer');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
};

async function getHtml(url, referer = '') {
    const hdrs = { ...HEADERS };
    if (referer) hdrs['Referer'] = referer;
    const res = await axios.get(url, { headers: hdrs, timeout: 25000, maxRedirects: 5 });
    return res.data;
}

async function getJson(url, referer = '') {
    const hdrs = { ...HEADERS, 'Accept': 'application/json, text/javascript, */*; q=0.01' };
    if (referer) hdrs['Referer'] = referer;
    const res = await axios.get(url, { headers: hdrs, timeout: 25000 });
    return res.data;
}

// ── TXXX decrypter (přesně jako Kodi originál) ───────────────────────────────
function txxxDecode(vidurl) {
    const replacemap = {
        '\u041c': 'M', '\u0410': 'A', '\u0412': 'B',
        '\u0421': 'C', '\u0415': 'E', '~': '=', '.': '+', ',': '/'
    };
    let s = vidurl;
    for (const [from, to] of Object.entries(replacemap)) {
        s = s.split(from).join(to);
    }
    return Buffer.from(s, 'base64').toString('utf-8');
}

// ─── SITES ────────────────────────────────────────────────────────────────────
const SITES = [
    { id: 'xvideos',  name: 'xVideos' },
    { id: 'upornia',  name: 'Upornia' },
    { id: 'drtuber',  name: 'DrTuber' },
    { id: 'pornkai',  name: 'PornKai' },
];

const scrapers = {};

// ── xVideos ───────────────────────────────────────────────────────────────────
scrapers['xvideos'] = {
    baseUrl: 'https://www.xvideos.com',
    async list(page = 1, keyword = null) {
        let url;
        if (keyword) {
            url = `${this.baseUrl}/?k=${encodeURIComponent(keyword)}&p=${page - 1}`;
        } else {
            url = `${this.baseUrl}/new/${page > 1 ? page : ''}`;
        }
        const html = await getHtml(url, this.baseUrl);
        const videos = [];
        // Přesný regex z Kodi originálu
        const re = /div id="video.+?href="([^"]+)".+?data-src="([^"]+)"([\s\S]+?)title="([^"]+)">.+?duration">([^<]+)</g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const [, videopage, img, res, name, duration] = m;
            const resMatch = res.match(/mark">(.+?)</);
            videos.push({
                url: this.baseUrl + videopage,
                name: name.replace(/&#039;/g, "'").replace(/&amp;/g, '&').trim(),
                img: img.replace('THUMBNUM', '5'),
                duration: duration.trim(),
                quality: resMatch ? resMatch[1] : ''
            });
        }
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

// ── Upornia (TXXX engine) ─────────────────────────────────────────────────────
// Upornia používá stejné API jako txxx, hclips, hdzog, hotmovs atd.
scrapers['upornia'] = {
    baseUrl: 'https://upornia.com/',
    // API endpoint přesně podle Kodi originálu
    apiUrl(siteurl, endpoint, page = 1) {
        return `${siteurl}api/json/videos/86400/str/${endpoint}/60///${page}/day.json`;
    },
    searchUrl(siteurl, keyword, page = 1) {
        return `${siteurl}api/videos.php?params=259200/str/relevance/60/search..${encodeURIComponent(keyword)}.all..&s=${page}&sort=latest-updates&date=all&type=all&duration=all`;
    },
    async list(page = 1, keyword = null) {
        const siteurl = this.baseUrl;
        let url;
        if (keyword) {
            url = this.searchUrl(siteurl, keyword, page);
        } else {
            url = this.apiUrl(siteurl, 'latest-updates', page);
        }
        try {
            const jdata = await getJson(url, siteurl);
            if (!jdata.videos) return [];
            return jdata.videos.map(item => {
                const hd = item.props?.hd === '1' || (item.categories || '').includes('HD');
                return {
                    url: siteurl + item.video_id,
                    name: (item.title || '').trim(),
                    img: item.scr || '',
                    duration: item.duration || '',
                    quality: hd ? 'HD' : ''
                };
            });
        } catch (e) {
            console.error('[upornia list]', e.message);
            return [];
        }
    },
    async resolve(pageUrl) {
        // Přesně podle Kodi: api/videofile.php + txxxDecode
        const siteurl = this.baseUrl;
        const videoId = pageUrl.replace(siteurl, '').split('/')[0];
        try {
            const apiUrl = `${siteurl}api/videofile.php?video_id=${videoId}&lifetime=8640000`;
            const data = await getHtml(apiUrl, siteurl);
            const r = data.match(/video_url":"([^"]+)/);
            if (r) {
                const decoded = txxxDecode(r[1]);
                const finalUrl = decoded.startsWith('http') ? decoded : siteurl.slice(0, -1) + decoded;
                return [{ url: finalUrl, quality: 'HD' }];
            }
        } catch (e) {
            console.error('[upornia resolve]', e.message);
        }
        return [];
    },
    // Načti kategorie z API (přesně jako Kodi Categories funkce)
    async getCategories() {
        try {
            const url = `${this.baseUrl}api/json/categories/14400/str.all.en.json`;
            const jdata = await getJson(url, this.baseUrl);
            return (jdata.categories || []).map(c => ({
                name: c.title,
                dir: c.dir,
                count: c.total_videos
            }));
        } catch (e) {
            console.error('[upornia categories]', e.message);
            return [];
        }
    }
};

// ── DrTuber ───────────────────────────────────────────────────────────────────
scrapers['drtuber'] = {
    baseUrl: 'https://www.drtuber.com/',
    async list(page = 1, keyword = null) {
        let url;
        if (keyword) {
            url = `${this.baseUrl}search/videos/${encodeURIComponent(keyword.replace(/ /g, '+'))}`;
            if (page > 1) url += `/page/${page}`;
        } else {
            url = page > 1 ? `${this.baseUrl}${page}` : this.baseUrl;
        }
        try {
            const html = await getHtml(url, this.baseUrl);
            const listhtml = html.split('</h1>').pop();
            const videos = [];
            // Regex přesně podle Kodi originálu
            const delimiter = ' <a href="/video';
            const parts = listhtml.split(delimiter);
            parts.shift();
            for (const part of parts) {
                const vpMatch = part.match(/^([^"]+)" class="/);
                const nameMatch = part.match(/alt="([^"]+)"/);
                const imgMatch = part.match(/src="([^"]+)"/);
                const durMatch = part.match(/class="time_thumb[\s\S]+?<em>([^<]+)<\/em>\s*<\/em>/);
                const qualMatch = part.match(/class="quality[^"]*"(?:><i class="ico_|>)([^<"]+)/);
                if (vpMatch && nameMatch) {
                    videos.push({
                        url: `${this.baseUrl}video${vpMatch[1]}`,
                        name: nameMatch[1].replace(/&amp;/g, '&').trim(),
                        img: imgMatch ? imgMatch[1] : '',
                        duration: durMatch ? durMatch[1].trim() : '',
                        quality: qualMatch ? qualMatch[1].trim() : ''
                    });
                }
            }
            return videos;
        } catch (e) {
            console.error('[drtuber list]', e.message);
            return [];
        }
    },
    async resolve(pageUrl) {
        // DrTuber API: player_config_json
        try {
            const videoId = pageUrl.split('/').filter(Boolean).find(p => /^\d+$/.test(p));
            if (!videoId) return [];
            const jsonUrl = `${this.baseUrl}player_config_json/?vid=${videoId}&aid=0&domain_id=0&embed=0&ref=null&check_speed=0`;
            const hdrs = { ...HEADERS, 'accept': 'application/json, text/javascript, */*; q=0.01', 'Referer': pageUrl };
            const res = await axios.get(jsonUrl, { headers: hdrs, timeout: 15000 });
            const data = res.data;
            const files = data.files || {};
            const streams = [];
            // Přesně z Kodi: lq=480p, hq=720p, 4k=2160p
            if (files['4k']) streams.push({ url: files['4k'], quality: '2160p' });
            if (files['hq']) streams.push({ url: files['hq'], quality: '720p' });
            if (files['lq']) streams.push({ url: files['lq'], quality: '480p' });
            return streams;
        } catch (e) {
            console.error('[drtuber resolve]', e.message);
            return [];
        }
    }
};

// ── PornKai ───────────────────────────────────────────────────────────────────
scrapers['pornkai'] = {
    baseUrl: 'https://pornkai.com/',
    async list(page = 1, keyword = null) {
        // PornKai má JSON API přesně jako v Kodi
        let url;
        if (keyword) {
            url = `${this.baseUrl}api?query=${encodeURIComponent(keyword)}&sort=best&page=${page - 1}&method=search`;
        } else {
            url = `${this.baseUrl}api?query=&sort=new&page=${page - 1}&method=search`;
        }
        try {
            let html = await getHtml(url, this.baseUrl);
            html = html.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
            const videos = [];
            const delimiter = '<div class="thumbnail">';
            const parts = html.split(delimiter);
            parts.shift();
            for (const part of parts) {
                const hrefMatch = part.match(/href="([^"]+)"/);
                const nameMatch = part.match(/<span class="trigger_pop th_wrap">([^<]+)<\/span>/);
                const imgMatch = part.match(/src='([^']+)'/);
                const durMatch = part.match(/fa-clock"><\/i>([^<]+)</);
                if (hrefMatch && nameMatch) {
                    videos.push({
                        url: hrefMatch[1].startsWith('http') ? hrefMatch[1] : this.baseUrl + hrefMatch[1],
                        name: nameMatch[1].trim(),
                        img: imgMatch ? imgMatch[1] : '',
                        duration: durMatch ? durMatch[1].trim() : ''
                    });
                }
            }
            return videos;
        } catch (e) {
            console.error('[pornkai list]', e.message);
            return [];
        }
    },
    async resolve(pageUrl) {
        // PornKai embeds xHamster iframe — přesně jako Kodi
        try {
            const html = await getHtml(pageUrl, this.baseUrl);
            const iframeMatch = html.match(/iframe[\s\S]+?src="([^"]+)"/i);
            if (!iframeMatch) return [];
            let iframeUrl = iframeMatch[1];

            // xh. shortlink
            if (iframeUrl.includes('//xh.')) {
                const res = await axios.get(iframeUrl, { headers: HEADERS, maxRedirects: 10, timeout: 15000 });
                iframeUrl = res.request.res.responseUrl || iframeUrl;
            }

            // xHamster embed resolver
            if (iframeUrl.includes('xhamster')) {
                const embedHtml = await getHtml(iframeUrl, pageUrl);
                const jsonMatch = embedHtml.split('window.initials=')[1]?.split(';</script>')[0];
                if (jsonMatch) {
                    const jdata = JSON.parse(jsonMatch);
                    const sources = jdata?.videoModel?.sources?.mp4 || jdata?.video?.sources?.mp4 || {};
                    const streams = [];
                    for (const q of ['1080p', '720p', '480p', '360p']) {
                        if (sources[q]) streams.push({ url: sources[q], quality: q });
                    }
                    if (streams.length) return streams;
                }
            }

            // Obecný fallback: hledat MP4 v iframe stránce
            const iHtml = await getHtml(iframeUrl, pageUrl);
            const mp4Match = iHtml.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/);
            if (mp4Match) return [{ url: mp4Match[1], quality: 'MP4' }];

        } catch (e) {
            console.error('[pornkai resolve]', e.message);
        }
        return [];
    }
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
    getSiteList: () => SITES,
    getScraper: (id) => scrapers[id] || null
};
