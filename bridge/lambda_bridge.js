import https from 'https';

export const handler = async (event) => {
    const vercelUrl = 'https://YOUR-PROJECT.vercel.app/api/alexa';

    const body = JSON.stringify(event);
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(vercelUrl, options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => resolve(JSON.parse(responseBody)));
        });

        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
};
