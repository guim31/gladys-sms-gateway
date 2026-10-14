# SMS Gateway for Android for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration that sends and
receives SMS through an Android phone running the free, open-source app
[SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway). Any
operator, any SIM card, no paid third-party service: an old phone plugged in
next to the router is enough.

> **Developed without the hardware: feedback welcome.** This integration was
> written and tested against a fake of the app's API rebuilt from its source
> code and its OpenAPI document, not against a real phone. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-sms-gateway/issues).

This integration is not affiliated with the SMS Gateway for Android project.

## What it does

- **Scene action "Send an SMS"**: one or several numbers in the international
  format, a text with the scene variables of Gladys, the SIM card on a
  dual-SIM phone. Its outputs (message id, recipients, state) feed the next
  actions.
- **Scene trigger "SMS received"**, filtered by sender and phone, with the
  sender, the text, the time and the SIM card as scene variables.
- **Scene trigger "SMS failed"**, when an SMS sent by Gladys could not be sent
  or delivered.
- **A device per phone**: reachable, battery level and charging (local mode),
  and counters of SMS sent, failed and received.
- **A dashboard widget**: phone status, SMS sent this hour against the limit,
  and the state of the last SMS sent (pending, sent, delivered, failed).
- **Sending safety**: an hourly limit (20 SMS per hour by default) refuses
  sends beyond it with a clear message. It survives restarts. Each send writes
  one log line, with the numbers masked and never the text.
- **Three connection modes**, as the app offers them: the app's local server
  on the home network, the project's cloud server (`api.sms-gate.app`), or a
  self-hosted private server.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- An Android phone (5.0 or later) with a SIM card, running SMS Gateway for
  Android 1.59.0 or later (earlier versions send, but cannot list the SMS
  received).

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-sms-gateway`. Open the integration's
Configuration screen, pick the connection mode and enter the username and
password the app shows. The phone appears in the Discovery tab.

The user documentation is in [English](docs/en.md), [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md); Gladys shows it from the
Configuration screen.

## Limits

- Developed without a phone: the shapes of the API come from the sources of
  the app and of its server. `npm run probe` checks them read-only against a
  real phone (see `scripts/probe.mjs`).
- SMS only: no MMS, no binary data SMS.
- The SMS received are read from the app's inbox at the refresh interval (1
  minute by default), not pushed: the app's webhooks need an address the phone
  can reach, which the Gladys sandbox does not publish.
- The battery is only known in local mode.
- The core's "Send Message" action and its system messages do not go out by
  SMS: this is a device integration, the scene action does the sending.
- A self-signed certificate on a private server is refused.

## Development

```bash
npm install
npm test               # node --test, against the SDK's fake Gladys and a fake SMS Gateway API
npm run lint
npm run format:check
npm run probe          # read-only check against a real phone (env vars in scripts/probe.mjs)
```

See [`CLAUDE.md`](CLAUDE.md) for the architecture and the rules of the
repository.

## Credits

- [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway) by
  Aleksandr Soloshenko (capcom6), Apache-2.0: the app, its API and its
  documentation at [docs.sms-gate.app](https://docs.sms-gate.app/).
- The official TypeScript client
  [android-sms-gateway/client-ts](https://github.com/android-sms-gateway/client-ts)
  and the [server](https://github.com/android-sms-gateway/server) (both
  Apache-2.0), read to write the client and the test fixtures; no code is
  copied.
- [Gladys Assistant](https://github.com/GladysAssistant/Gladys) and its
  [integration SDK](https://github.com/GladysAssistant/integration-sdk-js) by
  Pierre-Gilles Leymarie and the contributors.

## License

[Apache-2.0](LICENSE).
