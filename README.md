# Subsonic for MyGo Music

[简体中文](README.zh-CN.md)

A [MyGo Music](https://github.com/egoist/mygo-music) plugin that turns a
Subsonic-compatible server into a music source: [Navidrome](https://www.navidrome.org),
Airsonic, Gonic, Supysonic, LMS, Subsonic itself, and the rest of them.

## Install

With the app installed, open this link:

```
mygo-music://install-plugin?repo=XueJie1/mygo-music-subsonic
```

or, in **Settings → Plugins**, press **+** and paste the repository address.
The plugin is plain JavaScript, so there's no build step and no release to
download.

To try it from this folder, copy it into the app's plugins folder (**Settings →
Plugins → + → Show Plugins Folder**), then turn it on.

## Set it up

Open **Settings → Plugins → Subsonic** and fill in:

| Setting | What it is |
| --- | --- |
| **Server Address** | The server's address, such as `https://music.example.com`, `http://192.168.1.5:4533`, or `https://example.com/music` for one mounted under a path. A missing `http://` is added for you. |
| **Username** | The account the plugin uses. |
| **Password** | The account's password. |

Press **Sign In** to have the plugin check them against the server. A sign-in
belongs to that server address, username and password: change any of the three
and you sign in again, so a sign-in is never reused for credentials nobody
checked. A password the server turns down is said in the dialog, rather than
leaving the old sign-in in place.

The plugin has no sign-in page of its own: **Sign In** checks the three settings
above, so filling them in and signing in are the same thing. The app's dialog
speaks of a page because some plugins open one; this one only needs the
settings.

**Sign Out** only makes the app forget the account until you sign in again, as
Subsonic keeps no session to end.

What the plugin itself says, such as the sign-in prompts and errors, follows the
language chosen in the app's settings, English or Simplified Chinese, and is
English where there's no translation.

Requests are signed the way Subsonic asks: `token = md5(password + salt)`, with
a fresh salt for each request. The password itself is never sent, and it stays
in the app's plugin settings file on this computer.

The plugin asks to reach any website, because the server is one you name
yourself (including one on your LAN). It only talks to the address you gave it.

## What it does

- **Home** — a fresh pick of your songs, then Recently Added, Recently Played,
  Most Played and Starred albums, artists, playlists and genres.
- **Starred Songs** and **Starred Albums** — the server's stars are the app's
  liked songs and saved albums, and the hearts and star buttons change them on
  the server.
- **Search** — songs, albums, artists and playlists, with suggestions as you
  type.
- **Artists, Albums, Genres, Random** — pages of their own, with a genre page
  listing its songs and albums.
- **Playlists** — list, make, rename, delete, add, remove and reorder songs.
  Reordering is done by rewriting the playlist, as Subsonic has no move call.
- **Radio** — Shuffle All and Starred Mix stations.
- **Lyrics** — synced lyrics from servers that support OpenSubsonic's
  `getLyricsBySongId`.
- **Scrobbling** — playing a song scrobbles it, so the server's play counts and
  Recently Played stay right.
- **Covers and artist images** are fetched from the server with the same token,
  and keep one URL for the whole session so the app caches them.

## Playback quality

The app's **Quality** setting maps onto the server's `stream` endpoint:

| Quality | What's asked for |
| --- | --- |
| **Lossless** | `format=raw`, the file exactly as the server has it (`flac`, `wav`, ALAC/AAC in `m4a`, Ogg Vorbis, …) |
| **High** | mp3 at 320 kbps, unless it's an mp3 at 320 or below, which is streamed as it is |
| **Standard** | mp3 at 128 kbps |

Transcoding happens on the server, so a server whose transcoder isn't set up
(no `ffmpeg`, for example) should be used with **Lossless**, or with a library
that needs no transcoding. Formats the app can't play are always sent as mp3.

## What it doesn't do

- Podcasts, comments, artist following and "saved playlists" aren't in the
  Subsonic API, so the plugin doesn't offer them.
- Only synced lyrics are shown; plain lyrics without times would have nowhere
  to sit on the lyric stage.
- The first 500 of an album list show, as the API's browse calls have no
  paging in the plugin's page model.

## Development

The tests run the plugin against a small Subsonic server of their own, through a
stand-in `host`:

```sh
npm test
```

They cover the URL and token signing, mapping, paging, stars, playlists and
their edits, stream choices, lyrics and the plugin's pages.

## Publishing

Add the topic `mygo-music-plugin` to the repository to have it listed on the
[plugins page](https://mygo-music.egoist.dev/plugins). A new tag or commit is a
new version for the app's update check.

## License

MIT
