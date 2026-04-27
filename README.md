# 🐕 WOL-Alexa-Full-Control

**The ultimate, free, and secure way to Turn ON, OFF, or SLEEP your PCs via Alexa.** 🚀🖥️

Tired of paid Alexa skills or complex setups? This project allows you to create your own **Private Smart Home Skill** to manage your computers using your Amazon Echo. No physical hardware bridge required—just the cloud and a lightweight Windows agent.

---

### 🔥 Key Features:
- **Full Power Control**: Turn ON (Wake-on-LAN) and Turn OFF / SLEEP / HIBERNATE your PC.
- **Multi-Device Support**: Manage as many computers as you want (e.g., "Alexa, turn on Gaming PC", "Alexa, turn off Office").
- **Windows Agent (Ready to use)**: Pre-compiled executable that lives in your system tray.
- **Secure SHA-256 Bridge**: Encrypted communication between Alexa and your PC using your private hash.
- **Modern Dashboard**: Sleek *Glassmorphism* interface to manage your devices.
- **100% Free**: Operates entirely within the free tiers of Vercel, Upstash (Redis), and AWS.

---

### 🚀 Step-by-Step Setup Guide:

#### 1. Database Setup (Upstash Redis)
- Sign up at [Upstash](https://upstash.com).
- Create a new **Redis** database.
- Scroll down to the "REST API" section and copy both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. You will need these for Vercel.

#### 2. Cloud Deployment (Vercel)
- Fork/Clone this repository to your GitHub.
- Create a new project in [Vercel](https://vercel.com) and connect your repository.
- Go to **Left Menu > Environment Variables** and add the following:
  - `UPSTASH_REDIS_REST_URL`: (from Step 1).
  - `UPSTASH_REDIS_REST_TOKEN`: (from Step 1).
  - `ADMIN_PASSWORD`: Choose a secret password. You will use this to access the dashboard and as the "Security Key" for the Windows Agent.
- Deploy the project. Copy your deployment URL (e.g., `https://your-app.vercel.app`).

#### 3. Alexa & AWS Lambda Integration
Alexa needs a "bridge" to talk to Vercel.
- **AWS Lambda**: Create a new function (Runtime: Node.js 18+). 
- Copy the code from `/bridge/lambda_bridge.js` in this repo and paste it into the Lambda editor.
- **IMPORTANT**: Change the `vercelUrl` variable in the code to your actual Vercel URL: `https://your-app.vercel.app/api/alexa`.
- Add an **Alexa Smart Home** trigger to your Lambda and copy the Lambda **ARN** (top right corner).

- **Alexa Developer Console**: Create a new **Smart Home** skill.
  - In **Smart Home Service Endpoint**, paste your Lambda **ARN**.
  - In **Account Linking**, provide these Vercel endpoints:
    - Authorization URI: `https://your-app.vercel.app/api/auth`
    - Access Token URI: `https://your-app.vercel.app/api/token`
    - Client ID: `anything` (not checked in this private setup).
    - Client Secret: `anything`

#### 4. The Windows Agent (Power Off/Sleep)
- Go to the **Releases** section of this GitHub repository.
- Download the `agent.exe` file.
- Run it on the PC you wish to control.
- **Configuration**:
  - Enter the **MAC Address** of the PC (must match what you enter in the web dashboard).
  - Enter the **Security Key** (the `ADMIN_PASSWORD` you set in Vercel).
  - Click **Connect & Save**.
- The agent will minimize to the **System Tray**. Right-click the icon to restore or exit.

---

### 🗣️ Usage
1. Open your Vercel Dashboard, log in with your password, and add your PC's name and MAC address.
2. Tell Alexa: **"Alexa, discover my devices"**.
3. Once found:
   - *"Alexa, turn ON [Device Name]"*
   - *"Alexa, turn OFF [Device Name]"* (Action: Sleep/Shutdown as selected in the Agent).

---

### 🛡️ Security & Privacy
Communication between Vercel and your PC is routed through [ntfy.sh](https://ntfy.sh) using a unique, unguessable topic ID. This ID is generated using a **SHA-256 hash** of your MAC + your private Key. No one can trigger your PC without knowing your secret password.

---

### 📜 License
Licensed under the MIT License. Developed with ❤️ by **FlowersPowerz**.

*If you like this project, please give it a ⭐!*
