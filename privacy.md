# Privacy Policy for BidLume

**Last Updated:** September 8, 2026

BidLume was previously named UpLens. Version 1.0.3 changes the brand, not the extension's identity or the storage keys used for existing settings and history.

BidLume is an open-source, privacy-focused extension. This policy explains what data the extension handles, where that data is stored, and when data may be sent to a third-party service selected by the user.

## 1. Data We Handle
BidLume does not operate an analytics or user-data server and does not maintain a user database. The extension does handle data required for its user-facing features: visible Upwork job content, skills or CV text you provide, API credentials you provide, analysis results, and interface preferences.

BidLume does not sell data, use it for advertising, or monitor websites outside the Upwork pages declared in the extension manifest.

## 2. Local Storage
Persistent extension data is stored **locally** on your device using `chrome.storage.local`. Data is sent off-device only when you explicitly use an optional AI feature, as described in Section 3. Locally stored data includes:
* **API Credentials:** Credentials you enter for the AI provider you choose.
* **Your Skills:** The skills you define in the settings or extract from your CV.
* **Analysis History:** The job postings you have analyzed and their analysis results.
* **Preferences:** UI settings such as theme and language.

The developer does not operate a server that receives or can access this locally stored data. When you explicitly use an optional AI feature, the selected provider receives only the request data described below.

## 3. Optional Third-Party AI Services
Local heuristic scoring does not require an AI provider. If you configure and invoke AI analysis or CV skill extraction, BidLume sends the data needed for that request to the provider you selected (for example OpenAI, Google Gemini, Groq, or a supported OpenAI-compatible endpoint).

For job analysis, this can include the job title, job description, and your locally saved skills. For CV skill extraction, it includes the CV text you submit.
* This data is transmitted directly from your browser to the chosen API provider.
* It does not pass through any intermediate servers owned by us.
* Chrome requests access to the selected API host when you save or use that provider configuration.
* The selected provider's privacy policy and account terms govern its handling of the request.

## 4. Website Content
The content script runs only on the Upwork job and job-search URL patterns listed in the extension manifest. On those pages, it reads visible posting and client information to calculate and display the user-facing score. Analysis may run automatically when a supported Upwork page is opened. The extension does not read content from other browsing pages.

## 5. Data Retention and Control
Analysis history is limited to 100 items by default. You can delete individual history entries or clear the full history from the popup. Removing the extension also removes its locally stored data according to Chrome's extension-storage behavior.

## 6. Limited Use
BidLume uses data handled through Chrome extension permissions only to provide or improve its single-purpose, user-facing job-analysis features. We do not sell data, use it for personalized advertising, use it for creditworthiness or lending, or allow humans to read it. Data is transferred only when necessary to complete a request with the AI provider explicitly selected by the user.

## 7. Optional Support Link
The popup includes an optional link to the developer's Patreon page. Opening it takes you to an external website governed by Patreon's privacy policy. BidLume does not send your saved profile, API keys, CV text, or analysis history to Patreon, and does not collect or process donations inside the extension. Support is voluntary and does not unlock or restrict any extension feature.

## 8. Contact
If you have any questions or concerns about this Privacy Policy, please open an issue on our GitHub repository:
[https://github.com/AybarsOnurlu/BidLume/issues](https://github.com/AybarsOnurlu/BidLume/issues)
