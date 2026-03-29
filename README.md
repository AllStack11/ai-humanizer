# Voice Humanizer

A simple, powerful interface for rewriting text to sound like your voice or expanding drafts with more detail. Built with React and designed to work both as a desktop app (via Tauri) and a pure web application.

## Features

- **Humanize**: Rewrite AI-generated text to match your personal writing style.
- **Elaborate**: Expand short drafts into detailed content while maintaining your tone.
- **Custom Profiles**: Create and manage multiple writing profiles.
- **Open-Source Friendly**: Run it locally or deploy it to the cloud using your own API keys.
- **Desktop & Web**: Works as a native desktop application or a standard web app.

## Cloud Deployment (Web Mode)

### Vercel Deployment

This project is optimized for Vercel. The `vercel.json` file in the root directory automatically configures the build settings.

1.  **Connect Your Repository**: Import this repository into Vercel.
2.  **Environment Variables**: Add `VITE_OPENROUTER_API_KEY` in the Vercel dashboard if you want to provide a default key.
3.  **Build Settings**: (Auto-configured by `vercel.json`)
    - Build Command: `npm run build:web`
    - Output Directory: `dist`
    - Install Command: `npm install`

### Manual Build

To build the web version locally:

```bash
npm install
npm run build:web
```

The resulting `dist/` folder can be hosted on any static provider (Netlify, GitHub Pages, etc.).

### Configuration
When running in the browser, the app will prompt you for your **OpenRouter API Key** if one isn't provided via environment variables. This key is stored securely in your browser's `localStorage`.

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
