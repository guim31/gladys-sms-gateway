# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and where:

- **Configuration** (stored by Gladys, not in the container): the address of
  the phone or of the server, the username, and the password, a `secret` field
  Gladys never sends back to the browser. The password only travels to the
  SMS Gateway API, as HTTP Basic authentication.
- **`/data/sms-gateway-state.json`** (the container's only writable volume):
  the times and counts of the sends of the last hour (the hourly limit), the
  SMS counters of each phone, the ids of the SMS received over the last hours
  (so no scene fires twice), and the last 20 messages sent with their
  recipients' numbers and states, for at most a day of follow-up. Never the
  text of an SMS, never the password.
- **Logs**: the numbers appear masked (last two digits), the texts and the
  password never.

Network: in local mode, plain HTTP to the phone on the home network (the app's
local server has no TLS by default: keep it off the Internet). In cloud mode,
HTTPS to `api.sms-gate.app`, a server run by the author of the app: the SMS
and their recipients go through it. In private mode, HTTPS (or HTTP) to the
address configured. Nothing listens in the container.

An SMS received is untrusted input: its sender can be faked. The integration
only exposes it to scenes as a trigger, and the documentation warns against
security actions (alarm, locks) started by an SMS.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the SMS Gateway for Android app and server (report to
[their project](https://github.com/capcom6/android-sms-gateway/security)), and
the operators.
