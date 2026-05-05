import { Redis } from '@upstash/redis'
import crypto from 'crypto'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const ALEXA_EVENT_GATEWAY = 'https://api.amazonalexa.com/v3/events';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

export default async function handler(req, res) {
  const request = req.body;
  if (!request || !request.directive) return res.status(400).end();

  const namespace = request.directive.header.namespace;
  const name = request.directive.header.name;

  console.log(`Incoming: ${namespace} / ${name}`);

  if (namespace === 'Alexa.Discovery' && name === 'Discover') {
    return handleDiscovery(request, res);
  }

  if (namespace === 'Alexa.Authorization' && name === 'AcceptGrant') {
    return handleAcceptGrant(request, res);
  }

  if (namespace === 'Alexa.PowerController') {
    return handlePowerControl(request, res);
  }

  if (namespace === 'Alexa' && name === 'ReportState') {
    return handleReportState(request, res);
  }

  return res.status(200).json({
    event: {
      header: {
        namespace: "Alexa",
        name: "Response",
        messageId: request.directive.header.messageId + "-R",
        payloadVersion: "3"
      },
      payload: {}
    }
  });
}

async function handleAcceptGrant(request, res) {
  const messageId = request.directive.header.messageId;
  const code = request.directive.payload.grant.code;

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: process.env.ALEXA_CLIENT_ID,
      client_secret: process.env.ALEXA_CLIENT_SECRET,
    });

    const tokenRes = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      throw new Error(`No access token returned: ${JSON.stringify(tokens)}`);
    }

    await redis.set('alexa_tokens', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
    });

    console.log('Alexa tokens stored.');

    return res.status(200).json({
      event: {
        header: {
          namespace: "Alexa.Authorization",
          name: "AcceptGrant.Response",
          messageId: messageId + "-R",
          payloadVersion: "3"
        },
        payload: {}
      }
    });
  } catch (err) {
    console.error("AcceptGrant Error:", err);
    return res.status(200).json({
      event: {
        header: {
          namespace: "Alexa.Authorization",
          name: "ErrorResponse",
          messageId: messageId + "-R",
          payloadVersion: "3"
        },
        payload: {
          type: "ACCEPT_GRANT_FAILED",
          message: err.message
        }
      }
    });
  }
}

async function getAccessToken() {
  const stored = await redis.get('alexa_tokens');
  if (!stored) throw new Error('No Alexa tokens stored. Disable and re-enable the skill in the Alexa app.');

  if (Date.now() > stored.expires_at - 300000) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: process.env.ALEXA_CLIENT_ID,
      client_secret: process.env.ALEXA_CLIENT_SECRET,
    });

    const tokenRes = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(tokens)}`);

    const newStored = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || stored.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
    };
    await redis.set('alexa_tokens', newStored);
    return tokens.access_token;
  }

  return stored.access_token;
}

async function handleDiscovery(request, res) {
  try {
    const messageId = request.directive.header.messageId;
    const devices = await redis.get('wol_devices') || [];

    const formatMac = (rawMac) => {
      const clean = rawMac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
      if (clean.length !== 12) return clean;
      return clean.match(/.{1,2}/g).join('-');
    };

    const endpoints = devices.map(config => {
      const cleanId = config.mac.replace(/[: -]/g, '').toLowerCase();

      return {
        endpointId: "endpoint-" + cleanId,
        manufacturerName: "FlowersPowerz",
        friendlyName: config.name,
        description: `PC WoL: ${config.name}`,
        displayCategories: ["COMPUTER"],
        cookie: {},
        capabilities: [
          {
            type: "AlexaInterface",
            interface: "Alexa.WakeOnLANController",
            version: "3",
            properties: {},
            configuration: {
              MACAddresses: [formatMac(config.mac)]
            }
          },
          {
            type: "AlexaInterface",
            interface: "Alexa.PowerController",
            version: "3",
            properties: {
              supported: [{ name: "powerState" }],
              proactivelyReported: true,
              retrievable: true
            }
          },
          {
            type: "AlexaInterface",
            interface: "Alexa.EndpointHealth",
            version: "3",
            properties: {
              supported: [{ name: "connectivity" }],
              proactivelyReported: true,
              retrievable: true
            }
          },
          {
            type: "AlexaInterface",
            interface: "Alexa",
            version: "3"
          }
        ]
      };
    });

    return res.status(200).json({
      event: {
        header: {
          namespace: "Alexa.Discovery",
          name: "Discover.Response",
          messageId: messageId + "-R",
          payloadVersion: "3"
        },
        payload: { endpoints }
      }
    });
  } catch (err) {
    console.error("Discovery Error:", err);
    return res.status(500).json({ error: "Internal Error" });
  }
}

async function handleReportState(request, res) {
  const { header, endpoint } = request.directive;

  return res.status(200).json({
    context: {
      properties: [
        {
          namespace: "Alexa.PowerController",
          name: "powerState",
          value: "OFF",
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0
        },
        {
          namespace: "Alexa.EndpointHealth",
          name: "connectivity",
          value: { value: "OK" },
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0
        }
      ]
    },
    event: {
      header: {
        namespace: "Alexa",
        name: "StateReport",
        messageId: header.messageId + "-R",
        correlationToken: header.correlationToken,
        payloadVersion: "3"
      },
      endpoint: { endpointId: endpoint.endpointId },
      payload: {}
    }
  });
}

async function handlePowerControl(request, res) {
  const { header, endpoint } = request.directive;
  const correlationToken = header.correlationToken;
  const messageId = header.messageId;
  const endpointId = endpoint.endpointId;
  const name = header.name;

  console.log(`Power Control: ${name} for ${endpointId}`);

  if (name === 'TurnOn') {
    try {
      const accessToken = await getAccessToken();

      const wakeUpEvent = {
        context: {
          properties: [{
            namespace: "Alexa.PowerController",
            name: "powerState",
            value: "OFF",
            timeOfSample: new Date().toISOString(),
            uncertaintyInMilliseconds: 500
          }]
        },
        event: {
          header: {
            namespace: "Alexa.WakeOnLANController",
            name: "WakeUp",
            messageId: crypto.randomUUID(),
            correlationToken: correlationToken,
            payloadVersion: "3"
          },
          endpoint: {
            scope: {
              type: "BearerToken",
              token: accessToken
            },
            endpointId: endpointId
          },
          payload: {}
        }
      };

      const gatewayRes = await fetch(ALEXA_EVENT_GATEWAY, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(wakeUpEvent)
      });

      if (!gatewayRes.ok) {
        const errText = await gatewayRes.text();
        console.error(`WakeUp event failed: ${gatewayRes.status} ${errText}`);
      } else {
        console.log(`WakeUp event sent, status: ${gatewayRes.status}`);
      }

      return res.status(200).json({
        event: {
          header: {
            namespace: "Alexa",
            name: "Response",
            messageId: messageId + "-R",
            correlationToken: correlationToken,
            payloadVersion: "3"
          },
          endpoint: { endpointId: endpointId },
          payload: {}
        },
        context: {
          properties: [{
            namespace: "Alexa.PowerController",
            name: "powerState",
            value: "ON",
            timeOfSample: new Date().toISOString(),
            uncertaintyInMilliseconds: 500
          }]
        }
      });
    } catch (err) {
      console.error("TurnOn Error:", err);
      return res.status(200).json({
        event: {
          header: {
            namespace: "Alexa",
            name: "ErrorResponse",
            messageId: messageId + "-R",
            correlationToken: correlationToken,
            payloadVersion: "3"
          },
          endpoint: { endpointId: endpointId },
          payload: {
            type: "INTERNAL_ERROR",
            message: err.message
          }
        }
      });
    }
  }

  if (name === 'TurnOff') {
    const cleanId = endpointId.replace('endpoint-', '');
    const adminPassword = process.env.ADMIN_PASSWORD || "";

    const secretHash = crypto.createHash('sha256')
                             .update(cleanId + adminPassword)
                             .digest('hex')
                             .substring(0, 20);

    const topic = `wol_${secretHash}`;

    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: 'off'
      });
      console.log(`Sent shutdown command to topic: ${topic}`);
    } catch (err) {
      console.error("Error sending to ntfy:", err);
    }
  }

  return res.status(200).json({
    event: {
      header: {
        namespace: "Alexa",
        name: "Response",
        messageId: messageId + "-R",
        correlationToken: correlationToken,
        payloadVersion: "3"
      },
      endpoint: { endpointId: endpointId },
      payload: {}
    },
    context: {
      properties: [
        {
          namespace: "Alexa.PowerController",
          name: "powerState",
          value: name === "TurnOn" ? "ON" : "OFF",
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0
        },
        {
          namespace: "Alexa.EndpointHealth",
          name: "connectivity",
          value: { value: "OK" },
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0
        }
      ]
    }
  });
}
