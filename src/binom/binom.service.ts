import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

@Injectable()
export class BinomService {
    private readonly logger = new Logger(BinomService.name);
    private readonly binomBaseUrl: string;

    constructor() {
        this.binomBaseUrl = `${process.env.BINOM_URL}&source=${process.env.BINOM_SOURCE}`;
        if (!this.binomBaseUrl) {
            this.logger.warn('BINOM_URL environment variable is not set');
        }
    }

    /**
     * Forms a Binom tracking URL with the provided parameters
     * @param adid - Telegram channel name (from deeplink)
     * @param sub2 - User Telegram alias/username
     * @param addinfo - Optional button title/name
     * @returns Complete Binom tracking URL
     */
    formUrl(adid: string, sub2: string, addinfo?: string): string {
        if (!this.binomBaseUrl) {
            this.logger.error('BINOM_URL is not configured, cannot form URL');
            return '';
        }

        try {
            const url = new URL(this.binomBaseUrl);
            
            // Add required parameters
            url.searchParams.set('adid', adid);
            url.searchParams.set('sub2', sub2);
            
            // Add optional parameters
            const timestamp = Math.floor(Date.now() / 1000).toString();
            url.searchParams.set('ts', timestamp);
            url.searchParams.set('status', 'off');
            url.searchParams.set('offcat', 'loans');
            url.searchParams.set('offname', 'creditseven');
            
            // Only add addinfo if it's defined, not null, and not empty
            if (addinfo && addinfo.trim() !== '') {
                url.searchParams.set('addinfo', addinfo);
            }

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
