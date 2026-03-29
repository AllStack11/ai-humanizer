# Contributing to Voice Humanizer

First off, thank you for considering contributing to Voice Humanizer! It's people like you that make open source such a great community.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for Voice Humanizer. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Check for existing issues**: Before you open a new issue, please check if the bug has already been reported.
- **Use a clear and descriptive title** for the issue to identify the problem.
- **Describe the exact steps which reproduce the problem** in as many details as possible.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for Voice Humanizer, including completely new features and minor improvements to existing functionality.

- **Check for existing issues**: Before you open a new issue, please check if the enhancement has already been suggested.
- **Provide a clear and descriptive title**.
- **Provide a step-by-step description of the suggested enhancement** in as many details as possible.

### Pull Requests

- **Branch naming**: Use descriptive names for your branches (e.g., `fix/bug-description` or `feature/new-feature`).
- **Follow coding styles**: Stick to the existing code style (React for frontend, Rust for desktop runtime).
- **Write tests**: If you're adding a new feature or fixing a bug, please add tests to ensure it continues to work.
- **Document your changes**: Update the `README.md` or other relevant documentation if necessary.

## Development Setup

### Prerequisites

- Node.js and npm
- Rust and Cargo (for desktop version)

### Local Development

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/AllStack11/humanizer.git
    cd humanizer
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Run in development**:
    - Web: `npm run dev:web`
    - Desktop: `npm run tauri:dev`

## Style Guide

- **JavaScript**: Standard Prettier/ESLint configuration.
- **Rust**: `cargo fmt` and `cargo clippy`.

## Questions?

Feel free to open an issue for discussion!
