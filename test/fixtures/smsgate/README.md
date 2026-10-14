# SMS Gateway for Android API fixtures

No public capture of a real phone exists (the upstream projects mock their
answers), and this integration was developed without a phone. These files are
**rebuilt from the sources** of the projects, field by field, then anonymized:

- `health-local.json`: `GET /health` of the app's local server, built from
  `HealthService`, `BatteryMonitor` (`battery:level` in percent,
  `battery:charging` as flags: 1 charging, 2 on AC, 4 on USB),
  `MessagesService.healthCheck` and `ConnectionService.healthCheck` of
  `capcom6/android-sms-gateway` (Apache-2.0), serialized by Gson (enums
  lowercased through `@SerializedName`).
- `device-local.json`: `GET /device` of the local server (`DeviceRoutes`: one
  phone, `MANUFACTURER/PRODUCT` as name, the active SIM cards).
- `devices-cloud.json`: `GET /3rdparty/v1/devices` of the server
  (`android-sms-gateway/server`, Apache-2.0, `smsgateway.Device` of its OpenAPI
  document); the second phone was deleted from the account.
- `message-*.json`: `smsgateway.MessageState` of the OpenAPI document (the
  answer of `POST /message` and of `GET /message/{id}`); the error text is an
  Android `SmsManager` result name, as the app reports it.
- `inbox.json`: `GET /inbox` (`InboxRoutes.InboxMessage`, app 1.59.0 and
  later); the second sender is an alphanumeric service name.

Ids are invented, numbers are fictitious, operators are anonymized.
`scripts/probe.mjs` checks the same reads against a real phone.
