# Subsonic for MyGo Music

A [MyGo Music](https://github.com/egoist/mygo-music) plugin that turns a
Subsonic-compatible server into a music source: [Navidrome](https://www.navidrome.org),
Airsonic, Gonic, Supysonic, LMS, Subsonic itself, and the rest of them.

## Install

With the app installed, open this link:

```
mygo-music://install-plugin?repo=owner/mygo-music-subsonic
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

Press **Sign In** to have the plugin check them against the server.
**Sign Out** only makes the app forget the account until you sign in again, or
change one of the settings, as Subsonic keeps no session to end.

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

## 中文

这是一个给 MyGo Music 用的 Subsonic / Navidrome 插件，支持任何兼容 Subsonic
API 的服务器（Navidrome、Airsonic、Gonic、Supysonic 等）。

安装：在应用的 **设置 → 插件** 中点 **+**，粘贴仓库地址（或使用上面的
`mygo-music://install-plugin?repo=...` 链接）。然后在 **设置 → 插件 →
Subsonic** 中填写服务器地址、用户名和密码。

- 服务器地址可以带路径（如 `https://example.com/music`），也可以不写 `http://`。
- 点 **登录** 会向服务器核对这组账号；**退出登录** 只是让应用先忘掉这个账号，重新登录或改动设置就会恢复。
- 请求使用 `md5(密码 + 盐)` 令牌签名，密码本身不会发送，只保存在本机的插件设置里。
- 插件需要“访问任意网站”的权限，因为服务器地址由你自己填写（包括局域网地址）。
- 音质：无损 = 原文件（`format=raw`）；高 = mp3 320（本身不超过 320 的 mp3 直接原样播放）；标准 = mp3 128。
  服务器需要配置好转码（通常需要 `ffmpeg`）。
- 星标 = 应用里的“喜欢”和“收藏专辑”；播放会向服务器提交 scrobble。

功能：首页推荐、星标歌曲/专辑、搜索与输入建议、艺人/专辑/流派/随机页面、
播放列表增删改与排序、随机电台、同步歌词、封面。不支持播客、评论、关注艺人——
Subsonic API 里没有这些。

## License

MIT
