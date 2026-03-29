# Voice Humanizer

A simple, powerful interface for rewriting text to sound like your voice or expanding drafts with more detail. Built with React and designed to work both as a desktop app (via Tauri) and a pure web application.

## Features

- **Humanize**: Rewrite AI-generated text to match your personal writing style.
- **Elaborate**: Expand short drafts into detailed content while maintaining your tone.
- **Custom Profiles**: Create and manage multiple writing profiles.
- **Open-Source Friendly**: Run it locally or deploy it to the cloud using your own API keys.
- **Desktop & Web**: Works as a native desktop application or a standard web app.

## Cloud Deployment (Web Mode)

This application is designed to be easily deployed to any static hosting provider (Vercel, Netlify, GitHub Pages, etc.).

### 1. Prerequisites
- An [OpenRouter API Key](https://openrouter.ai/keys) (or any OpenAI-compatible API).

### 2. Local Setup & Build
```bash
# Install dependencies
npm install

# Build for the web
npm run build
```

### 3. Deploy
You can deploy the `dist/` folder to any static hosting service.

- **Vercel**: Push your code to GitHub and connect the repository to Vercel. It will automatically detect the Vite project and deploy it.
- **GitHub Pages**: Use the `gh-pages` package or GitHub Actions to deploy the `dist/` folder.

### 4. Configuration
When running in the browser, the app will prompt you for your **OpenRouter API Key**. This key is stored securely in your browser's `localStorage` and is never sent to any server other than the API provider you specify.

## Desktop Development (Tauri)

If you prefer to run this as a native desktop application:

### Prerequisites
- [Rust and Cargo](https://www.rust-lang.org/tools/install)
- [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

### Run in Development
```bash
npm run tauri dev
```

### Build Desktop App
```bash
npm run tauri build
```

## Environment Variables

You can customize the application's behavior using a `.env` file in the root directory:

- `VITE_OPENROUTER_API_URL`: Override the default OpenRouter API URL.
- `VITE_OPENROUTER_APP_NAME`: Set the `X-Title` header for API requests.

## License

MIT
