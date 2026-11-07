// Tests for the plugin against a Subsonic server of its own, through a `host`
// that answers as the app's does. Run with `npm test` (Node 18 or later).

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PASSWORD = "secret";

// --- a Subsonic server, small enough to see what the plugin asks -------------

function song(id, title, albumId, extra = {}) {
  return {
    id,
    title,
    album: albumId === "al1" ? "First Album" : "Second Album",
    albumId,
    artist: "The Examples",
    artistId: "ar1",
    coverArt: albumId,
    duration: 180,
    track: Number(id.slice(1)),
    suffix: "flac",
    bitRate: 900,
    ...extra,
  };
}

function makeLibrary() {
  return {
    songs: [
      song("t1", "Song One", "al1", {
        size: 123456,
        replayGain: { trackGain: -7.5, trackPeak: 0.98 },
      }),
      song("t2", "Song Two", "al1", { suffix: "mp3", duration: 200, bitRate: 320 }),
      song("t3", "Song Three", "al2", { suffix: "ogg", duration: 220 }),
      song("t4", "Song Four", "al2", { suffix: "wma", duration: 240 }),
    ],
    albums: [
      {
        id: "al1",
        name: "First Album",
        artist: "The Examples",
        artistId: "ar1",
        coverArt: "al1",
        year: 2024,
        songCount: 2,
        genre: "Rock",
      },
      {
        id: "al2",
        name: "Second Album",
        artist: "The Examples",
        artistId: "ar1",
        coverArt: "al2",
        year: 2025,
        releaseDate: { year: 2025, month: 3, day: 1 },
        songCount: 2,
        genre: "Jazz",
      },
    ],
    artists: [{ id: "ar1", name: "The Examples", artistImageUrl: "/rest/getCoverArt?id=ar1" }],
    starredSongs: new Set(["t1"]),
    starredAlbums: new Set(["al1"]),
    playlists: [
      { id: "p1", name: "Faves", owner: "listener", songCount: 1, entries: ["t1"] },
    ],
    scrobbles: [],
    requests: [],
    reset() {
      this.starredSongs = new Set(["t1"]);
      this.starredAlbums = new Set(["al1"]);
      this.playlists = [{ id: "p1", name: "Faves", owner: "listener", songCount: 1, entries: ["t1"] }];
      this.scrobbles = [];
      this.requests = [];
    },
  };
}

const library = makeLibrary();
// What the server expects, which a test changes to say the password was
// changed on the server rather than in the settings.
let serverPassword = PASSWORD;

function ok(extra) {
  return { "subsonic-response": { status: "ok", version: "1.16.1", ...extra } };
}

function bad(code, message) {
  return { "subsonic-response": { status: "failed", version: "1.16.1", error: { code, message } } };
}

const byId = (id) => library.songs.find((s) => s.id === id);
const albumById = (id) => library.albums.find((a) => a.id === id);
const playlistById = (id) => library.playlists.find((p) => p.id === id);
const entriesOf = (p) => p.entries.map(byId).filter(Boolean);
const albumWithSongs = (a) => ({
  ...a,
  starred: library.starredAlbums.has(a.id) ? "2026-01-01T00:00:00Z" : undefined,
  song: library.songs.filter((s) => s.albumId === a.id),
});
const playlistWithEntries = (p) => ({
  id: p.id,
  name: p.name,
  owner: p.owner,
  songCount: p.entries.length,
  entry: entriesOf(p),
});

function handle(method, params) {
  switch (method) {
    case "getUser":
      // As Navidrome answers: the account asked about is its own parameter,
      // apart from the u that signs the request.
      if (!params.get("username")) return bad(10, "missing parameter: 'username'");
      return ok({ user: { username: params.get("username") } });
    case "getRandomSongs":
      return ok({ randomSongs: { song: library.songs } });
    case "getAlbumList2": {
      const type = params.get("type");
      let albums = library.albums.slice();
      if (type === "starred") albums = albums.filter((a) => library.starredAlbums.has(a.id));
      if (type === "byGenre") albums = albums.filter((a) => a.genre === params.get("genre"));
      const size = Number(params.get("size") || 0);
      if (size > 0) albums = albums.slice(0, size);
      return ok({ albumList2: { album: albums } });
    }
    case "getArtists":
      return ok({
        artists: {
          ignoredArticles: "The",
          index: [{ name: "T", artist: library.artists.map((a) => ({ ...a, albumCount: 2 })) }],
        },
      });
    case "getGenres":      return ok({
        genres: {
          genre: [
            { value: "Rock", songCount: 2, albumCount: 1 },
            { value: "Jazz", songCount: 2, albumCount: 1 },
          ],
        },
      });
    case "getSongsByGenre": {
      const genre = params.get("genre");
      const albums = library.albums.filter((a) => a.genre === genre).map((a) => a.id);
      return ok({
        songsByGenre: { song: library.songs.filter((s) => albums.includes(s.albumId)) },
      });
    }
    case "getStarred2":
      return ok({
        starred2: {
          song: library.songs.filter((s) => library.starredSongs.has(s.id)),
          album: library.albums.filter((a) => library.starredAlbums.has(a.id)),
        },
      });
    case "search3": {
      const q = (params.get("query") || "").toLowerCase();
      const match = (text) => String(text || "").toLowerCase().includes(q);
      return ok({
        searchResult3: {
          artist: library.artists.filter((a) => match(a.name)),
          album: library.albums.filter((a) => match(a.name)),
          song: library.songs.filter((s) => match(s.title)),
        },
      });
    }
    case "getArtist": {
      const a = library.artists.find((x) => x.id === params.get("id"));
      if (!a) return bad(70, "Artist not found");
      return ok({ artist: { ...a, albumCount: 2, album: library.albums } });
    }
    case "getTopSongs":
      return ok({ topSongs: { song: library.songs.slice(0, 2) } });
    case "getArtistInfo2":
      return ok({
        artistInfo2: { largeImageUrl: "/rest/getCoverArt?id=ar1", biography: "A band." },
      });
    case "getAlbum": {
      const a = albumById(params.get("id"));
      if (!a) return bad(70, "Album not found");
      return ok({ album: albumWithSongs(a) });
    }
    case "getSong": {
      const s = byId(params.get("id"));
      if (!s) return bad(70, "Song not found");
      return ok({ song: s });
    }
    case "getPlaylists":
      return ok({
        playlists: {
          playlist: library.playlists.map((p) => ({
            id: p.id,
            name: p.name,
            owner: p.owner,
            songCount: p.entries.length,
          })),
        },
      });
    case "getPlaylist": {
      const p = playlistById(params.get("id"));
      if (!p) return bad(70, "Playlist not found");
      return ok({ playlist: playlistWithEntries(p) });
    }
    case "createPlaylist": {
      const existing = playlistById(params.get("playlistId"));
      if (existing) {
        existing.entries = params.getAll("songId");
        return ok({ playlist: playlistWithEntries(existing) });
      }
      const p = {
        id: "p" + (library.playlists.length + 1),
        name: params.get("name") || "Untitled",
        owner: "listener",
        entries: params.getAll("songId"),
      };
      library.playlists.push(p);
      return ok({ playlist: playlistWithEntries(p) });
    }
    case "updatePlaylist": {
      const p = playlistById(params.get("playlistId"));
      if (!p) return bad(70, "Playlist not found");
      const name = params.get("name");
      if (name !== null) p.name = name;
      for (const id of params.getAll("songIdToAdd")) p.entries.push(id);
      const indexes = params
        .getAll("songIndexToRemove")
        .map(Number)
        .sort((a, b) => b - a);
      for (const i of indexes) {
        if (i >= 0 && i < p.entries.length) p.entries.splice(i, 1);
      }
      return ok();
    }
    case "deletePlaylist": {
      const id = params.get("id");
      library.playlists = library.playlists.filter((p) => p.id !== id);
      return ok();
    }
    case "star":
    case "unstar": {
      const on = method === "star";
      const id = params.get("id");
      const albumId = params.get("albumId");
      if (id) on ? library.starredSongs.add(id) : library.starredSongs.delete(id);
      if (albumId) on ? library.starredAlbums.add(albumId) : library.starredAlbums.delete(albumId);
      return ok();
    }
    case "scrobble":
      library.scrobbles.push(params.get("id"));
      return ok();
    case "getLyricsBySongId": {
      const id = params.get("id");
      if (id === "t1") {
        return ok({
          lyricsList: {
            structuredLyrics: [
              {
                synced: true,
                line: [
                  { start: 1000, value: "Hello" },
                  { start: 4000, value: "World" },
                ],
              },
            ],
          },
        });
      }
      return ok({ lyricsList: { structuredLyrics: [] } });
    }
    case "getCoverArt":
      return { image: true };
    case "stream":
      return { audio: true };
    default:
      return bad(0, "Unknown method " + method);
  }
}

const httpServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    const params = new URLSearchParams(url.search);
    if (body) {
      for (const [k, v] of new URLSearchParams(body)) params.append(k, v);
    }
    const method = url.pathname.replace(/^\/rest\//, "").replace(/\.view$/, "");
    library.requests.push({ method, params });

    const user = params.get("u");
    const salt = params.get("s");
    const token = params.get("t");
    const expected = createHash("md5").update(serverPassword + (salt || "")).digest("hex");
    if (user !== "listener" || !token || token !== expected) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(bad(40, "Wrong username or password")));
      return;
    }

    const answer = handle(method, params);
    if (answer.audio) {
      res.writeHead(200, { "content-type": "audio/flac" });
      res.end(Buffer.from("fLaC"));
      return;
    }
    if (answer.image) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.from("jpeg"));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer));
  });
});

await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const port = httpServer.address().port;
after(() => httpServer.close());

// --- the host the app gives a plugin ----------------------------------------

const settings = {
  server: `http://127.0.0.1:${port}`,
  username: "listener",
  password: PASSWORD,
};

// What the plugin keeps in host.storage, which outlives the app.
const storage = {};

// What the sign-in dialog is asked to show while signing in.
const prompts = [];

globalThis.host = {
  platform: "linux",
  arch: "x64",
  dir: process.cwd(),
  dataDir: process.cwd(),
  storage: {
    get: (key) => (key in storage ? storage[key] : null),
    set: (key, value) => {
      storage[key] = value;
    },
    remove: (key) => {
      delete storage[key];
    },
  },
  setting: (key) => settings[key] || "",
  t: (text) => text,
  language: () => "en",
  crypto: {
    md5: (text) => createHash("md5").update(String(text)).digest("hex"),
  },
  openURL: () => {},
  signInPrompt: (prompt) => prompts.push(prompt),
  spawn: () => {
    throw new Error("no programs in tests");
  },
};

const plugin = await import("../index.js");

beforeEach(async () => {
  settings.server = `http://127.0.0.1:${port}`;
  settings.username = "listener";
  settings.password = PASSWORD;
  serverPassword = PASSWORD;
  for (const key of Object.keys(storage)) delete storage[key];
  library.reset();
  prompts.length = 0;
  // Almost every test is about something a signed-in listener does. The tests
  // about signing in itself sign out or change the settings first.
  await plugin.signIn();
  library.requests = [];
  prompts.length = 0;
});

const codeOf = async (promise) => {
  try {
    await promise;
    return "";
  } catch (e) {
    return e.code || "plain";
  }
};

const errorOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
};

// --- tests ------------------------------------------------------------------

test("without settings, every request asks for setup", async () => {
  settings.server = "";
  assert.equal(plugin.account(), null);
  assert.equal(await codeOf(plugin.home()), "setup");
  assert.equal(await codeOf(plugin.search({ query: "song", kind: "tracks", offset: 0 })), "setup");
  assert.equal(await codeOf(plugin.stream({ id: "t1", quality: "high" })), "setup");
});

test("account knows who is signed in without asking the server, and signIn checks", async () => {
  assert.deepEqual(plugin.account(), { id: "listener", name: "listener" });
  assert.equal(library.requests.length, 0);

  const me = await plugin.signIn();
  assert.equal(me.name, "listener");

  settings.password = "wrong";
  assert.equal(await codeOf(plugin.signIn()), "plain");
  // A sign-in that fails leaves nothing that looks signed in.
  assert.equal(plugin.account(), null);
});

test("a wrong password is refused with a message, and leaves nothing signed in", async () => {
  plugin.signOut();
  settings.password = "wrong";
  plugin.setSetting({ key: "password" });
  assert.equal(plugin.account(), null);

  const error = await errorOf(plugin.signIn());
  // A plain error, so its message is shown as it is, without the app putting
  // "sign in first" in front of it.
  assert.equal(error.code, undefined);
  assert.match(error.message, /Wrong username or password/);
  // The plugin's sign-in has no page of its own, so the dialog says where the
  // three settings are.
  assert.match(error.message, /Settings → Plugins → Subsonic/);
  assert.equal(storage.session, undefined);
  assert.equal(plugin.account(), null);
  // What the dialog is told while signing in, and what it says about the fix.
  assert.match(prompts[0].text, /Connecting to Subsonic/);
  assert.match(prompts[prompts.length - 1].text, /Settings → Plugins → Subsonic/);
});

test("what the plugin says follows the app's language, English when it can't say", async () => {
  const zh = JSON.parse(readFileSync(new URL("../locales/zh-CN.json", import.meta.url), "utf8"));
  const original = host.t;
  const wrongPassword = async () => {
    plugin.signOut();
    settings.password = "wrong";
    plugin.setSetting({ key: "password" });
    return errorOf(plugin.signIn());
  };

  // As the app answers when its language is Chinese.
  host.t = (text) => zh[text] || text;
  try {
    const error = await wrongPassword();
    assert.match(error.message, /用户名或密码错误/);
    assert.match(error.message, /设置 → 插件 → Subsonic/);
    assert.match(prompts[0].text, /正在连接 Subsonic/);
  } finally {
    host.t = original;
  }

  // An app that answers nothing, or nothing it can read, gets the English.
  for (const unusable of [() => "", () => { throw new Error("no language"); }, undefined]) {
    host.t = unusable;
    try {
      const error = await wrongPassword();
      assert.match(error.message, /Wrong username or password/);
      assert.match(error.message, /Settings → Plugins → Subsonic/);
    } finally {
      host.t = original;
    }
  }
});

test("without a sign-in, browsing asks for one", async () => {
  plugin.signOut();
  assert.equal(plugin.account(), null);
  assert.equal(await codeOf(plugin.home()), "signIn");
  assert.equal(await codeOf(plugin.search({ query: "song", kind: "tracks", offset: 0 })), "signIn");
  assert.equal(await codeOf(plugin.stream({ id: "t1", quality: "high" })), "signIn");
});

test("signIn asks for the account by name, as the server needs", async () => {
  // Regression: getUser was asked without a username, which Navidrome refused
  // with "missing parameter: 'username'", so the sign-in dialog showed exactly
  // that instead of signing in.
  await plugin.signIn();
  const asked = library.requests.filter((r) => r.method === "getUser").pop();
  assert.equal(asked.params.get("username"), "listener");
});

test("signing out forgets the account until signing in again", async () => {
  plugin.signOut();
  assert.equal(plugin.account(), null);
  // Only who is signed in is forgotten; what the settings say still signs in.
  assert.equal(await codeOf(plugin.home()), "signIn");

  assert.deepEqual(await plugin.signIn(), { id: "listener", name: "listener" });
  assert.equal(plugin.account().name, "listener");
});

test("a setting filled in anew takes the sign-in with it", async () => {
  assert.deepEqual(plugin.account(), { id: "listener", name: "listener" });

  // The sign-in was for the old password, and none for the new one, so the
  // app asks again rather than browsing with credentials nobody checked.
  settings.password = "another";
  plugin.setSetting({ key: "password" });
  assert.equal(plugin.account(), null);
  assert.equal(await codeOf(plugin.signIn()), "plain");
});

test("a song, an album and an artist come over with their covers signed", async () => {
  const page = await plugin.album({ id: "al1" });
  assert.equal(page.album.name, "First Album");
  assert.equal(page.album.released, "2024");
  assert.equal(page.album.saved, true);
  assert.equal(page.tracks.length, 2);
  assert.equal(page.tracks[0].name, "Song One");
  assert.equal(page.tracks[0].duration, 180000);
  assert.deepEqual(page.tracks[0].artists, [{ id: "ar1", name: "The Examples" }]);
  assert.equal(page.tracks[0].album.id, "al1");
  assert.match(page.tracks[0].album.imageUrl, /\/rest\/getCoverArt\?/);
  assert.match(page.tracks[0].album.imageUrl, /id=al1/);
  assert.match(page.tracks[0].album.imageUrl, /u=listener/);
  assert.match(page.tracks[0].album.imageUrl, /t=[0-9a-f]{32}/);

  const artistPage = await plugin.artist({ id: "ar1" });
  assert.equal(artistPage.artist.name, "The Examples");
  assert.match(artistPage.artist.imageUrl, /getCoverArt\?id=ar1/);
  assert.equal(artistPage.tracks.length, 2);
  assert.equal(artistPage.albums.length, 2);
});

test("an OpenSubsonic release date, which is an object, becomes a string", async () => {
  // Regression: passing {year, month, day} through failed the app's decoding
  // with "cannot unmarshal object into Go struct field ... released".
  const page = await plugin.album({ id: "al2" });
  assert.equal(page.album.released, "2025-03-01");
  assert.equal((await plugin.album({ id: "al1" })).album.released, "2024");

  const home = await plugin.home();
  for (const section of home.sections) {
    for (const a of section.albums || []) assert.equal(typeof a.released, "string");
  }
});

test("a cover's URL stays the same, so the app keeps it once", async () => {
  const a = (await plugin.album({ id: "al1" })).album.imageUrl;
  const b = (await plugin.album({ id: "al1" })).album.imageUrl;
  assert.equal(a, b);
});

test("search asks for the kind, pages it, and searches playlists itself", async () => {
  const tracks = await plugin.search({ query: "song", kind: "tracks", offset: 0 });
  assert.equal(tracks.tracks.length, 4);
  assert.equal(tracks.more, false);

  const albums = await plugin.search({ query: "album", kind: "albums", offset: 0 });
  assert.equal(albums.albums.length, 2);

  const artists = await plugin.search({ query: "examples", kind: "artists", offset: 0 });
  assert.deepEqual(artists.artists.map((a) => a.name), ["The Examples"]);

  const playlists = await plugin.search({ query: "fav", kind: "playlists", offset: 0 });
  assert.equal(playlists.playlists.length, 1);
  assert.equal(playlists.playlists[0].name, "Faves");

  const none = await plugin.search({ query: "nothing", kind: "tracks", offset: 0 });
  assert.deepEqual(none.tracks, []);
});

test("suggest offers the names of matching songs once each", async () => {
  const names = await plugin.suggest({ query: "song" });
  assert.deepEqual(names, ["Song One", "Song Two", "Song Three", "Song Four"]);
});

test("liked songs and albums are the server's stars", async () => {
  assert.deepEqual(await plugin.isLiked({ ids: ["t1", "t2"] }), { t1: true, t2: false });

  await plugin.like({ id: "t2", on: true });
  assert.deepEqual(await plugin.isLiked({ ids: ["t1", "t2"] }), { t1: true, t2: true });

  const liked = await plugin.liked({ offset: 0 });
  assert.deepEqual(
    liked.tracks.map((t) => t.id).sort(),
    ["t1", "t2"],
  );
  assert.equal(liked.more, false);

  await plugin.like({ id: "t1", on: false });
  assert.deepEqual((await plugin.isLiked({ ids: ["t1"] })), { t1: false });

  const saved = await plugin.savedAlbums({ offset: 0 });
  assert.deepEqual(saved.albums.map((a) => a.id), ["al1"]);
  await plugin.saveAlbum({ id: "al2", on: true });
  const after = await plugin.savedAlbums({ offset: 0 });
  assert.deepEqual(after.albums.map((a) => a.id).sort(), ["al1", "al2"]);
});

test("playlists list, make, change, reorder and go", async () => {
  const all = await plugin.playlists();
  assert.equal(all.length, 1);
  assert.equal(all[0].mine, true);
  assert.equal(all[0].trackCount, 1);

  const page = await plugin.playlist({ id: "p1" });
  assert.deepEqual(page.tracks.map((t) => t.id), ["t1"]);

  const made = await plugin.createPlaylist({ name: "Road Trip" });
  assert.equal(made.name, "Road Trip");
  await plugin.addToPlaylist({ id: made.id, trackIds: ["t1", "t2"] });
  assert.deepEqual(
    (await plugin.playlist({ id: made.id })).tracks.map((t) => t.id),
    ["t1", "t2"],
  );

  await plugin.movePlaylistTrack({ id: made.id, from: 0, to: 1 });
  assert.deepEqual(
    (await plugin.playlist({ id: made.id })).tracks.map((t) => t.id),
    ["t2", "t1"],
  );

  await plugin.removeFromPlaylist({ id: made.id, trackIds: ["t2"] });
  assert.deepEqual(
    (await plugin.playlist({ id: made.id })).tracks.map((t) => t.id),
    ["t1"],
  );

  await plugin.renamePlaylist({ id: made.id, name: "Trip" });
  assert.equal((await plugin.playlist({ id: made.id })).name, "Trip");

  await plugin.deletePlaylist({ id: made.id });
  assert.equal((await plugin.playlists()).length, 1);
});

test("removing the same song twice takes two rows", async () => {
  const made = await plugin.createPlaylist({ name: "Twice" });
  await plugin.addToPlaylist({ id: made.id, trackIds: ["t1", "t1", "t2"] });
  await plugin.removeFromPlaylist({ id: made.id, trackIds: ["t1", "t1"] });
  assert.deepEqual(
    (await plugin.playlist({ id: made.id })).tracks.map((t) => t.id),
    ["t2"],
  );
});

test("stream keeps the file at lossless, and asks for mp3 otherwise", async () => {
  const lossless = await plugin.stream({ id: "t1", quality: "lossless" });
  assert.equal(lossless.type, "flac");
  assert.match(lossless.url, /format=raw/);
  assert.match(lossless.url, /maxBitRate=0/);
  assert.equal(lossless.size, 123456);
  assert.equal(lossless.gain, -7.5);
  assert.equal(lossless.peak, 0.98);

  const high = await plugin.stream({ id: "t1", quality: "high" });
  assert.equal(high.type, "mp3");
  assert.match(high.url, /format=mp3/);
  assert.match(high.url, /maxBitRate=320/);
  assert.equal(high.size, undefined);

  const standard = await plugin.stream({ id: "t2", quality: "standard" });
  assert.equal(standard.type, "mp3");
  assert.match(standard.url, /maxBitRate=128/);

  // An mp3 at 320 is already what High asks for, so it isn't transcoded.
  const already = await plugin.stream({ id: "t2", quality: "high" });
  assert.equal(already.type, "mp3");
  assert.match(already.url, /format=raw/);

  const ogg = await plugin.stream({ id: "t3", quality: "lossless" });
  assert.equal(ogg.type, "ogg");
  assert.match(ogg.url, /format=raw/);

  // The app can't play WMA, so the server is asked to send mp3.
  const wma = await plugin.stream({ id: "t4", quality: "lossless" });
  assert.equal(wma.type, "mp3");
  assert.match(wma.url, /format=mp3/);
});

test("lyrics come timed, and a song without them has none", async () => {
  const l = await plugin.lyrics({ id: "t1" });
  assert.equal(l.lines.length, 2);
  assert.deepEqual(l.lines[0], { start: 1000, text: "Hello", end: 4000 });
  assert.deepEqual(l.lines[1], { start: 4000, text: "World", end: 10000 });

  assert.deepEqual(await plugin.lyrics({ id: "t2" }), {});
});

test("Home has the picks card, albums, artists, playlists and genres", async () => {
  const home = await plugin.home();
  const titles = home.sections.map((s) => s.title);
  assert.equal(home.sections[0].title, "Picked for You");
  assert.equal(home.sections[0].tracks.length, 4);
  assert.ok(titles.includes("Recently Added"));
  assert.ok(titles.includes("Starred Albums"));
  assert.ok(titles.includes("Artists"));
  assert.ok(titles.includes("Playlists"));
  assert.ok(titles.includes("Genres"));

  const artists = home.sections.find((s) => s.title === "Artists");
  assert.equal(artists.artists[0].name, "The Examples");
  const genres = home.sections.find((s) => s.title === "Genres");
  assert.equal(genres.links[0].page, "genre:Rock");
});

test("the pages the sidebar and Home open", async () => {
  const artists = await plugin.browse({ page: "artists" });
  assert.equal(artists.sections[0].artists.length, 1);

  const albums = await plugin.browse({ page: "albums-all" });
  assert.equal(albums.sections[0].albums.length, 2);

  const starred = await plugin.browse({ page: "albums-starred" });
  assert.deepEqual(starred.sections[0].albums.map((a) => a.id), ["al1"]);

  const genres = await plugin.browse({ page: "genres" });
  assert.equal(genres.sections[0].links.length, 2);

  const genre = await plugin.browse({ page: "genre:Rock" });
  assert.equal(genre.title, "Rock");
  assert.equal(genre.sections[0].tracks.length, 2);

  const random = await plugin.browse({ page: "random" });
  assert.equal(random.sections[0].tracks.length, 4);

  const playlists = await plugin.browse({ page: "playlists" });
  assert.equal(playlists.sections[0].playlists.length, 1);

  assert.equal(await codeOf(plugin.browse({ page: "nope" })), "unavailable");
});

test("radio plays random songs, or the starred ones", async () => {
  const stations = plugin.stations();
  assert.deepEqual(stations.map((s) => s.id), ["random", "starred"]);

  const random = await plugin.stationNext({ id: "random" });
  assert.equal(random.length, 4);

  const starred = await plugin.stationNext({ id: "starred" });
  assert.deepEqual(starred.map((t) => t.id), ["t1"]);
});

test("playing a song tells the server", async () => {
  await plugin.played({ id: "t2" });
  assert.deepEqual(library.scrobbles, ["t2"]);
});

test("a server that refuses the password asks to sign in again", async () => {
  // The password changed on the server, not in the settings: what was signed
  // in no longer is, and the app is told to ask again.
  serverPassword = "changed";
  assert.equal(await codeOf(plugin.liked({ offset: 0 })), "signIn");
  assert.equal(plugin.account(), null);
  assert.equal(storage.session, undefined);
  assert.equal(await codeOf(plugin.album({ id: "al1" })), "signIn");
});
