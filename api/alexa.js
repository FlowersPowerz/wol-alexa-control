import { Redis } from '@upstash/redis'
import crypto from 'crypto'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export default async function handler(req, res) {
  const request = req.body;
  if (!request || !request.directive) return res.status(400).end();

  const namespace = request.directive.header.namespace;
  const name = request.directive.header.name;

  if (namespace === 'Alexa.Discovery' && name === 'Discover') {
    return handleDiscovery(request, res);
  }

  if (namespace === 'Alexa.PowerController') {
    return handlePowerControl(request, res);
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

async function handleDiscovery(request, res) {
  try {
    const messageId = request.directive.header.messageId;
    const devices = await redis.get('wol_devices') || [];

    const endpoints = devices.map(config => {

      const cleanId = config.mac.replace(/[: -]/g, '').toLowerCase();

      const formatMac = (rawMac) => {
        const clean = rawMac.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
        if (clean.length !== 12) return clean;
        return clean.match(/.{1,2}/g).join(':');
      };

      return {
        endpointId: "endpoint-" + cleanId,
        manufacturerName: "FlowersPowerz",
        friendlyName: config.name,
        description: `PC WoL: ${config.name}`,
        displayCategories: ["COMPUTER"],
        capabilities: [
          {
            type: "AlexaInterface",
            interface: "Alexa.PowerController",
            version: "3",
            properties: {
              supported: [{ name: "powerState" }],
              proactivelyReported: false,
              retrievable: true
            }
          },
          {
            type: "AlexaInterface",
            interface: "Alexa.EndpointHealth",
            version: "3",
            properties: {
              supported: [{ name: "connectivity" }],
              proactivelyReported: false,
              retrievable: true
            }
          },
          {
            type: "AlexaInterface",
            interface: "Alexa.WakeOnLANController",
            version: "3",
            configuration: {
              MACAddresses: [formatMac(config.mac)]
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
        payload: {
          endpoints: endpoints
        }
      }
    });
  } catch (err) {
    console.error("Discovery Error:", err);
    return res.status(500).json({ error: "Internal Error" });
  }
}

async function sendWoLViaFritzBox(macAddress) {
  const fritzUrl = process.env.FRITZBOX_URL;
  const user = process.env.FRITZBOX_USER || '';
  const password = process.env.FRITZBOX_PASSWORD || '';

  if (!fritzUrl || !password) {
    console.error("Fritz!Box not configured: missing FRITZBOX_URL or FRITZBOX_PASSWORD");
    return;
  }

  const formatMac = (rawMac) => {
    const clean = rawMac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    return clean.match(/.{1,2}/g).join(':');
  };

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:X_AVM-DE_WakeOnLANByMACAddress xmlns:u="urn:dslforum-org:service:Hosts:1">
      <NewMACAddress>${formatMac(macAddress)}</NewMACAddress>
    </u:X_AVM-DE_WakeOnLANByMACAddress>
  </s:Body>
</s:Envelope>`;

  const credentials = Buffer.from(`${user}:${password}`).toString('base64');

  const response = await fetch(`${fritzUrl}/upnp/control/hosts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': '"urn:dslforum-org:service:Hosts:1#X_AVM-DE_WakeOnLANByMACAddress"',
      'Authorization': `Basic ${credentials}`
    },
    body: soapBody
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Fritz!Box WoL failed: ${response.status} ${text}`);
  } else {
    console.log(`Fritz!Box WoL sent for MAC: ${formatMac(macAddress)}`);
  }
}

async function handlePowerControl(request, res) {
  const { header, endpoint } = request.directive;
  const correlationToken = header.correlationToken;
  const messageId = header.messageId;
  const endpointId = endpoint.endpointId;
  const name = header.name;

  console.log(`Power Control: ${name} for ${endpointId}`);

  if (name === 'TurnOn') {
    const cleanId = endpointId.replace('endpoint-', '');

    try {
      const devices = await redis.get('wol_devices') || [];
      const device = devices.find(d => d.mac.replace(/[: -]/g, '').toLowerCase() === cleanId);

      if (device) {
        await sendWoLViaFritzBox(device.mac);
      } else {
        console.error(`Device not found for endpointId: ${endpointId}`);
      }
    } catch (err) {
      console.error("Error sending WoL via Fritz!Box:", err);
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
      console.log(`Sent secure shutdown command to topic: ${topic}`);
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
      endpoint: {
        endpointId: endpointId
      },
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
          value: {
            value: "OK"
          },
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0
        }
      ]
    }
  });
}
