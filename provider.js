const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://ctgmovies.com";

function fixUrl(url) {
    if (!url) return null;
    try {
        if (url.includes('/_next/image?url=')) {
            const encoded = url.split('/_next/image?url=')[1].split('&')[0];
            return decodeURIComponent(encoded);
        }
        return url;
    } catch (e) {
        return url;
    }
}

function unescapeNextString(input) {
    if (!input) return "";
    return input.replace(/\\u([0-9a-fA-F]{4})/g, match => {
        return String.fromCharCode(parseInt(match.slice(2), 16));
    });
}

function extractRscData(html) {
    try {
        const regex = /self\.__next_f\.push\(\[1,"(.*?)"]\)/g;
        let match;
        let combinedPayload = "";
        while ((match = regex.exec(html)) !== null) {
            combinedPayload += unescapeNextString(match[1]);
        }

        if (combinedPayload.trim() === "") return { details: null, episodes: [], links: [] };

        const $ = cheerio.load(combinedPayload);
        const links = [];
        const episodes = [];
        let details = null;

        $('[data-testid="media-link"], a[href*="video"], a[href*=".mp4"]').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text();
            if (href && (href.includes('.mp4') || href.includes('.m3u8') || href.includes('http'))) {
                links.push({
                    url: fixUrl(href),
                    quality: text.toLowerCase().includes('4k') ? '4K' : text.toLowerCase().includes('1080') ? '1080p' : text.toLowerCase().includes('720') ? '720p' : 'Direct',
                    source: 'CTGMovies'
                });
            }
        });

        return { details, episodes, links };
    } catch (e) {
        console.error("RSC Extraction Error:", e.message);
        return { details: null, episodes: [], links: [] };
    }
}

class CTGMoviesProvider {
    constructor() {
        this.baseUrl = BASE_URL;
    }

    async getMeta(input) {
        if (input.type === 'tv' && !input.id.includes('.com/')) {
            return {
                id: input.id,
                name: "CTGMovies",
                type: input.type,
                poster: "https://raw.githubusercontent.com/streamparser/extensions/master/media/icons/ctgmovies.png",
                background: "https://raw.githubusercontent.com/streamparser/extensions/master/media/icons/ctgmovies.png"
            };
        }

        const url = input.id || input.url;

        try {
            const response = await axios.get(url);
            const html = response.data;
            const $ = cheerio.load(html);
            const rscData = extractRscData(html);

            let title = rscData.details?.title || rscData.details?.name ||
                        $('h1').first().text().trim().split('(')[0].trim() ||
                        $('meta[property="og:title"]').attr('content')?.split('(')[0].trim();

            let year = rscData.details?.year;
            if (!year && title) {
                const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);
                if (yearMatch) year = parseInt(yearMatch[0]);
            }

            let poster = fixUrl(rscData.details?.posterUrl ||
                                $('meta[property="og:image"]').attr('content') ||
                                $('img[src*="/poster"], img[data-src*="/poster"]').first().attr('src'));

            let background = fixUrl(rscData.details?.backdropUrl ||
                                    $('meta[property="og:image:secure_url"]').attr('content'));

            let description = rscData.details?.overview ||
                              $('section:contains("Synopsis") p').text().trim() ||
                              $('meta[name="description"]').attr('content');

            const imdbMatch = html.match(/"imdb_id"\s*:\s*"([^"]+)"/);
            const imdbId = imdbMatch ? imdbMatch[1] : null;

            return {
                id: url,
                name: title,
                type: input.type === 'tv' ? 'tvseries' : 'movie',
                year: year,
                poster: poster,
                background: background,
                duration: rscData.details?.runtime,
                description: description,
                country: "Unknown",
                genres: rscData.details?.genres ? rscData.details.genres.split(',') : [],
                imdbId: imdbId
            };

        } catch (error) {
            console.error("Meta Fetch Error:", error.message);
            return null;
        }
    }

    async getStream(input) {
        const url = input.id || input.url;
        const streams = [];

        try {
            const response = await axios.get(url);
            const html = response.data;
            const $ = cheerio.load(html);

            const rscData = extractRscData(html);
            rscData.links.forEach(link => {
                if (link.url) {
                    streams.push({
                        name: `${link.quality} (${link.source})`,
                        url: link.url,
                        quality: link.quality,
                        source: link.source,
                        season: input.season || 1,
                        episode: input.episode || 1
                    });
                }
            });

            if (streams.length === 0) {
                $('a[href*=".mp4"], a[href*=".mkv"], a[href*=".m3u8"]').each((i, el) => {
                    const href = $(el).attr('href');
                    const text = $(el).text();

                    if (href && href.includes('http')) {
                        let quality = 'Direct';
                        const t = text.toLowerCase();
                        if (t.includes('4k') || t.includes('2160')) quality = '4K';
                        else if (t.includes('1080')) quality = '1080p';
                        else if (t.includes('720')) quality = '720p';
                        else if (t.includes('480')) quality = '480p';

                        streams.push({
                            name: `${quality} (Direct)`,
                            url: fixUrl(href),
                            quality: quality,
                            source: 'Direct',
                            season: input.season || 1,
                            episode: input.episode || 1
                        });
                    }
                });
            }

            $('a[href*=".srt"], a[href*=".vtt"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.includes('http')) {
                    const lang = href.toLowerCase().includes('hin') ? 'Hindi' : 'English';
                    streams.push({
                        name: `${lang} Subtitles`,
                        url: fixUrl(href),
                        quality: 'subtitle',
                        source: 'Subtitle',
                        season: input.season || 1,
                        episode: input.episode || 1
                    });
                }
            });

        } catch (error) {
            console.error("Stream Fetch Error:", error.message);
        }

        return streams;
    }
}

module.exports = CTGMoviesProvider;
