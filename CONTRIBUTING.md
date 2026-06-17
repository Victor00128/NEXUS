# Contributing to NEXUS AI

Thank you for your interest in contributing!

## Development Setup

1. Fork and clone the repository
2. Run `npm install` to install dependencies
3. Create a feature branch: `git checkout -b feature/my-feature`
4. Make your changes
5. Test thoroughly: `npm run build && npm run lint`
6. Submit a pull request

## Project Structure

- **Frontend**: `src/` - Next.js React components and engines
- **API Server**: `api/server.ts` - Express REST API
- **Core Engines**: `src/lib/` - Tuning, obfuscation, categorization, presets
- **State Management**: `src/store/` - Zustand store

## Guidelines

- Keep PRs focused on a single change
- Never commit API keys or secrets
- Test your changes before submitting
- Follow existing code style and patterns
- Be respectful in discussions

## License

All contributions are licensed under the MIT License.
