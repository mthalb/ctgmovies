const axios = require('axios');
const cheerio = require('cheerio');

// Base URL
const BASE_URL = "https://ctgmovies.com";

// Helper to fix URLs (Next.js proxy fix)
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

// Helper to unescape Next.js RSC internal strings (\uXXXX)
function unescapeNextString(input) {
    if (!input) return "";
    return input.replace(/\\u([0-9a-fA-F]{4})/g, match => {
        return String.fromCharCode(parseInt(match.slice(2), 16));
    });
}

// Helper to extract RSC Data (Next.js)
function extractRscData(html) {
    try {
        // Regex to find self.__next_f.push([1,"..."])
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

        // Look for link arrays in the RSC payload
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

// Main Provider Class for Stremio
class CTGMoviesProvider {
    constructor() {
        this.baseUrl = BASE_URL;
    }

    async getMeta(input) {
        // input.id is the URL (e.g., https://ctgmovies.com/movies/xyz)
        // Or for categories (handled by manifest usually, but we can add basic scraping here)
        if (input.type === 'tv' && !input.id.includes('.com/')) {
            // If it's a tv show without a specific ID, try to find it via search or return error
            // Stremio handles categories via manifest, so we usually just return the metadata object
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

            // 1. Extract Title
            let title = rscData.details?.title || rscData.details?.name || 
                        $('h1').first().text().trim().split('(')[0].trim() || 
                        $('meta[property="og:title"]').attr('content')?.split('(')[0].trim();
            
            // 2. Extract Year
            let year = rscData.details?.year;
            if (!year) {
                const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/);
                if (yearMatch) year = parseInt(yearMatch[0]);
            }

            // 3. Extract Poster
            let poster = fixUrl(rscData.details?.posterUrl || 
                                $('meta[property="og:image"]').attr('content') || 
                                $('img[src*="/poster"], img[data-src*="/poster"]').first().attr('src'));

            // 4. Extract Backdrop
            let background = fixUrl(rscData.details?.backdropUrl || 
                                    $('meta[property="og:image:secure_url"]').attr('content'));

            // 5. Extract Plot
            let description = rscData.details?.overview || 
                              $('section:contains("Synopsis") p').text().trim() ||
                              $('meta[name="description"]').attr('content');

            // 6. Extract IMDb/TMDB ID
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
            
            // Method A: Try to extract from RSC Data (Complex)
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

            // Method B: Fallback to DOM Scrubbing (Robust)
            if (streams.length === 0) {
                // Find all video links in a tags
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

            // 7. Extract Subtitles
            $('a[href*=".srt"], a[href*=".vtt"]').each((i, el) => {
                const href = $(el).attr('href');
                const lang = href.toLowerCase().includes('hin') ? 'Hindi' : 'English';
                if (href && href.includes('http')) {
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

// Export the provider
module.exports = CTGMoviesProvider;
