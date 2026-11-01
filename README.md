# Saunakaverit — Yhdessä saunaan

A social sauna app for Finland: fixed Sunday saunas, themed sessions (language sauna, newcomers, silent, avanto, after-the-run), a sauna passport with stamps and badges, and a twelve-point sauna etiquette for first-timers. Finnish first, English toggle.

## Version 0.3 (Löylyhuone, 2026-11-01)

- **Löylyhuone**, a shared virtual sauna (tab "Löyly" and a LIVE card on Home). Everyone present sits on the three-tier lauteet as a small towel-wrapped figure with a name tag; tap a free spot to change seats.
- Actions: throw löyly (steam burst, thermometer rises and slowly cools), vihta, cool off by the open door, "Hyvät löylyt", sauna hat, and short messages that show as speech bubbles. A "Löylymestarit" list counts throws during your stay, and "Saunassa tapahtuu" logs who came, left, threw and said what.
- Built on Supabase Realtime presence and broadcast only. Nothing is stored: messages vanish, the leaderboard resets when you leave.
- Each sauna you have joined gets its own room from the session sheet (`session:<id>`); the common room `yhteinen` is always open. Without a backend the room still works for one person.

## Version 0.2 (shared backend, 2026-11-01)

- **Supabase backend** (project `saunakaverit`, region eu-north-1 Stockholm). Sessions, joins, waitlists, profiles and passport stamps are shared between phones and update live.
- **No password.** Each phone generates a secret token on first launch and keeps it in `localStorage`. The server stores only a SHA-256 hash and maps it to a profile. Clearing data on the Me tab discards the token, so the profile is gone for that phone.
- **Writes only through server functions** (`sk_upsert_profile`, `sk_create_session`, `sk_remove_session`, `sk_join`, `sk_leave`, `sk_stamp`, `sk_ensure_sunday`). Tables are read-only for the public through `sessions_public` and `attendees_public`; stamps are private.
- **Waitlist promotion**: when someone who is going leaves, the earliest waitlister moves up automatically.
- **Weekly ritual**: `sk_ensure_sunday()` creates the next Sunday 15:00 Kotiharju sauna on demand, hosted by the system profile "Saunakaverit".
- **Limits**: 10 open saunas per host, 5 stamps per day per profile, name 24 chars, note 500 chars.
- **Offline fallback**: with no connection (or without `js/config.js`) the app shows seed sessions and keeps data on the device, as in 0.1.
- **Testing two phones in one browser**: open `?device=2` for a second identity.

Migrations live in the Supabase project (`saunakaverit_core`, `sk_me_hosted_ids`). Demo profiles have token hashes `demo:<name>` and cannot be logged into.

## Version 0.1 (first version, 2026-11-01)

- Single-page web app, Finnish-first with EN toggle, 12 real public saunas in Helsinki, Vantaa and Tampere, host form, passport with 9 badges, etiquette, seasonal cards.

## Run

Double-click `Start Saunakaverit.bat` (port 8130), or use the Claude Code launch config `saunakaverit`. Any static host works too (the app is plain HTML, CSS and JS).

## Next (not built yet)

- Push or email reminders the day before a sauna, and waitlist notifications.
- Live "who is at the sauna now" check-ins.
- Cottage (mökki) sauna invitations and private rentals with cost split.
- Partner groups: language cafés, International House Helsinki, student unions, winter-swimming clubs.
- Capacitor wrap for iOS/Android like the other projects.
