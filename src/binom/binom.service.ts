import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

@Injectable()
export class BinomService {
    private readonly logger = new Logger(BinomService.name);
    private readonly binomTrackingUrl: string; // For server-to-server tracking calls
    private readonly binomUserUrl: string; // For user-facing links
    private readonly binomSource: string; // TG_ID1 constant for source parameter

    constructor() {
        // BINOM_SOURCE is the TG_ID1 constant for the source parameter
        this.binomSource = process.env.BINOM_SOURCE || '';

        // BINOM_URL is for server tracking calls (e.g., tracktunnel.sbs)
        const binomUrl = process.env.BINOM_URL;
        if (binomUrl) {
            this.binomTrackingUrl = binomUrl;
        } else {
            this.logger.warn('BINOM_URL environment variable is not set');
        }

        // BINOM_USER_URL is for user-facing links (e.g., mainbin2m.club)
        // Falls back to BINOM_URL if not set
        const binomUserUrl = process.env.BINOM_USER_URL || binomUrl;
        if (binomUserUrl) {
            this.binomUserUrl = binomUserUrl;
        } else {
            this.logger.warn('BINOM_USER_URL and BINOM_URL environment variables are not set');
        }
    }

    /**
     * Forms a Binom URL for user-facing links (what users click on)
     * @param adid - Telegram channel name (from deeplink)
     * @param sub2 - User Telegram alias/username
     * @param addinfo - Optional button title/name
     * @param userId - Optional Telegram user ID for tgsubid parameter
     * @returns Complete Binom user-facing URL
     */
    formUserUrl(adid: string, sub2: string, addinfo?: string, userId?: number): string {
        if (!this.binomUserUrl) {
            this.logger.error('BINOM_USER_URL is not configured, cannot form user URL');
            return '';
        }

        return this.formUrl(this.binomUserUrl, adid, sub2, addinfo, userId);
    }

    /**
     * Forms a Binom URL for server tracking calls
     * @param adid - Telegram channel name (from deeplink)
     * @param sub2 - User Telegram alias/username
     * @param addinfo - Optional button title/name
     * @param userId - Optional Telegram user ID for tgsubid parameter
     * @returns Complete Binom tracking URL
     */
    formTrackingUrl(adid: string, sub2: string, addinfo?: string, userId?: number): string {
        if (!this.binomTrackingUrl) {
            this.logger.error('BINOM_URL is not configured, cannot form tracking URL');
            return '';
        }

        return this.formUrl(this.binomTrackingUrl, adid, sub2, addinfo, userId);
    }

    /**
     * Adds binom parameters to any base URL
     * This method can be used to add binom tracking parameters to external URLs
     * @param baseUrl - Any base URL to add binom parameters to
     * @param adid - Telegram channel name (from deeplink, can be empty)
     * @param sub2 - User Telegram alias/username
     * @param addinfo - Optional button title/name
     * @param userId - Optional Telegram user ID for tgsubid parameter
     * @returns URL with binom parameters added
     */
    addBinomParamsToUrl(baseUrl: string, adid: string, sub2: string, addinfo?: string, userId?: number): string {
        return this.formUrl(baseUrl, adid, sub2, addinfo, userId);
    }

    /**
     * Internal method to form a Binom URL with the provided base URL
     * @param baseUrl - Base URL to use
     * @param adid - Telegram channel name (from deeplink)
     * @param sub2 - User Telegram alias/username
     * @param addinfo - Optional button title/name
     * @param userId - Optional Telegram user ID for tgsubid parameter
     * @returns Complete Binom URL
     * 
     * Note: All parameter values are automatically URL-encoded by url.searchParams.set()
     */
    private formUrl(baseUrl: string, adid: string, sub2: string, addinfo?: string, userId?: number): string {
        try {
            const url = new URL(baseUrl);
            
            // Required parameters for binom URLs (all added as GET parameters):
            // All values are automatically URL-encoded by searchParams.set()
            // {source} - TG_ID1 const
            if (this.binomSource) {
                url.searchParams.set('source', this.binomSource);
            }
            
            // {adid} - parsed deeplink
            url.searchParams.set('adid', adid);
            
            // {sub2} - user alias (username), ?alias= not needed
            url.searchParams.set('sub2', sub2);
            
            // {ts} - timestamp
            const timestamp = Math.floor(Date.now() / 1000).toString();
            url.searchParams.set('ts', timestamp);
            
            // {tgsubid} - telegram ID
            if (userId) {
                url.searchParams.set('tgsubid', String(userId));
            }
            
            // {addinfo} - if name is available
            if (addinfo && addinfo.trim() !== '') {
                url.searchParams.set('addinfo', addinfo);
            }
            
            // Note: All existing GET parameters from baseUrl are preserved
            // Only the required binom parameters above are added/overridden

            return url.toString();
        } catch (error) {
            this.logger.error('Error forming Binom URL:', error);
            return '';
        }
    }

    /**
     * Makes an HTTP GET request to the Binom tracking URL
     * @param url - The complete Binom tracking URL to call
     * @returns Promise that resolves when the request is complete
     */
    async httpCall(url: string): Promise<void> {
        if (!url) {
            this.logger.warn('Empty URL provided to httpCall');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                const urlObj = new URL(url);
                const client = urlObj.protocol === 'https:' ? https : http;
                
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                };

                const req = client.request(options, (res) => {
                    // Consume response data to free up memory
                    res.on('data', () => {});
                    res.on('end', () => {
                        this.logger.debug(`Binom tracking call completed: ${res.statusCode}`);
                        resolve();
                    });
                });

                req.on('error', (error) => {
                    this.logger.error('Error making Binom tracking call:', error);
                    // Don't reject to prevent breaking the bot flow
                    resolve();
                });

                req.setTimeout(5000, () => {
                    req.destroy();
                    this.logger.warn('Binom tracking call timeout');
                    resolve();
                });

                req.end();
            } catch (error) {
                this.logger.error('Error in httpCall:', error);
                // Don't reject to prevent breaking the bot flow
                resolve();
            }
        });
    }
}
