# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Send SMS from Gladys scenes with an Android phone running SMS Gateway for
  Android: the "Send an SMS" scene action, with several recipients in the
  international format, the scene variables in the text and a choice of SIM
  card.
- Three connection modes: the app's local server, the project's cloud server,
  or a private server.
- An hourly sending limit (20 SMS per hour by default) that refuses sends
  beyond it with a clear message, and survives restarts.
- The state of every SMS sent (pending, sent, delivered, failed) followed until
  it is final, and the "SMS failed" scene trigger.
- The "SMS received" scene trigger, filtered by sender and phone, read from
  the app's inbox (app 1.59.0 or later).
- One device per phone: reachable, battery level and charging (local mode),
  SMS sent, failed and received.
- An "SMS gateway" dashboard widget, and the "Test the connection", "Send a
  test SMS" and "Recent SMS" actions on the Configuration screen.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-sms-gateway/commits/main
