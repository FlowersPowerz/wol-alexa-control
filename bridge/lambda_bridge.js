import https from 'https';

export const handler = async (event) => {
    const vercelUrl = 'https://YOUR-PROJECT.vercel.app/api/alexa';

    const namespace = event?.directive?.header?.namespace;
    const name = event?.directive?.header?.name;

    // TurnOn: respond directly so Alexa uses its built-in WakeOnLANController
    // to send the WoL magic packet from the Echo device on the local network
    if (namespace === 'Alexa.PowerController' && name === 'TurnOn') {
        const header = event.directive.header;
        const endpoint = event.directive.endpoint;
        return {
            event: {
                header: {
                    namespace: 'Alexa',
                    name: 'Response',
                    messageId: header.messageId + '-R',
                    correlationToken: header.correlationToken,
                    payloadVersion: '3'
                },
                endpoint: { endpointId: endpoint.endpointId },
                payload: {}
            },
            context: {
                properties: [
                    {
                        namespace: 'Alexa.PowerController',
                        name: 'powerState',
                        value: 'ON',
                        timeOfSample: new Date().toISOString(),
                        uncertaintyInMilliseconds: 0
                    }
                ]
            }
        };
    }

    // All other directives (TurnOff, Discovery, etc.) → forward to Vercel
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
